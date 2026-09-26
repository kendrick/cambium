import { createStore, type StoreApi } from 'zustand/vanilla';

import type { BrandRecord, BrandVersion } from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';
import { checkContrast, type ContrastEntry } from '../../core/contrast/check';
import { type UnrepairedEntry, withContrastRepairs } from '../../core/contrast/repair';
import { type ScaleEngine, type ScaleEngineResult } from '../../core/scale-engine';
import { BALANCED, type InterpretationParams } from '../../core/interpretation';
import { repairPinsFor, type SeedPinPath } from '../../core/seed-pins';
import { buildTokenSet } from '../../core/semantic-layer';
import {
	applyOverrides,
	type OverrideIssue,
	overrideKey,
	type TokenOverride,
} from '../../core/token-overrides';
import type { TokenSet } from '../../core/token-set';
import type { RecordStore } from '../storage/record-store';

export type Interpretation = BrandVersion['interpretation'];

/**
 * Faithful and Expressive have no numbers yet—`core/interpretation.ts` ships Balanced alone and
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

/**
 * Thrown when the record's newest version is stamped ahead of this device's clock, which
 * `BrandRecordSchema` refuses to let anything follow.
 *
 * A class rather than a bare `Error` because the throw site's argument for catching this at all
 * depends on a caller being able to tell it apart, and matching a message string is not telling
 * apart. `kind` follows the same discriminated-error convention as `StorageQuotaExceededError` in
 * `app/storage/storage-estimate.ts`.
 *
 * `stampedAt` is the instant nothing may precede, which the quota error has no equivalent of. A
 * caller can say when committing becomes possible again without parsing it out of the message.
 */
export class RecordStampedAheadError extends Error {
	readonly kind = 'record-stamped-ahead';
	readonly stampedAt: string;

	constructor(stampedAt: string, options?: { cause?: unknown }) {
		super(
			`the record's newest version is stamped ${stampedAt}, ahead of this device's clock, so nothing can follow it yet`,
			options,
		);
		this.name = 'RecordStampedAheadError';
		this.stampedAt = stampedAt;
	}
}

/**
 * Thrown when the workspace was pointed somewhere else before a queued commit could run, so nothing
 * was written.
 *
 * Typed for the same reason as the two below, and the reason is worth stating because it is what
 * separates the three typed errors here from the four bare ones. A bare `Error` marks a call the
 * interface should not have made: committing with nothing open, committing a first version with no
 * provenance, committing an edited seed without saying where it came from, selecting an ordinal the
 * record does not hold. The caller could have avoided each by reading state it already had.
 *
 * This is not that. Nobody did anything wrong: the user navigated while a commit was queued, and the
 * caller needs to tell an abandoned commit from a failed one, because the recovery is to say nothing
 * at all rather than to report an error.
 */
export class CommitAbandonedError extends Error {
	readonly kind = 'commit-abandoned';

	constructor(options?: { cause?: unknown }) {
		super('the workspace moved on before this commit ran, so nothing was written', options);
		this.name = 'CommitAbandonedError';
	}
}

/**
 * Thrown when a commit would append to a record this store has already written further along.
 *
 * A workspace can fall behind its own writes. Adoption is skipped whenever the workspace moved
 * while a write was in flight, so reopening a record from an object held since before that write
 * leaves the store showing fewer versions than storage holds. Appending from there recounts an
 * ordinal that already exists, from a revision storage has already moved past.
 *
 * `RecordStore.put` would refuse that write with `StaleRecordWriteError`, so nothing is lost either
 * way. This check runs first and refuses it without a round trip, for exactly the records this
 * store wrote past, by object identity, so a record deleted and recreated under the same id is
 * unaffected.
 *
 * Storage is what catches the rest. Every `RecordStore.get` returns a fresh object graph, so a stale
 * copy loaded through a separate `get` is a different object holding the same old history and
 * nothing here recognises it. It still carries the revision it was read at, so `put` refuses it,
 * and refuses a stale commit from a second tab on the same grounds. Both hold while the record is
 * still stored. After a `delete`, `put` takes a stale commit as an insert, as the module docblock
 * in `app/storage/record-store.ts` describes.
 *
 * Typed for the same reason as `RecordStampedAheadError`: the caller has a specific recovery, which
 * is to reload the record and commit again, and it can only choose it if it can tell this apart
 * from the misuse the other guards catch. `recordId` says what to reload, and is all this carries.
 *
 * It deliberately reports no version count. Anything this store could offer would be what it wrote
 * rather than what storage holds, and another tab may have written since, so it would be right only
 * when nothing else wrote and quietly approximate otherwise, which a caller cannot tell apart. The
 * reload is what learns the truth, from the only place it exists.
 */
