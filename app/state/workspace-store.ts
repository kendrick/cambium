import { createStore, type StoreApi } from 'zustand/vanilla';

import type { BrandRecord, BrandVersion } from '../../core/brand-record';
import { type BrandSeed, BrandSeedSchema } from '../../core/brand-seed';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import {
	BALANCED,
	type InterpretationParams,
	type ScaleEngine,
	type ScaleEngineResult,
} from '../../core/scale-engine';
import type { RecordStore } from '../storage/record-store';

export type Interpretation = BrandVersion['interpretation'];

/**
 * Faithful and Expressive have no numbers yet — `core/scale-engine.ts` ships Balanced alone and
 * says so, because #37 is where the other two get their meaning. Pointing all three at Balanced
 * keeps the selection real where it matters (a committed version records which preset produced
 * it) without inventing a preset's definition out here, a long way from the engine that has to
 * honour it. When #37 lands, the two placeholder rows are what it replaces.
 */
const PRESET_PARAMS: Record<Interpretation, InterpretationParams> = {
	faithful: BALANCED,
	balanced: BALANCED,
	expressive: BALANCED,
};

/**
 * What a new version cannot derive from the workspace: who generated the seed and against what.
 *
 * Optional on `commit`, because the workspace's own commit path is the interpretation-preset case
 * from `BrandVersionSchema` — re-derivation with no model call. That version carries the active
 * version's provider and model forward, and a null `rawResponse`, which is exactly what the schema
 * says null there means. A commit that *did* come from a model call passes the real thing instead.
 */
export type CommitProvenance = Pick<
	BrandVersion,
	'provider' | 'model' | 'promptVersion' | 'rawResponse' | 'fontTable'
>;

export type WorkspaceState = {
	/** The open record, as last written to storage. Never holds uncommitted edits. */
	record: BrandRecord | null;
	/**
	 * An ordinal into `record.versions`, not an index. `BrandRecordSchema` forces ordinals to start
	 * at 1 and increase with no gaps, so the two differ by exactly one — but the ordinal is what a
	 * version actually carries, and storing the index would mean re-deriving it on every read.
	 */
	activeOrdinal: number | null;
	/** The seed being edited, uncommitted. Diverges from `versions[active].seed` until committed. */
	draftSeed: BrandSeed | null;
	preset: Interpretation;
	/**
	 * Recomputed from the draft seed and the preset on every change, and never persisted. Derivation
	 * is pure arithmetic, so caching it in a record would only create a second thing to keep true.
	 */
	derived: ScaleEngineResult | null;

	open(record: BrandRecord): void;
	close(): void;
	/** Drops uncommitted edits, the same as `discardEdits`. Confirming that is the caller's job. */
	selectVersion(ordinal: number): void;
	editSeed(patch: Partial<BrandSeed>): void;
	selectPreset(preset: Interpretation): void;
	discardEdits(): void;
	commit(provenance?: CommitProvenance): Promise<BrandRecord>;
};

export type WorkspaceStoreOptions = {
	recordStore: RecordStore;
	/** Injected so a test can count derivations and so #37 can swap an engine without a rewrite. */
	engine?: ScaleEngine;
	now?: () => string;
};

/**
 * Every field of a seed is nullable, so a seed that states nothing is a valid one. That is what a
 * record with no generated version starts from, and it means `editSeed` needs no separate "first
 * edit" path.
 *
 * Built from the schema's own keys rather than written out, so a field added to `BrandSeedSchema`
 * cannot leave a hole here that only shows up as a parse failure at commit time.
 */
function emptySeed(): BrandSeed {
	return BrandSeedSchema.parse(
		Object.fromEntries(Object.keys(BrandSeedSchema.shape).map((key) => [key, null])),
	);
}

function derive(
	engine: ScaleEngine,
	seed: BrandSeed | null,
	preset: Interpretation,
): ScaleEngineResult | null {
	return seed ? engine.generate(seed, PRESET_PARAMS[preset]) : null;
}

/**
 * The three fields a version dictates, in one piece. Opening a record, switching versions,
 * discarding edits, and closing all land on the same answer, and splitting it across four call
 * sites is how one of them ends up forgetting to re-derive.
 *
 * A null version is the empty case — a record with no history yet, or no record at all.
 */
function workspaceFor(
	engine: ScaleEngine,
	version: BrandVersion | null,
): Pick<WorkspaceState, 'draftSeed' | 'preset' | 'derived'> {
	const draftSeed = version?.seed ?? null;
	const preset = version?.interpretation ?? 'balanced';

	return { draftSeed, preset, derived: derive(engine, draftSeed, preset) };
}

function versionAt(record: BrandRecord, ordinal: number | null): BrandVersion | null {
	return ordinal === null ? null : (record.versions[ordinal - 1] ?? null);
}

/**
 * `rawResponse` drops to null rather than being carried. The new version was produced by
 * re-derivation in the workspace, and a response copied off its predecessor would read as evidence
 * that a model call it never made produced it.
 */
