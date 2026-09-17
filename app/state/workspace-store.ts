import { createStore, type StoreApi } from 'zustand/vanilla';

import type { BrandRecord, BrandVersion } from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';
import {
	BALANCED,
	type InterpretationParams,
	type ScaleEngine,
	type ScaleEngineResult,
} from '../../core/scale-engine';
import type { RecordStore } from '../storage/record-store';

export type Interpretation = BrandVersion['interpretation'];

/**
 * Faithful and Expressive have no numbers yet—`core/scale-engine.ts` ships Balanced alone and
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
 * from `BrandVersionSchema`—re-derivation with no model call. That version carries the active
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
	 * at 1 and increase with no gaps, so the two differ by exactly one, but the ordinal is what a
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
	/**
	 * Required rather than defaulted, so this module names the `ScaleEngine` type and never a
	 * concrete engine. `createOklchScaleEngine` reaches culori, and a default parameter would have
	 * put culori in the import graph of every caller, including the ones that load the engine
	 * lazily and would otherwise pay nothing.
	 *
	 * First-load gzip, measured against a throwaway `'use client'` `app/page.tsx` holding a stub
	 * `RecordStore`, budget 200 kB: that page alone is 187.1 kB, adding this store with the engine
	 * behind a dynamic import is 188.7 kB, and importing the engine statically instead is 196.5 kB.
	 * So the engine is 7.8 kB of the 24 kB of headroom ADR-0002 reserves, and whether that is
	 * affordable is the caller's question rather than this module's.
	 *
	 * `pnpm test:bundle` cannot answer it either way. The landing route is a Server Component today,
	 * so the engine runs at build time, reaches no client chunk, and the budget stays green no matter
	 * what this file imports. The guard is the import list, in `workspace-store.test.ts`.
	 */
	engine: ScaleEngine;
	now?: () => string;
};

/**
 * Every field of a seed is nullable, so a seed that states nothing is a valid one. That is what a
 * record with no generated version starts from, and it means `editSeed` needs no separate "first
 * edit" path.
 *
 * Written out rather than built from `BrandSeedSchema.shape`, which would have been shorter and
 * would have cost 93 kB: importing the schema for its keys pulls zod into every client chunk that
 * reaches this store. `BrandSeed` is inferred from that schema, so a field added upstream fails
 * this literal at typecheck, which is the drift the schema version was guarding against anyway.
 */
const EMPTY_SEED: BrandSeed = {
	keyColors: null,
	neutralTemperature: null,
	surfacePolarity: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

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
 * A null version is the empty case: a record with no history yet, or no record at all.
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
 * Structural rather than referential, because a seed edited back to what the model said is still
 * that model's seed and should still be able to carry its name forward.
 *
 * Key order does not count, since a seed can be rebuilt by any caller. Array order does: a seed's
 * key colours and font candidates are ranked, so a reordering is a different seed.
 */
function sameSeed(a: BrandSeed | null, b: BrandSeed | null): boolean {
	return sameJson(a, b);
}

/**
 * A seed holds primitives, arrays, and plain objects and nothing carrying an identity of its own,
 * so structural equality is a walk. The walk takes `unknown` even though `sameSeed` above does not,
 * because recursion loses the type immediately.
 *
 * Arrays are walked by index rather than through `every`, which skips holes: `[1, , 3]` and
 * `[1, 999, 3]` come back equal under `every`, and equal here means an edited seed keeps a model's
 * name. Nothing builds a sparse seed today, and that is the wrong thing to rest a false attribution
 * on.
 */
function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}

	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
		return false;
	}

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}

		for (let index = 0; index < a.length; index += 1) {
			if (!sameJson(a[index], b[index])) {
				return false;
			}
		}

		return true;
	}

	const keys = Object.keys(a);
	const other = b as Record<string, unknown>;

	return (
		keys.length === Object.keys(b).length &&
		keys.every(
			(key) =>
				Object.hasOwn(other, key) && sameJson((a as Record<string, unknown>)[key], other[key]),
		)
	);
}