export class StaleWorkspaceError extends Error {
	readonly kind = 'stale-workspace';
	readonly recordId: string;

	constructor(recordId: string, options?: { cause?: unknown }) {
		super(
			`this workspace is behind a write already made to record ${recordId}, so reload it and commit again`,
			options,
		);
		this.name = 'StaleWorkspaceError';
		this.recordId = recordId;
	}
}

/**
 * Thrown when `setOverride` is handed an override the derived set cannot take, such as an alias to
 * a step outside its ramp. Nothing is stored.
 *
 * Typed because a person at a control supplied the value, and the list has to mark that control
 * and say why. `key` and `issues` carry both, so no caller parses the message.
 */
export class OverrideRejectedError extends Error {
	readonly kind = 'override-rejected';
	readonly key: string;
	readonly issues: OverrideIssue[];

	constructor(key: string, issues: OverrideIssue[], options?: { cause?: unknown }) {
		super(`override ${key} does not apply: ${issues.map((i) => i.message).join('; ')}`, options);
		this.name = 'OverrideRejectedError';
		this.key = key;
		this.issues = issues;
	}
}

/**
 * A commit frozen at the moment it was requested: what the new version holds, plus the two counters
 * that decide afterwards whether the finished write still belongs to the workspace on screen.
 * `session` and `selection` are bookkeeping and reach no stored field.
 *
 * Only the record a commit appends to is read later, because that has to reflect any commit that
 * got there first.
 */
type CommitRequest = {
	provenance: CommitProvenance | undefined;
	session: number;
	selection: number;
	activeOrdinal: number | null;
	draftSeed: BrandSeed | null;
	preset: Interpretation;
	overrides: Record<string, TokenOverride>;
	draftPins: SeedPinPath[];
};

/**
 * `checkContrast`'s report against the token set the workspace is showing right now, alongside the
 * pairs #8's repair pass couldn't clear. `report` reflects the final set, overrides included, so a
 * user override that re-breaks a pair a repair already fixed shows up as a failing entry instead of
 * disappearing behind the repair that ran before it. `unrepaired` comes from the repair pass on the
 * pre-override set: which pairs it couldn't reach is a question about pins, not about what the user
 * later did to an unrelated token.
 */
export type ContrastState = {
	report: ContrastEntry[];
	unrepaired: UnrepairedEntry[];
};