function carryProvenance(version: BrandVersion): CommitProvenance {
	return {
		provider: version.provider,
		model: version.model,
		promptVersion: version.promptVersion,
		rawResponse: null,
		fontTable: version.fontTable,
	};
}

/**
 * Workspace state — which record is open, which version is active, which seed edits are
 * uncommitted, which preset is selected — held apart from storage on purpose. A store that
 * persisted itself would have to be synchronous and infallible, and a `RecordStore` is neither:
 * today it rejects when the origin runs out of room, and a hosted one would reject for a dozen
 * more reasons. So the store calls the storage layer rather than becoming it, which is also why
 * there is no persistence middleware anywhere near this file.
 *
 * Built on `zustand/vanilla` rather than the React entry so the tests never load React. The store
 * under test is then the same object the app runs, not a hook-shaped stand-in for it.
 *
 * The `RecordStore` arrives injected and only its type is imported, so nothing here decides
 * whether records land in memory, in IndexedDB, or behind HTTP.
 */
export function createWorkspaceStore({
	recordStore,
	engine = createOklchScaleEngine(),
	now = () => new Date().toISOString(),
}: WorkspaceStoreOptions): StoreApi<WorkspaceState> {
	return createStore<WorkspaceState>()((set, get) => {
		async function appendVersion(provenance?: CommitProvenance): Promise<BrandRecord> {
			const { record, activeOrdinal, draftSeed, preset } = get();

			if (!record) {
				throw new Error('nothing to commit: no record is open');
			}

			const active = versionAt(record, activeOrdinal);
			const resolved = provenance ?? (active && carryProvenance(active));

			if (!resolved) {
				throw new Error(
					'committing the first version of a record needs provenance: there is none to carry forward',
				);
			}

			const version: BrandVersion = {
				...resolved,
				createdAt: now(),
				ordinal: record.versions.length + 1,
				seed: draftSeed,
				// Derived tokens are recomputed, never stored. Writing them would put the same facts in
				// two places and let a stored set outlive the engine that produced it.
				tokenSet: null,
				scaleEngine: engine.id,
				interpretation: preset,
			};

			// Append, never touch what is already there: a version is the record of what was generated
			// at a moment, and editing one rewrites history that a later version may cite.
			const next: BrandRecord = { ...record, versions: [...record.versions, version] };

			// Deliberately uncaught. A full origin arrives here as `StorageQuotaExceededError`, and
			// #39 can only offer to free room if it can tell that apart from a schema rejection —
			// which it cannot if this swallows either one. State is adopted only after the write
			// lands, so a rejected commit leaves the workspace showing what storage actually holds.
			await recordStore.put(next);

			// The draft and the derived tokens already say what was just written, so a commit moves
			// the record and the active version forward and nothing else.
			set({ record: next, activeOrdinal: version.ordinal });

			return next;
		}

		/**
		 * Commits run one at a time. An ordinal is counted off the record as it stands and `put`
		 * writes the record whole, so two overlapping commits would both claim the same ordinal and
		 * the second write would drop the first version on the floor. A double-click is enough to
		 * reach that, and the loss is silent. Queueing makes the second commit read what the first
		 * one wrote.
		 */
		let queue: Promise<unknown> = Promise.resolve();

		return {
			record: null,
			activeOrdinal: null,
			draftSeed: null,
			preset: 'balanced',
			derived: null,

			open(record) {
				// The last version is the current one — `BrandRecordSchema` guarantees the array runs
				// oldest first, and an empty history leaves nothing active until the first commit.
				const active = record.versions.at(-1) ?? null;

				set({ record, activeOrdinal: active?.ordinal ?? null, ...workspaceFor(engine, active) });
			},

			close() {
				set({ record: null, activeOrdinal: null, ...workspaceFor(engine, null) });
			},

			selectVersion(ordinal) {
				const { record } = get();
				const version = record && versionAt(record, ordinal);

				if (!version) {
					throw new Error(`no version with ordinal ${ordinal} in the open record`);
				}

				set({ activeOrdinal: ordinal, ...workspaceFor(engine, version) });
			},

			editSeed(patch) {
				const { draftSeed, preset } = get();
				const next = { ...(draftSeed ?? emptySeed()), ...patch };

				// No storage write. An edit is uncommitted by definition, and derivation is cheap enough
				// to run on every keystroke, which is the whole reason tokens are not stored.
				set({ draftSeed: next, derived: derive(engine, next, preset) });
			},

			selectPreset(preset) {
				const { draftSeed } = get();
				set({ preset, derived: derive(engine, draftSeed, preset) });
			},

			discardEdits() {
				const { record, activeOrdinal } = get();
				const active = record && versionAt(record, activeOrdinal);

				if (active) {
					set(workspaceFor(engine, active));
				}
			},

			commit(provenance) {
				// Both arms run the commit: a rejected one must not wedge every commit behind it.
				const run = queue.then(
					() => appendVersion(provenance),
					() => appendVersion(provenance),
				);

				// Swallowed for the queue's own bookkeeping only. `run` still rejects for the caller.
				queue = run.catch(() => undefined);

				return run;
			},
		};
	});
}