/**
 * Only ever called for a commit whose seed still matches the version it came from, which is what
 * makes carrying the model's name honest.
 *
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
 * Workspace state—which record is open, which version is active, which seed edits are
 * uncommitted, which preset is selected—held apart from storage on purpose. A store that
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
	engine,
	now = () => new Date().toISOString(),
}: WorkspaceStoreOptions): StoreApi<WorkspaceState> {
	return createStore<WorkspaceState>()((set, get) => {
		async function appendVersion(provenance?: CommitProvenance): Promise<BrandRecord> {
			const startedIn = session;
			const { record, activeOrdinal, draftSeed, preset } = get();

			if (!record) {
				throw new Error('nothing to commit: no record is open');
			}

			const active = versionAt(record, activeOrdinal);
			let resolved = provenance;

			if (!resolved) {
				if (!active) {
					throw new Error(
						'committing the first version of a record needs provenance: there is none to carry forward',
					);
				}

				// Carrying `provider`, `model` and `promptVersion` onto a seed somebody typed would
				// credit a model with work it never did, and nothing downstream can catch it:
				// `BrandRecordSchema` accepts the version, and it reads as generated ever after.
				// `rawResponse` decays to null on its own; these three do not, so the caller has to say
				// where an edited seed came from.
				if (!sameSeed(draftSeed, active.seed)) {
					throw new Error(
						'this commit edits the seed, so it needs explicit provenance: no model produced this seed',
					);
				}

				resolved = carryProvenance(active);
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
			// #39 can only offer to free room if it can tell that apart from a schema rejection,
			// which it cannot if this swallows either one. State is adopted only after the write
			// lands, so a rejected commit leaves the workspace showing what storage actually holds.
			await recordStore.put(next);

			// Adopt the write only while the workspace is still the session that started it. `open` and
			// `close` are synchronous and unqueued, so either can land while `put` is in flight, and
			// reinstating this record afterwards would pair it with a newer record's draft and preset:
			// one workspace showing two records at once. The write itself stands either way, which is
			// why the finished record still goes back to the caller.
			if (session === startedIn) {
				// The draft and the derived tokens already say what was just written, so a commit moves
				// the record and the active version forward and nothing else.
				set({ record: next, activeOrdinal: version.ordinal });
			}

			return next;
		}

		/**
		 * Commits run one at a time within this store. An ordinal is counted off the record as it
		 * stands and `put` writes the record whole, so two overlapping commits would both claim the
		 * same ordinal and the second write would drop the first version on the floor. A double-click
		 * is enough to reach that, and the loss is silent. Queueing makes the second commit read what
		 * the first one wrote.
		 *
		 * It serialises this store and nothing else. Two tabs hold two stores and two queues, and
		 * `RecordStore.put` replaces a whole record with no compare-and-swap, so the same collision
		 * is still reachable across tabs. Closing that needs optimistic concurrency at the
		 * `RecordStore` seam, which no open ticket owns yet.
		 */
		let queue: Promise<unknown> = Promise.resolve();

		/**
		 * Counts how many times the workspace has been pointed somewhere, so a commit can tell whether
		 * it is still finishing the session it began in.
		 *
		 * The record itself cannot answer that. `RecordStore` hands back a fresh object graph on every
		 * read, so a caller reloading the same record mid-commit looks like a different record, while
		 * closing and reopening the same object looks like never having left. Counting the moves is
		 * exact where comparing the records is wrong in both directions.
		 */
		let session = 0;

		return {
			record: null,
			activeOrdinal: null,
			draftSeed: null,
			preset: 'balanced',
			derived: null,

			open(record) {
				// The last version is the current one—`BrandRecordSchema` guarantees the array runs
				// oldest first, and an empty history leaves nothing active until the first commit.
				const active = record.versions.at(-1) ?? null;

				session += 1;
				set({ record, activeOrdinal: active?.ordinal ?? null, ...workspaceFor(engine, active) });
			},

			close() {
				session += 1;
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
				const next = { ...(draftSeed ?? EMPTY_SEED), ...patch };

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

				// A record with no versions yet has nothing to restore to, so discarding empties the
				// workspace, which is the state `open` leaves it in. Returning early on a null active
				// version instead would strand every edit made before the first commit, which is the
				// one stretch where a user has no way back.
				set(workspaceFor(engine, record && versionAt(record, activeOrdinal)));
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