export type WorkspaceState = {
	/**
	 * The record as storage last reported it. Never holds uncommitted edits.
	 *
	 * After a commit the workspace adopts, this is the record `RecordStore.put` resolved with, so it
	 * matches what storage holds. The record this store proposed would not: `put` stamps the revision,
	 * and `BrandSeedSchema` canonicalises values that have two spellings, so a hue committed as 360
	 * comes back as 0 and is held here as 0. Adopting what `put` returns saves a `get` after every
	 * write.
	 *
	 * `open` takes whatever record the caller hands it, so what this holds before the first commit
	 * is only as current as that record.
	 */
	record: BrandRecord | null;
	/**
	 * An ordinal into `record.versions`, not an index. `BrandRecordSchema` forces ordinals to start
	 * at 1 and increase with no gaps, so the two differ by exactly one, but the ordinal is what a
	 * version actually carries, and storing the index would mean re-deriving it on every read.
	 */
	activeOrdinal: number | null;
	/** The seed being edited, uncommitted. Diverges from `versions[active].seed` until committed. */
	draftSeed: BrandSeed | null;
	/**
	 * The pins being edited, uncommitted, the same way `draftSeed` is. Canonical: deduplicated and
	 * sorted, so toggling a pin on and back off leaves this identical to never having toggled it, and
	 * two paths that arrive at the same pinned set commit the same array rather than two spellings of
	 * it. `keyof` order would do neither, since it depends on which order a person clicked in.
	 */
	draftPins: SeedPinPath[];
	preset: Interpretation;
	/**
	 * Recomputed from the draft seed and the preset on every change, and never persisted. Derivation
	 * is pure arithmetic, so caching it in a record would only create a second thing to keep true.
	 */
	derived: ScaleEngineResult | null;
	/**
	 * The user's edits on top of the derived set, keyed by `overrideKey`, in the order they were first
	 * made. Draft state like `draftSeed`: `editSeed` and `selectPreset` keep them, and everything that
	 * resets the draft to a version (`open`, `close`, `selectVersion`, `discardEdits`) replaces them
	 * with that version's stored `overrides`.
	 *
	 * `commit` writes them onto the new version as a list in this order, and still writes
	 * `tokenSet: null`. The overrides are the user's input and the token set is arithmetic on it, so
	 * only the input is stored.
	 */
	overrides: Record<string, TokenOverride>;
	/**
	 * `derived` built into a full token set with `overrides` applied, recomputed wherever `derived`
	 * is. Null whenever `derived` is null or not ok, since there are no ramps to build from.
	 */
	tokenSet: TokenSet | null;
	/**
	 * Held overrides the current derivation rejects, keyed like `overrides`. Empty unless a seed edit
	 * or preset switch moved the base out from under an override that applied when it was set.
	 *
	 * The engine emits the same ramp names and token paths for every seed today, so this stays empty
	 * with the real engine. If a future base does change shape, the store skips the override it can't
	 * apply, keeps it in `overrides`, and applies it again once the base can take it. `editSeed`
	 * doesn't throw, and nothing the user set is deleted.
	 */
	overrideIssues: Record<string, OverrideIssue[]>;
	/** `null` exactly when `tokenSet` is, since there is nothing yet to check. See `ContrastState`. */
	contrast: ContrastState | null;

	open(record: BrandRecord): void;
	close(): void;
	/** Drops uncommitted edits, the same as `discardEdits`. Confirming that is the caller's job. */
	selectVersion(ordinal: number): void;
	editSeed(patch: Partial<BrandSeed>): void;
	/** Adds the pin if it's absent, removes it if it's present. Leaves `draftSeed` untouched. */
	togglePin(path: SeedPinPath): void;
	/**
	 * Replaces `draftPins` outright, for the one caller that isn't toggling one field at a time:
	 * generation seeds every key colour's pin in one move, because every key colour it writes came
	 * from an image (`app/generation/generate.ts`). Nothing in the rail calls this; a person only
	 * ever has one field to toggle at a time.
	 */
	setDraftPins(pins: SeedPinPath[]): void;
	selectPreset(preset: Interpretation): void;
	discardEdits(): void;
	commit(provenance?: CommitProvenance): Promise<BrandRecord>;
	/**
	 * Replaces any override on the same target. Throws `OverrideRejectedError` and changes nothing
	 * when the derived set cannot take it, and a bare `Error` when nothing is derived to override.
	 */
	setOverride(override: TokenOverride): void;
	/** A key nothing holds is a no-op, so a stale control cannot throw. */
	clearOverride(key: string): void;
};

export type WorkspaceStoreOptions = {
	recordStore: RecordStore;
	/**
	 * Required rather than defaulted, so this module names the `ScaleEngine` type and never a
	 * concrete engine. A default would no longer keep culori or zod out of a caller's graph: building
	 * `tokenSet` imports `core/semantic-layer.ts`, which reaches culori through `core/oklch.ts`, and
	 * `core/token-overrides.ts`, which reaches zod. Injecting the engine still keeps the code in
	 * `core/oklch-scale-engine.ts` out of every caller that doesn't import it, and lets a test hand in
	 * a stub engine to produce a base the real engine never emits.
	 *
	 * `components/workspace/workspace-route.tsx` loads this store lazily, beside the engine and
	 * storage chunks that bring the same two libraries, so that route pays nothing extra for them. A
	 * client component that imports this store statically pays for both in first-load.
	 *
	 * First-load gzip, measured before this store built `tokenSet`, against a throwaway
	 * `'use client'` `app/page.tsx` holding a stub `RecordStore`, budget 200 kB: that page alone was
	 * 187.1 kB, adding this store with the engine behind a dynamic import was 188.7 kB, and importing
	 * the engine statically instead was 196.5 kB. Part of that 7.8 kB gap was culori, which this
	 * store now brings on its own, so the gap overstates what a static engine import adds today.
	 *
	 * `pnpm test:bundle` cannot measure it either way. The landing route is a Server Component today,
	 * so the engine runs at build time, reaches no client chunk, and the budget stays green no matter
	 * what this file imports. The guard is the import list, in `workspace-store.test.ts`.
	 *
	 * #8's contrast repair rides the same lazy chunk. `core/contrast/check.ts` reaches `chroma-js`'s
	 * APCA module, but this store is only ever reached through the same dynamic
	 * `import('../../app/state/workspace-store')` in `workspace-route.tsx` that already carries the
	 * engine and culori, and the landing route never imports this file at all. Nothing about that
	 * import graph is unconditional the way `engine` is, so it needs no injection seam of its own.
	 * `pnpm test:bundle`'s total-JS budget is what catches `chroma-js` growing the shipped bundle,
	 * since first load stays unaffected either way.
	 */
	engine: ScaleEngine;
	now?: () => string;
};

/**
 * Every field of a seed is nullable, so a seed that states nothing is a valid one. That is what a
 * record with no generated version starts from, and it means `editSeed` needs no separate "first
 * edit" path.
 *
 * Building this from `BrandSeedSchema.shape` would cost nothing extra in the bundle, since this
 * store reaches zod through `core/token-overrides.ts` either way. The literal is still safe to keep:
 * `BrandSeed` is inferred from the schema, so a field added upstream fails this literal at
 * typecheck.
 */
const EMPTY_SEED: BrandSeed = {
	keyColors: null,
	neutralTemperature: null,
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
 * Deduplicated and sorted, so a pin toggled on and back off leaves `draftPins` identical to having
 * never touched it, rather than reordered by whichever field the person happened to click. Without
 * this, two sessions that end up protecting the same fields could commit two different arrays, and
 * `repairedBase`'s cache below would treat them as two different requests worth recomputing.
 *
 * Plain string sort, since `SeedPinPath` is always a bare field name or `keyColors.<n>`: nothing
 * here needs numeric ordering to be stable, only to be the same ordering every time.
 *
 * Exported with `samePins` so the rail judges a pin toggle dirty by the same comparison the
 * store's commit uses. Two copies that only agree by luck are the divergent mirror in
 * `docs/agents/testing.md`'s #75 row.
 */
export function canonicalPins(pins: readonly SeedPinPath[]): SeedPinPath[] {
	// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh, so `sort` mutates
	// nothing a caller holds.
	// oxlint-disable-next-line unicorn/no-array-sort
	return [...new Set(pins)].sort();
}

/** True when two canonical pin lists name the same fields in the same order. */
export function samePins(a: readonly SeedPinPath[], b: readonly SeedPinPath[]): boolean {
	return a.length === b.length && a.every((pin, index) => pin === b[index]);
}

type Derivation = Pick<WorkspaceState, 'derived' | 'tokenSet' | 'overrideIssues' | 'contrast'>;

/**
 * Applies each override on its own so one the base rejects is skipped and reported rather than
 * failing the rest. `applyOverrides` stops at the first failure, which is right for validating one
 * new edit and wrong for re-applying a set the user built up against an older base.
 */
function withOverrides(
	base: TokenSet,
	overrides: Record<string, TokenOverride>,
): { tokenSet: TokenSet; overrideIssues: Record<string, OverrideIssue[]> } {
	let tokenSet = base;
	const overrideIssues: Record<string, OverrideIssue[]> = {};

	for (const override of Object.values(overrides)) {
		const result = applyOverrides(tokenSet, [override]);

		if (result.ok) {
			tokenSet = result.tokenSet;
		} else {
			overrideIssues[result.key] = result.issues;
		}
	}

	return { tokenSet, overrideIssues };
}

/**
 * `repairContrast` walks a bounded lightness search per failing pair. `setOverride` and
 * `clearOverride` both reuse the `derived` already held rather than re-deriving, so without this
 * cache a session of override edits would re-run that search on every keystroke for a repair
 * nothing had changed. Keyed on `derived` rather than on the base `TokenSet` `buildTokenSet`
 * returns, because that call produces a fresh object every time and leaves nothing to key on that
 * survives past its own call; `derived` is the one thing every caller here already holds across
 * such a sequence.
 *
 * `ScaleEngine.generate`'s contract never promises a fresh object per call, and `buildTokenSet`
 * also reads `seed` directly for the non-colour categories. An engine that memoizes, or a test fake
 * that hands back the same `derived` for two different seeds, would otherwise serve a stale
 * repaired set for the second one. So each cache entry also carries the seed, preset and pins that
 * produced it, and a lookup that doesn't match all three recomputes instead of trusting `derived`'s
 * identity alone.
 *
 * Pins joined the key in #25: a toggled pin changes what `repairPinsFor` protects without touching
 * `seed`, `preset`, or `derived`'s identity, so leaving pins out would serve a repair computed for
 * the wrong pinned set the moment someone toggled one.
 */
const repairCache = new WeakMap<
	Extract<ScaleEngineResult, { ok: true }>,
	{
		seed: BrandSeed;
		preset: Interpretation;
		pins: SeedPinPath[];
		repaired: TokenSet;
		unrepaired: UnrepairedEntry[];
	}
>();

function repairedBase(
	derived: Extract<ScaleEngineResult, { ok: true }>,
	seed: BrandSeed,
	preset: Interpretation,
	pins: SeedPinPath[],
): { repaired: TokenSet; unrepaired: UnrepairedEntry[] } {
	const cached = repairCache.get(derived);

	if (
		cached &&
		cached.preset === preset &&
		sameSeed(cached.seed, seed) &&
		samePins(cached.pins, pins)
	) {
		return cached;
	}

	const base = buildTokenSet(derived.schemes, seed, PRESET_PARAMS[preset]);
	const pinned = repairPinsFor(seed, pins);
	const { tokenSet, unrepaired } = withContrastRepairs(base, { pinned });
	const result = { seed, preset, pins, repaired: tokenSet, unrepaired };

	repairCache.set(derived, result);

	return result;
}

/**
 * Repairs land before the user's overrides, so exports and the preview are AA by default and a
 * user override that breaks a pair is the user's own call (#8's decisions). With no user overrides,
 * the repaired set is returned as-is; `applyOverrides` still runs once for the repair regardless,
 * but a workspace holding none skips the second parse a user override would otherwise cost.
 *
 * `contrast.report` is checked against the *final* set, overrides included, so a user override that
 * re-breaks a pair a repair already cleared shows up rather than reading as still fixed.
 */
function tokensFor(
	derived: ScaleEngineResult | null,
	seed: BrandSeed | null,
	preset: Interpretation,
	overrides: Record<string, TokenOverride>,
	pins: SeedPinPath[],
): Pick<WorkspaceState, 'tokenSet' | 'overrideIssues' | 'contrast'> {
	if (!seed || !derived?.ok) {
		return { tokenSet: null, overrideIssues: {}, contrast: null };
	}

	const { repaired, unrepaired } = repairedBase(derived, seed, preset, pins);
	const { tokenSet, overrideIssues } =
		Object.keys(overrides).length === 0
			? { tokenSet: repaired, overrideIssues: {} }
			: withOverrides(repaired, overrides);

	return { tokenSet, overrideIssues, contrast: { report: checkContrast(tokenSet), unrepaired } };
}

/** Every place that re-derives goes through here, so `tokenSet` cannot fall behind `derived`. */
function derivation(
	engine: ScaleEngine,
	seed: BrandSeed | null,
	preset: Interpretation,
	overrides: Record<string, TokenOverride>,
	pins: SeedPinPath[],
): Derivation {
	const derived = derive(engine, seed, preset);

	return { derived, ...tokensFor(derived, seed, preset, overrides, pins) };
}

/**
 * The four fields a version dictates, in one piece. Opening a record, switching versions,
 * discarding edits, and closing all land on the same answer, and splitting it across four call
 * sites is how one of them ends up forgetting to re-derive.
 *
 * A null version is the empty case: a record with no history yet, or no record at all.
 */
function workspaceFor(
	engine: ScaleEngine,
	version: BrandVersion | null,
): Pick<WorkspaceState, 'draftSeed' | 'preset' | 'overrides' | 'draftPins'> & Derivation {
	const draftSeed = version?.seed ?? null;
	const preset = version?.interpretation ?? 'balanced';
	// Landing on a version takes its stored overrides and drops the draft's, the same as the seed.
	// Keeping the draft's would apply one version's edits to another version's tokens. The schema
	// refuses a repeated key, so keying loses nothing, and a stored override this base can't take
	// ends up in `overrideIssues` rather than throwing.
	const overrides = Object.fromEntries(
		(version?.overrides ?? []).map((override) => [overrideKey(override), override]),
	);
	// Canonicalised on the way in, not just on the way out of `togglePin`: nothing here guarantees a
	// stored version's own `pins` arrived deduplicated and sorted, and the repair cache above trusts
	// `samePins` to compare two canonical lists rather than doing a set comparison itself.
	const pins = canonicalPins(version?.pins ?? []);

	return {
		draftSeed,
		preset,
		overrides,
		draftPins: pins,
		...derivation(engine, draftSeed, preset, overrides, pins),
	};
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
 *
 * Exported because the rail's own "is this dirty" check needs the identical walk `sameSeed` runs
 * before it decides whether a commit needs provenance: a rail that judged dirtiness by a slightly
 * different equality could show Save enabled for an edit the store's own guard then refuses.
 */
export function sameJson(a: unknown, b: unknown): boolean {
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
		async function appendVersion(request: CommitRequest): Promise<BrandRecord> {
			const { provenance, activeOrdinal, draftSeed, preset, overrides, draftPins } = request;

			// A queued commit belongs to the workspace that asked for it. `commit` captures the request
			// synchronously and this body runs a turn later at the earliest, so by now the workspace can
			// be somewhere else entirely, and appending here would write the commit into whichever
			// record happens to be open, provenance and all.
			if (session !== request.session) {
				throw new CommitAbandonedError();
			}

			// The record is the one thing read fresh rather than captured, because it says where the
			// version goes rather than what it holds. A commit queued behind another has to count its
			// ordinal off what that one wrote, which is the whole reason the queue exists. Ordinals are
			// stable under appending, so the requested `activeOrdinal` still names the same version here.
			const { record } = get();

			if (!record) {
				throw new Error('nothing to commit: no record is open');
			}

			if (superseded.has(record)) {
				throw new StaleWorkspaceError(record.id);
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
				//
				// Overrides don't count as an edit here. They leave the seed alone, so the model still
				// produced everything they sit on, and the version's own `overrides` list records what
				// the user changed.
				if (!sameSeed(draftSeed, active.seed)) {
					throw new Error(
						'this commit edits the seed, so it needs explicit provenance: no model produced this seed',
					);
				}

				resolved = carryProvenance(active);
			}

			const previous = record.versions.at(-1);
			const createdAt = now();

			// `BrandRecordSchema` rejects a version stamped before the one it follows, so a record whose
			// newest version is stamped ahead of this clock cannot be committed to at all. Refusing here
			// rather than letting the schema reject inside `put` is the trade the quota error makes one
			// screen down: a caller can only explain a clock conflict it can tell apart from a
			// malformed record.
			//
			// Stamping the previous instant instead lets the commit through, and was the first fix
			// tried. It writes a `createdAt` that does not say when the version was made, which is the
			// one thing that field is for, and it compounds, because every later commit then clamps to
			// the same future instant until the clock catches up. Letting a record be committed to after
			// its clock is corrected is a repair on the stored record, which `core/` owns.
			if (previous && Date.parse(createdAt) < Date.parse(previous.createdAt)) {
				throw new RecordStampedAheadError(previous.createdAt);
			}

			const version: BrandVersion = {
				...resolved,
				createdAt,
				ordinal: record.versions.length + 1,
				seed: draftSeed,
				// Derived tokens are recomputed, never stored. Writing them would put the same facts in
				// two places and let a stored set outlive the engine that produced it. The overrides are
				// stored instead, because they are the user's input the way the seed is the model's.
				tokenSet: null,
				overrides: Object.values(overrides),
				// The draft's own pins, not the active version's: a pin toggle is an uncommitted edit like
				// `draftSeed` or an override, so it has to ride the same commit that captured it rather than
				// the one the workspace happened to have open. Canonical already, from every path that sets
				// `draftPins`, so this is the array the schema's own out-of-range check runs against.
				pins: draftPins,
				scaleEngine: engine.id,
				interpretation: preset,
			};

			// Append, never touch what is already there: a version is the record of what was generated
			// at a moment, and editing one rewrites history that a later version may cite. `revision`
			// rides along untouched, because it names the revision this copy was read at and `put`
			// compares the write against that. Advancing it here would claim to have been read at a
			// revision this workspace never saw, and `put` would refuse the write.
			const proposed: BrandRecord = {
				...record,
				versions: [...record.versions, version],
			};

			// Deliberately uncaught. A full origin arrives here as `StorageQuotaExceededError`, and
			// #39 can only offer to free room if it can tell that apart from a schema rejection,
			// which it cannot if this swallows either one. State is adopted only after the write
			// lands, so a rejected commit leaves the workspace showing what storage actually holds.
			//
			// The resolved record rather than the proposed one from here on: storage stamps the
			// revision, so `proposed` still carries the base it was built from, and a workspace that
			// kept it would commit from that same base again and be refused.
			const next = await recordStore.put(proposed);

			// Recorded whether or not the workspace adopts it below, because what storage holds does not
			// depend on where the workspace wandered off to while the write was in flight. This record
			// is now definitively behind storage, and anything that commits from it again would recount
			// an ordinal that exists and write a record missing a version.
			superseded.set(record, next);

			// Adopt the write only while the workspace is still the session that started it. `open` and
			// `close` are synchronous and unqueued, so either can land while `put` is in flight, and
			// reinstating this record afterwards would pair it with a newer record's draft and preset:
			// one workspace showing two records at once. The write itself stands either way, which is
			// why the finished record still goes back to the caller.
			if (session === request.session) {
				// Taking the record is always right, because it is the one just written. Moving the active
				// version is not: re-pointing the view stays inside the session, so it can land mid-write,
				// and overriding it would leave the workspace naming the new version while showing the
				// seed and preset of the version the user actually chose.
				const reselected = selection !== request.selection;

				if (reselected) {
					set({ record: next });
				} else {
					// Identity, not `sameSeed`: asks whether `editSeed` landed mid-write. `editSeed`
					// always builds a new object, so identity catches a real edit even when its values
					// happen to match what was there before.
					const editedMidWrite = get().draftSeed !== request.draftSeed;
					const newVersion = editedMidWrite ? null : versionAt(next, version.ordinal);

					// Storage can hand back a canonical spelling of the seed, so a hue committed as 360 is
					// held as 0. Left at 360, the draft would make the next provenance-free commit read a
					// no-op as an edit and refuse it. So the draft takes the stored seed, but only when the
					// two differ, and never over an edit that landed mid-write, which is the user's. The
					// ramps built from either spelling match, but the anchor report records the hue
					// actually requested—so `derived` is recomputed from the adopted seed too, to keep the
					// two consistent.
					const adopted =
						newVersion && !sameSeed(newVersion.seed, request.draftSeed) ? newVersion.seed : null;

					set({
						record: next,
						activeOrdinal: version.ordinal,
						...(adopted
							? {
									draftSeed: adopted,
									...derivation(engine, adopted, get().preset, get().overrides, get().draftPins),
								}
							: {}),
					});
				}
			}

			return next;
		}

		/**
		 * Commits run one at a time within this store. An ordinal is counted off the record as it
		 * stands, so two overlapping commits would both build on the same base and claim the same
		 * ordinal. `put` would take the first and refuse the second with `StaleRecordWriteError`, so a
		 * double-click would fail a commit the user asked for. Queueing makes the second commit read
		 * what the first one wrote.
		 *
		 * It serialises this store and nothing else. Two tabs hold two stores and two queues, and a
		 * stale copy re-read inside one tab sits outside this queue's knowledge too. Neither loses a
		 * version: `RecordStore.put` refuses a write whose revision is not the one storage holds, so
		 * the second of two colliding commits rejects with `StaleRecordWriteError` instead of
		 * replacing the first. The queue is what keeps a double-click inside one store from reaching
		 * that refusal at all.
		 */
		let queue: Promise<unknown> = Promise.resolve();

		/**
		 * Every record this store has appended to, mapped to what superseded it.
		 *
		 * Keyed on the record object rather than its id, which matters in both directions. A record
		 * deleted and recreated under the same id is a different object, so it commits normally, where
		 * keying on the id would refuse its first commit forever. And an object that has been written
		 * past stays recognisable however the workspace gets back to it, including through a `close`
		 * and a fresh `open`, which a check against whatever is currently open would miss.
		 *
		 * A `WeakMap` because the entry is only ever reachable through a record somebody still holds,
		 * so there is nothing to evict and no way for this to grow past what the caller keeps alive.
		 *
		 * Object identity is the most this store can key on, and it is not enough on its own. A record
		 * re-read through `RecordStore.get` arrives as a new object, so a stale copy fetched that way
		 * slips past this map and is refused by `RecordStore.put` instead. See `StaleWorkspaceError`.
		 */
		const superseded = new WeakMap<BrandRecord, BrandRecord>();

		/**
		 * Two counters answering two questions a finished commit has to ask.
		 *
		 * `session` is which record is open, and only `open` and `close` move it. A commit that comes
		 * back to a different record must not be adopted at all. The record itself cannot answer this:
		 * `RecordStore` hands back a fresh object graph on every read, so a caller reloading the same
		 * record mid-commit looks like a different record, while closing and reopening the same object
		 * looks like never having left. Counting the moves is exact where comparing records is wrong in
		 * both directions.
		 *
		 * `selection` is which version the workspace is pointed at, moved by `selectVersion` and
		 * `discardEdits`, which both re-point the view without leaving the record. A commit that comes
		 * back to a different version of the same record still belongs to that record, so the write is
		 * taken and the user's choice of version is left alone.
		 *
		 * `editSeed` deliberately moves neither. Editing on top of a version that was just committed is
		 * the ordinary state, not a conflict, so that commit still moves the workspace forward.
		 */
		let session = 0;
		let selection = 0;

		return {
			record: null,
			activeOrdinal: null,
			draftSeed: null,
			draftPins: [],
			preset: 'balanced',
			derived: null,
			overrides: {},
			tokenSet: null,
			overrideIssues: {},
			contrast: null,

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

				selection += 1;
				set({ activeOrdinal: ordinal, ...workspaceFor(engine, version) });
			},

			editSeed(patch) {
				const { draftSeed, preset, overrides, draftPins } = get();
				const next = { ...(draftSeed ?? EMPTY_SEED), ...patch };

				// Pins ride along unchanged. A pin names a field, not a value, so editing the value under
				// a pinned field—recolouring a key colour, say—leaves the pin exactly where it was; #25's
				// decisions cover the case where that field's `proposedRole` moves it to a different step.
				// No storage write either way. An edit is uncommitted by definition, and derivation is
				// cheap enough to run on every keystroke, which is the whole reason tokens are not stored.
				set({ draftSeed: next, ...derivation(engine, next, preset, overrides, draftPins) });
			},

			togglePin(path) {
				const { draftSeed, preset, overrides, draftPins } = get();
				const next = draftPins.includes(path)
					? draftPins.filter((pin) => pin !== path)
					: canonicalPins([...draftPins, path]);

				set({ draftPins: next, ...derivation(engine, draftSeed, preset, overrides, next) });
			},

			setDraftPins(pins) {
				const { draftSeed, preset, overrides } = get();
				const next = canonicalPins(pins);

				set({ draftPins: next, ...derivation(engine, draftSeed, preset, overrides, next) });
			},

			selectPreset(preset) {
				const { draftSeed, overrides, draftPins } = get();
				set({ preset, ...derivation(engine, draftSeed, preset, overrides, draftPins) });
			},

			setOverride(override) {
				const { draftSeed, preset, derived, overrides, draftPins } = get();

				if (!draftSeed || !derived?.ok) {
					throw new Error('nothing is derived to override');
				}

				const key = overrideKey(override);
				const next = { ...overrides, [key]: override };
				// The ramps don't depend on overrides, so the derivation already held is reused rather than
				// running the engine again for an edit that cannot change it.
				const result = tokensFor(derived, draftSeed, preset, next, draftPins);
				const issues = result.overrideIssues[key];

				// Only the new override's own failure refuses the call. One already held and already
				// rejected by this base stays reported in `overrideIssues`, and blocking every other edit
				// on it would leave the user unable to change anything until they found it.
				if (issues) {
					throw new OverrideRejectedError(key, issues);
				}

				set({ overrides: next, ...result });
			},

			clearOverride(key) {
				const { draftSeed, preset, derived, overrides, draftPins } = get();

				if (!Object.hasOwn(overrides, key)) {
					return;
				}

				const next = { ...overrides };
				delete next[key];

				set({ overrides: next, ...tokensFor(derived, draftSeed, preset, next, draftPins) });
			},

			discardEdits() {
				const { record, activeOrdinal } = get();

				// A record with no versions yet has nothing to restore to, so discarding empties the
				// workspace, which is the state `open` leaves it in. Returning early on a null active
				// version instead would strand every edit made before the first commit, which is the
				// one stretch where a user has no way back.
				selection += 1;
				set(workspaceFor(engine, record && versionAt(record, activeOrdinal)));
			},

			commit(provenance) {
				// Captured here rather than at the queue's turn, which is already too late. Everything a
				// commit persists belongs to the moment it was asked for: the user can select another
				// version or keep typing while this waits behind an earlier write, and a commit that read
				// the workspace then would persist that instead, under provenance describing a seed it
				// never saw.
				const { activeOrdinal, draftSeed, preset, overrides, draftPins } = get();
				const request: CommitRequest = {
					provenance,
					session,
					selection,
					activeOrdinal,
					draftSeed,
					preset,
					overrides,
					draftPins,
				};

				// Both arms run the commit: a rejected one must not wedge every commit behind it.
				const run = queue.then(
					() => appendVersion(request),
					() => appendVersion(request),
				);

				// Swallowed for the queue's own bookkeeping only. `run` still rejects for the caller.
				queue = run.catch(() => undefined);

				return run;
			},
		};
	});
}
