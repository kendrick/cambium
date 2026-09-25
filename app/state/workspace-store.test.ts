import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { type BrandRecord, type BrandVersion, SCHEMA_VERSION } from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';
import { checkContrast } from '../../core/contrast/check';
import { BALANCED } from '../../core/interpretation';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import type { RampSet, ScaleEngine, ScaleEngineResult } from '../../core/scale-engine';
import { buildTokenSet } from '../../core/semantic-layer';
import { overrideKey, type TokenOverride } from '../../core/token-overrides';
import type { TokenSet } from '../../core/token-set';
import { createInMemoryRecordStore } from '../storage/in-memory-record-store';
import type { RecordStore } from '../storage/record-store';
import { StorageQuotaExceededError } from '../storage/storage-estimate';

import {
	CommitAbandonedError,
	type CommitProvenance,
	createWorkspaceStore,
	OverrideRejectedError,
	RecordStampedAheadError,
	StaleWorkspaceError,
} from './workspace-store';

function seedWith(hue: number): BrandSeed {
	return {
		keyColors: [
			{
				oklch: [0.62, 0.19, hue],
				proposedRole: 'brand',
				sourceImageId: 'img-1',
				sourceRegion: null,
			},
		],
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
}

function makeVersion(overrides: Partial<BrandVersion> = {}): BrandVersion {
	return {
		createdAt: '2026-01-01T00:00:00.000Z',
		ordinal: 1,
		seed: seedWith(259.8),
		tokenSet: null,
		provider: 'anthropic',
		model: 'claude-opus-5',
		promptVersion: 'seed-v4',
		rawResponse: '{"keyColors":[]}',
		scaleEngine: 'cambium-oklch-1',
		fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		interpretation: 'balanced',
		overrides: [],
		...overrides,
	};
}

function makeRecord(versions: BrandVersion[] = [makeVersion()]): BrandRecord {
	return {
		id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
		schemaVersion: SCHEMA_VERSION,
		revision: 1,
		brandUrl: null,
		images: [
			{
				id: 'img-1',
				downscaled: 'data:image/png;base64,AA==',
				originalHash: 'sha256-aa',
				tag: 'auto',
			},
		],
		versions,
	};
}

/** A second record id, for the case where the workspace moves on mid-write. */
const OTHER_RECORD_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

const PROVENANCE: CommitProvenance = {
	provider: 'anthropic',
	model: 'claude-opus-5',
	promptVersion: 'seed-v4',
	rawResponse: '{"fresh":true}',
	fontTable: { source: 'google-fonts', version: '2026-09-01' },
};

/**
 * Wraps the real engine rather than faking one, so every derivation assertion here is against the
 * arithmetic the app actually runs. The counter exists only for the preset case, where the answer
 * is currently identical across all three presets and a recomputation is therefore invisible in
 * the output.
 */
function countingEngine() {
	const real = createOklchScaleEngine();
	const generate = vi.fn<ScaleEngine['generate']>((seed, params) => real.generate(seed, params));
	return { id: real.id, generate };
}

/** Reads the one number that has to move when the seed's brand colour does. */
function brandHue(result: ScaleEngineResult | null): number {
	if (!result?.ok) {
		throw new Error(`expected a derived ramp set, got ${result?.error.kind ?? 'nothing'}`);
	}

	return result.schemes.light.brand[8]!.h;
}

/** Counts writes so a test can assert that an edit made none. */
function countingRecordStore(): RecordStore & { puts: BrandRecord[] } {
	const inner = createInMemoryRecordStore();
	const puts: BrandRecord[] = [];

	return {
		puts,
		list: () => inner.list(),
		get: (id) => inner.get(id),
		delete: (id) => inner.delete(id),
		async put(record) {
			puts.push(record);
			return inner.put(record);
		},
	};
}

/**
 * Holds `put` open so a test can act while a commit is mid-write. That window is the only place a
 * synchronous `open` or `close` can overtake a commit, since everything else the store does is
 * synchronous.
 */
function gatedWorkspace() {
	let releaseWrite!: () => void;
	let writeHasStarted!: () => void;
	const released = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const writeInFlight = new Promise<void>((resolve) => {
		writeHasStarted = resolve;
	});
	const inner = createInMemoryRecordStore();
	const store = createWorkspaceStore({
		recordStore: {
			...inner,
			async put(record) {
				writeHasStarted();
				await released;
				return inner.put(record);
			},
		},
		engine: createOklchScaleEngine(),
		now: () => '2026-06-01T12:00:00.000Z',
	});

	return { store, records: inner, writeInFlight, releaseWrite };
}

function openWorkspace(
	record = makeRecord(),
	overrides: Partial<Parameters<typeof createWorkspaceStore>[0]> = {},
) {
	const recordStore = countingRecordStore();
	const engine = countingEngine();
	const store = createWorkspaceStore({
		recordStore,
		engine,
		now: () => '2026-06-01T12:00:00.000Z',
		...overrides,
	});

	store.getState().open(record);

	return { store, recordStore, engine };
}

/**
 * A deliberate exception to `docs/agents/testing.md`'s rule that a test asserts behaviour at a seam
 * and survives a rewrite. This one reads source text, so it does neither. It is here because the
 * thing worth protecting is the import graph itself, and nothing else in the suite can see it:
 * `pnpm test:bundle` measures a real build, the landing route is a Server Component, so the engine
 * runs at build time, reaches no client chunk, and the budget stays green whatever this store
 * imports. It stops being green the first time a client component reaches the store, which is #24,
 * the workspace shell, rather than today, and by then the regression is months old.
 *
 * Replace it the moment an import-boundary lint rule can say the same thing. The `engine` docblock
 * in `workspace-store.ts` carries the measured numbers.
 */
describe('the workspace store\u2019s import graph', () => {
	it('names the ScaleEngine type and never a concrete engine', async () => {
		const source = await readFile(new URL('workspace-store.ts', import.meta.url), 'utf8');

		expect(source).not.toMatch(/from '[^']*oklch-scale-engine'/);
	});
});

describe('the workspace store', () => {
	// Says only what it can: the whole suite runs under `environment: 'node'`, so this asserts the
	// store drives to completion where a browser never existed. `zustand/vanilla` is what makes that
	// true—the React entry point would have pulled in `useSyncExternalStore`.
	it('runs where no browser global exists', () => {
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');
		expect(typeof localStorage).toBe('undefined');
	});

	it('opens a record at its newest version', () => {
		const record = makeRecord([
			makeVersion({ interpretation: 'balanced' }),
			makeVersion({
				createdAt: '2026-02-01T00:00:00.000Z',
				ordinal: 2,
				interpretation: 'expressive',
				seed: seedWith(120),
			}),
		]);
		const { store } = openWorkspace(record);
		const state = store.getState();

		expect(state.record).toBe(record);
		expect(state.activeOrdinal).toBe(2);
		expect(state.draftSeed).toEqual(seedWith(120));
		expect(state.preset).toBe('expressive');
		expect(state.derived?.ok).toBe(true);
	});

	it('leaves nothing active when the record has no versions yet', () => {
		const { store } = openWorkspace(makeRecord([]));
		const state = store.getState();

		expect(state.activeOrdinal).toBeNull();
		expect(state.draftSeed).toBeNull();
		expect(state.derived).toBeNull();
		expect(state.preset).toBe('balanced');
	});

	it('recomputes the derived tokens when a seed field changes, and writes nothing', () => {
		const { store, recordStore } = openWorkspace();
		const before = store.getState().derived;

		store.getState().editSeed({ keyColors: seedWith(30).keyColors });

		// Step 9 is the seed's brand colour placed directly, so a moved hue has to show up there.
		expect(brandHue(store.getState().derived)).not.toBeCloseTo(brandHue(before), 1);
		expect(recordStore.puts).toHaveLength(0);
	});

	it('starts a seed from nothing when the active version has none', () => {
		const { store, recordStore } = openWorkspace(makeRecord([makeVersion({ seed: null })]));

		store.getState().editSeed({ trackingFeel: 'wide' });

		expect(store.getState().draftSeed).toEqual({
			keyColors: null,
			neutralTemperature: null,
			radiusCharacter: null,
			shadowCharacter: null,
			trackingFeel: 'wide',
			typeClassification: null,
			suggestedPairing: null,
			typeScaleRatio: null,
			imageClassifications: null,
			expressive: null,
		});
		expect(recordStore.puts).toHaveLength(0);
	});

	it('recomputes when the preset changes, and writes nothing', () => {
		const { store, engine, recordStore } = openWorkspace();
		const derivationsAfterOpen = engine.generate.mock.calls.length;

		store.getState().selectPreset('faithful');

		expect(store.getState().preset).toBe('faithful');
		expect(engine.generate.mock.calls.length).toBe(derivationsAfterOpen + 1);
		expect(recordStore.puts).toHaveLength(0);
	});

	it('restores the active version exactly when edits are discarded', () => {
		const record = makeRecord([makeVersion({ interpretation: 'faithful' })]);
		const { store } = openWorkspace(record);
		const opened = store.getState();

		store.getState().editSeed({ keyColors: seedWith(30).keyColors, trackingFeel: 'tight' });
		store.getState().selectPreset('expressive');
		store.getState().discardEdits();

		const state = store.getState();

		expect(state.draftSeed).toEqual(record.versions[0]!.seed);
		expect(state.preset).toBe('faithful');
		expect(state.derived).toEqual(opened.derived);
	});

	it('appends a version on commit and leaves the existing ones untouched', async () => {
		const record = makeRecord();
		const before = structuredClone(record);
		const { store, recordStore } = openWorkspace(record);

		store.getState().editSeed({ keyColors: seedWith(30).keyColors });
		store.getState().selectPreset('expressive');

		const next = await store.getState().commit(PROVENANCE);

		expect(next.versions).toHaveLength(2);
		expect(next.versions[0]).toEqual(before.versions[0]);
		expect(record).toEqual(before);
		expect(next.versions[1]).toMatchObject({
			ordinal: 2,
			createdAt: '2026-06-01T12:00:00.000Z',
			interpretation: 'expressive',
			seed: seedWith(30),
			tokenSet: null,
			scaleEngine: 'cambium-oklch-1',
		});
		expect(recordStore.puts).toEqual([next]);
		expect(store.getState().activeOrdinal).toBe(2);
	});

	// `BrandSeedSchema` has two spellings of one hue, and the workspace has to hold storage's
	// spelling, not its own.
	it('adopts the record storage holds, hue and all, rather than the one it proposed', async () => {
		const { store, recordStore } = openWorkspace();

		store.getState().editSeed({ keyColors: seedWith(360).keyColors });

		const returned = await store.getState().commit(PROVENANCE);
		const stored = await recordStore.get(returned.id);

		expect(store.getState().record).toEqual(stored);
		expect(returned).toEqual(stored);
		// Asserted directly, not just through the equality above: if `HueSchema` ever stopped
		// canonicalising, both sides would still hold 360 and the equality would pass vacuously.
		expect(store.getState().record?.versions[1]?.seed?.keyColors?.[0]?.oklch[2]).toBe(0);
	});

	it('carries provenance forward on an immediate second commit, once a canonicalised hue is adopted into the draft', async () => {
		const { store } = openWorkspace();

		store.getState().editSeed({ keyColors: seedWith(360).keyColors });

		const first = await store.getState().commit(PROVENANCE);

		// The draft has to hold the same spelling storage does, or a provenance-free commit right
		// after this one reads as an edit nobody explained, even though nothing was edited.
		expect(store.getState().draftSeed).toEqual(first.versions[1]?.seed);
		expect(store.getState().draftSeed?.keyColors?.[0]?.oklch[2]).toBe(0);

		const second = await store.getState().commit();

		expect(second.versions[2]).toMatchObject({ seed: first.versions[1]?.seed, rawResponse: null });
	});

	it('keeps a mid-write edit’s seed rather than the just-committed version’s', async () => {
		const { store, writeInFlight, releaseWrite } = gatedWorkspace();

		store.getState().open(makeRecord());

		const pending = store.getState().commit();

		// `editSeed` can land mid-write, the same window adoption reaches into to sync the draft with
		// what storage canonicalised. An edit that lands there has to win over the version just
		// written, or the user's keystroke gets silently replaced by the record they committed before it.
		await writeInFlight;
		store.getState().editSeed({ keyColors: seedWith(45).keyColors });
		releaseWrite();

		await pending;

		expect(store.getState().activeOrdinal).toBe(2);
		expect(store.getState().draftSeed).toEqual(seedWith(45));
	});

	it('leaves the draft the same object when a commit needs no canonicalising', async () => {
		const { store } = openWorkspace();
		const draftBefore = store.getState().draftSeed;

		const next = await store.getState().commit();

		expect(store.getState().draftSeed).toBe(draftBefore);
		expect(next.versions[1]).toMatchObject({ seed: draftBefore });
	});

	it('recomputes derived from the adopted seed, so the anchor reports the hue the draft now holds', async () => {
		const { store, engine } = openWorkspace();

		store.getState().editSeed({ keyColors: seedWith(360).keyColors });

		await store.getState().commit(PROVENANCE);

		const draft = store.getState().draftSeed;
		const derived = store.getState().derived;
		const fresh = engine.generate(draft!, BALANCED);

		expect(derived).toEqual(fresh);

		if (!derived?.ok) {
			throw new Error(`expected a derived ramp set, got ${derived?.error.kind ?? 'nothing'}`);
		}

		// The ramps built from either spelling match, but the anchor records the hue actually
		// requested—the clearest place a `derived` still built from the pre-adoption seed would show.
		expect(derived.anchor.requested[2]).toBe(0);
	});

	it('serialises overlapping commits so the second builds on the first', async () => {
		const { store, recordStore } = openWorkspace();

		// No await between them. A second commit that counted its ordinal off the pre-commit record
		// would carry a base storage has left, and `put` would refuse it with `StaleRecordWriteError`.
		const [first, second] = await Promise.all([
			store.getState().commit(),
			store.getState().commit(),
		]);

		expect(first.versions.map((version) => version.ordinal)).toEqual([1, 2]);
		expect(second.versions.map((version) => version.ordinal)).toEqual([1, 2, 3]);
		expect(recordStore.puts).toHaveLength(2);
		expect(store.getState().activeOrdinal).toBe(3);
		await expect(recordStore.get(second.id)).resolves.toEqual(second);
	});

	it('carries the active version’s provenance forward with no raw response', async () => {
		const { store } = openWorkspace();

		const next = await store.getState().commit();

		expect(next.versions[1]).toMatchObject({
			provider: 'anthropic',
			model: 'claude-opus-5',
			promptVersion: 'seed-v4',
			fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
			// Null exactly because no model call produced this version, which is what the schema's own
			// comment says null there means.
			rawResponse: null,
		});
	});

	it('refuses to credit the active version\u2019s model with a seed somebody edited', async () => {
		const { store, recordStore } = openWorkspace();

		store.getState().editSeed({ keyColors: seedWith(30).keyColors });

		await expect(store.getState().commit()).rejects.toThrow(/provenance/);
		expect(recordStore.puts).toHaveLength(0);
	});

	it('counts a hole in an array as an edit rather than a match', async () => {
		const classified: BrandSeed = {
			...seedWith(259.8),
			imageClassifications: [{ imageId: 'img-1', detected: 'logo' }],
		};
		const { store, recordStore } = openWorkspace(makeRecord([makeVersion({ seed: classified })]));

		// A walk built on `Array.prototype.every` skips the hole, calls the two seeds equal, and lets
		// this edit keep the model's name.
		const holed: BrandSeed['imageClassifications'] = [];
		holed.length = 1;

		store.getState().editSeed({ imageClassifications: holed });

		await expect(store.getState().commit()).rejects.toThrow(/provenance/);
		expect(recordStore.puts).toHaveLength(0);
	});

	it('commits an edited seed once the caller says where it came from', async () => {
		const { store } = openWorkspace();

		store.getState().editSeed({ keyColors: seedWith(30).keyColors });

		const next = await store.getState().commit(PROVENANCE);

		expect(next.versions[1]).toMatchObject({ seed: seedWith(30), ...PROVENANCE });
	});

	it('carries provenance forward again once an edit is undone', async () => {
		const { store } = openWorkspace();

		// Structural, not referential: a seed edited back to what the model said is still the model's.
		store.getState().editSeed({ keyColors: seedWith(30).keyColors });
		store.getState().editSeed({ keyColors: seedWith(259.8).keyColors });

		const next = await store.getState().commit();

		expect(next.versions[1]).toMatchObject({ model: 'claude-opus-5', rawResponse: null });
	});

	it('takes provenance from the caller when a model call produced the version', async () => {
		const { store } = openWorkspace(makeRecord([]));

		store.getState().editSeed({ keyColors: seedWith(200).keyColors });

		const next = await store.getState().commit(PROVENANCE);

		expect(next.versions).toHaveLength(1);
		expect(next.versions[0]).toMatchObject({ ordinal: 1, ...PROVENANCE });
	});

	it('refuses to commit a first version with no provenance to carry forward', async () => {
		const { store, recordStore } = openWorkspace(makeRecord([]));

		await expect(store.getState().commit()).rejects.toThrow(/provenance/);
		expect(recordStore.puts).toHaveLength(0);
	});

	it('refuses to commit with no record open', async () => {
		const store = createWorkspaceStore({
			recordStore: createInMemoryRecordStore(),
			engine: createOklchScaleEngine(),
		});

		await expect(store.getState().commit(PROVENANCE)).rejects.toThrow(/no record is open/);
	});

	it('switches the workspace to an older version', () => {
		const record = makeRecord([
			makeVersion({ interpretation: 'faithful', seed: seedWith(10) }),
			makeVersion({ createdAt: '2026-02-01T00:00:00.000Z', ordinal: 2, seed: seedWith(200) }),
		]);
		const { store } = openWorkspace(record);

		store.getState().selectVersion(1);

		const state = store.getState();

		expect(state.activeOrdinal).toBe(1);
		expect(state.draftSeed).toEqual(seedWith(10));
		expect(state.preset).toBe('faithful');
	});

	it('rejects an ordinal the record does not hold', () => {
		const { store } = openWorkspace();

		expect(() => store.getState().selectVersion(7)).toThrow(/ordinal 7/);
		expect(store.getState().activeOrdinal).toBe(1);
	});

	it('discards edits made before a record has any versions', () => {
		const { store } = openWorkspace(makeRecord([]));

		store.getState().editSeed({ trackingFeel: 'wide' });
		store.getState().selectPreset('expressive');
		store.getState().discardEdits();

		// Nothing to restore to, so discarding empties the workspace rather than stranding the edit.
		const state = store.getState();

		expect(state.draftSeed).toBeNull();
		expect(state.preset).toBe('balanced');
		expect(state.derived).toBeNull();
	});

	it('leaves a newer workspace alone when an older commit lands late', async () => {
		const { store, writeInFlight, releaseWrite } = gatedWorkspace();
		const second = { ...makeRecord([makeVersion({ seed: seedWith(50) })]), id: OTHER_RECORD_ID };

		store.getState().open(makeRecord());

		const pending = store.getState().commit();

		// `open` is synchronous and unqueued, so it can land while the write is in flight. Adopting the
		// finished commit afterwards would pair the old record with the new record's draft and preset.
		await writeInFlight;
		store.getState().open(second);
		releaseWrite();

		await expect(pending).resolves.toMatchObject({ id: makeRecord().id });

		const state = store.getState();

		expect(state.record).toBe(second);
		expect(state.activeOrdinal).toBe(1);
		expect(state.draftSeed).toEqual(seedWith(50));
	});

	it('leaves the workspace alone when the same record is reopened mid-write', async () => {
		const { store, writeInFlight, releaseWrite } = gatedWorkspace();
		const record = makeRecord();

		store.getState().open(record);

		const pending = store.getState().commit();

		// Reopening hands back the very same object, so comparing records cannot tell this from never
		// having left. Leaving and coming back is still a new workspace session, and the commit that
		// belonged to the old one does not get to move it.
		await writeInFlight;
		store.getState().close();
		store.getState().open(record);
		releaseWrite();

		await pending;

		expect(store.getState().record).toBe(record);
		expect(store.getState().activeOrdinal).toBe(1);
	});

	it('refuses a commit whose workspace was replaced before it ran', async () => {
		const { store, recordStore } = openWorkspace();
		const second = { ...makeRecord([makeVersion({ seed: seedWith(50) })]), id: OTHER_RECORD_ID };

		// `commit` queues, so nothing has read the workspace yet when this `open` lands synchronously.
		// A commit that followed the workspace would append to whichever record arrived last.
		const pending = store.getState().commit();

		store.getState().open(second);

		await expect(pending).rejects.toBeInstanceOf(CommitAbandonedError);
		expect(recordStore.puts).toHaveLength(0);
		expect(store.getState().record).toBe(second);
	});

	it('keeps a version selected mid-write, and still takes the record', async () => {
		const { store, writeInFlight, releaseWrite } = gatedWorkspace();
		const record = makeRecord([
			makeVersion({ seed: seedWith(10), interpretation: 'faithful' }),
			makeVersion({ createdAt: '2026-02-01T00:00:00.000Z', ordinal: 2, seed: seedWith(20) }),
		]);

		store.getState().open(record);

		const pending = store.getState().commit();

		// Selecting a version is not leaving the record, so the write is still this workspace's to take.
		// Moving the active version on top of the selection is what would leave the workspace naming one
		// version and showing another's seed.
		await writeInFlight;
		store.getState().selectVersion(1);
		releaseWrite();

		await pending;

		const state = store.getState();

		expect(state.activeOrdinal).toBe(1);
		expect(state.draftSeed).toEqual(seedWith(10));
		expect(state.preset).toBe('faithful');
		expect(state.record?.versions).toHaveLength(3);
	});

	it('keeps a reselected version even when the ordinal did not change', async () => {
		const { store, writeInFlight, releaseWrite } = gatedWorkspace();

		store.getState().open(makeRecord());
		store.getState().editSeed({ keyColors: seedWith(99).keyColors });

		const pending = store.getState().commit(PROVENANCE);

		// Reselecting the version already active still re-points the view: it throws the edit away and
		// puts the committed version's own seed back on screen. Comparing ordinals cannot see that.
		await writeInFlight;
		store.getState().selectVersion(1);
		releaseWrite();

		await pending;

		expect(store.getState().activeOrdinal).toBe(1);
		expect(store.getState().draftSeed).toEqual(seedWith(259.8));
	});

	it('keeps a discard that lands while a commit is in flight', async () => {
		const { store, writeInFlight, releaseWrite } = gatedWorkspace();

		store.getState().open(makeRecord());
		store.getState().editSeed({ keyColors: seedWith(99).keyColors });

		const pending = store.getState().commit(PROVENANCE);

		await writeInFlight;
		store.getState().discardEdits();
		releaseWrite();

		await pending;

		expect(store.getState().activeOrdinal).toBe(1);
		expect(store.getState().draftSeed).toEqual(seedWith(259.8));
	});

	it('still moves forward when the edit lands while a commit is in flight', async () => {
		const { store, writeInFlight, releaseWrite } = gatedWorkspace();

		store.getState().open(makeRecord());

		const pending = store.getState().commit();

		// Editing on top of the version being written is the ordinary state rather than a conflict, so
		// this commit still moves the workspace forward. The guard above must not catch it too.
		await writeInFlight;
		store.getState().editSeed({ keyColors: seedWith(77).keyColors });
		releaseWrite();

		await pending;

		expect(store.getState().activeOrdinal).toBe(2);
		expect(store.getState().draftSeed).toEqual(seedWith(77));
	});

	it('commits the draft that was requested, not the one that arrives before its turn', async () => {
		const { store, writeInFlight, releaseWrite } = gatedWorkspace();

		store.getState().open(makeRecord());

		const first = store.getState().commit();

		// The second commit waits behind the first write. What it persists has to be the draft that was
		// on screen when it was asked for, not whatever the user typed while it sat in the queue, or the
		// provenance handed to it describes a seed nobody attached it to.
		await writeInFlight;

		const second = store.getState().commit(PROVENANCE);

		store.getState().editSeed({ keyColors: seedWith(42).keyColors });
		releaseWrite();

		await first;

		const next = await second;

		expect(next.versions).toHaveLength(3);
		expect(next.versions[2]).toMatchObject({ seed: seedWith(259.8), ...PROVENANCE });
	});

	it('refuses to follow a version stamped ahead of this clock', async () => {
		// A record imported from a device whose clock ran ahead. `BrandRecordSchema` rejects a version
		// stamped before its predecessor, so this commit cannot be written however it is stamped. The
		// store says so itself rather than letting a schema rejection surface from inside `put`.
		const ahead = makeRecord([makeVersion({ createdAt: '2027-01-01T00:00:00.000Z' })]);
		const { store, recordStore } = openWorkspace(ahead);

		// Typed rather than message-matched, because the comment on the guard rests on a caller being
		// able to tell a clock conflict from a malformed record.
		await expect(store.getState().commit()).rejects.toBeInstanceOf(RecordStampedAheadError);
		await expect(store.getState().commit()).rejects.toMatchObject({
			kind: 'record-stamped-ahead',
			stampedAt: '2027-01-01T00:00:00.000Z',
		});
		expect(recordStore.puts).toHaveLength(0);
		expect(store.getState().record).toBe(ahead);
	});

	it('commits the preset that was selected when the commit was asked for', async () => {
		const { store } = openWorkspace();

		store.getState().selectPreset('faithful');

		const pending = store.getState().commit();

		// Same queue boundary as the draft and the ordinal: switching presets before the body runs must
		// not change what the commit already asked to record.
		store.getState().selectPreset('expressive');

		const next = await pending;

		expect(next.versions[1]).toMatchObject({ interpretation: 'faithful' });
	});

	it('commits a version that ties the instant of the one before it', async () => {
		// `BrandRecordSchema` allows two versions to share an instant and lets `ordinal` order them, so
		// the clock guard has to refuse only what runs backwards, never what stands still.
		const tied = '2026-06-01T12:00:00.000Z';
		const { store } = openWorkspace(makeRecord([makeVersion({ createdAt: tied })]));

		const next = await store.getState().commit();

		expect(next.versions[1]).toMatchObject({ ordinal: 2, createdAt: tied });
	});

	it('carries provenance from the version selected when the commit was asked for', async () => {
		// Both versions hold the same seed, so the only thing that can differ in the committed version is
		// which one its provenance came from.
		const record = makeRecord([
			makeVersion({ model: 'claude-opus-5' }),
			makeVersion({
				createdAt: '2026-02-01T00:00:00.000Z',
				ordinal: 2,
				model: 'claude-sonnet-5',
			}),
		]);
		const { store } = openWorkspace(record);

		store.getState().selectVersion(1);

		const pending = store.getState().commit();

		// `commit` queues, so this lands before the body runs. Resolving the ordinal then would carry
		// version 2's model onto a seed that came from version 1.
		store.getState().selectVersion(2);

		const next = await pending;

		expect(next.versions[2]).toMatchObject({ model: 'claude-opus-5' });
	});

	it('carries provenance from the version each commit was requested against', async () => {
		const { store } = openWorkspace();

		const [, second] = await Promise.all([store.getState().commit(), store.getState().commit()]);

		// Both were asked for while version 1 was active, so both carry version 1's model and neither
		// claims a response, whatever the record looked like by the time each one ran.
		expect(second.versions[2]).toMatchObject({ model: 'claude-opus-5', rawResponse: null });
	});

	it('refuses a commit from a workspace behind a write this store already made', async () => {
		const { store, records, writeInFlight, releaseWrite } = gatedWorkspace();
		const stale = makeRecord();

		store.getState().open(stale);

		const first = store.getState().commit();

		// Reopening the same object is supported and leaves the workspace a version behind the write
		// still in flight. Appending from there recounts an ordinal that already exists from a
		// revision storage has left. `put` would refuse that with `StaleRecordWriteError`; the
		// workspace refuses it first, with `StaleWorkspaceError`, and the finished commit stays.
		await writeInFlight;
		store.getState().open(stale);

		const second = store.getState().commit();

		releaseWrite();
		await first;

		await expect(second).rejects.toBeInstanceOf(StaleWorkspaceError);
		await expect(second).rejects.toMatchObject({ kind: 'stale-workspace', recordId: stale.id });

		const stored = await records.get(stale.id);

		expect(stored?.versions).toHaveLength(2);
		expect(stored?.versions[1]).toMatchObject({ ordinal: 2 });
	});

	it('commits a record recreated under an id this store already wrote', async () => {
		const { store, records, writeInFlight, releaseWrite } = gatedWorkspace();
		const original = makeRecord();

		store.getState().open(original);

		const first = store.getState().commit();

		await writeInFlight;
		releaseWrite();
		await first;

		// Deleted and made again under the same id, which a caller can do and this store cannot see.
		// A different record that happens to reuse an id has been written past by nothing. The delete
		// has to reach storage, not just the workspace: since #67 the store compares against what it
		// holds, so a record still sitting there would refuse this commit, and rightly.
		await records.delete(original.id);
		store.getState().open(makeRecord());

		const next = await store.getState().commit();

		expect(next.versions).toHaveLength(2);
	});

	it('refuses a commit from a workspace several writes behind, without guessing how far', async () => {
		const original = makeRecord();
		const { store, recordStore } = openWorkspace(original);

		await store.getState().commit();
		await store.getState().commit();

		store.getState().open(original);

		// No version count: what this store wrote is not what storage holds, and a number right only
		// when the workspace is exactly one write behind is one a caller cannot use.
		await expect(store.getState().commit()).rejects.toMatchObject({
			kind: 'stale-workspace',
			recordId: original.id,
		});
		expect(recordStore.puts).toHaveLength(2);
	});

	it('closes a record without touching storage', () => {
		const { store, recordStore } = openWorkspace();

		store.getState().close();

		expect(store.getState()).toMatchObject({
			record: null,
			activeOrdinal: null,
			draftSeed: null,
			derived: null,
		});
		expect(recordStore.puts).toHaveLength(0);
	});

	it('surfaces a full origin instead of swallowing it, and keeps the workspace on what storage holds', async () => {
		const record = makeRecord();
		const full: RecordStore = {
			...createInMemoryRecordStore(),
			put: () => Promise.reject(new StorageQuotaExceededError()),
		};
		const store = createWorkspaceStore({
			recordStore: full,
			engine: createOklchScaleEngine(),
			now: () => '2026-06-01T12:00:00.000Z',
		});

		store.getState().open(record);

		await expect(store.getState().commit()).rejects.toBeInstanceOf(StorageQuotaExceededError);

		const state = store.getState();

		expect(state.record).toBe(record);
		expect(state.activeOrdinal).toBe(1);
	});
});

/** `border` derives to `neutral.6` in both schemes, so any other step reads as the override. */
const BORDER_TO_8: TokenOverride = {
	kind: 'alias',
	scheme: 'light',
	token: 'border',
	alias: 'neutral.8',
};

/**
 * `radius.lg` derives to something other than 1 from `seedWith(259.8)`, the one seed every test
 * using this override opens on. The open test checks only that seed, through `underived`.
 */
const RADIUS_LG_TO_1: TokenOverride = {
	kind: 'value',
	category: 'radius',
	path: ['lg', 'value'],
	value: 1,
};

const RING_TO_BRAND_9: TokenOverride = {
	kind: 'alias',
	scheme: 'light',
	token: 'ring',
	alias: 'brand.9',
};

function borderAlias(tokenSet: TokenSet | null): { mirror?: string; light?: string } {
	return {
		mirror: tokenSet?.semantic.border?.alias,
		light: tokenSet?.schemes.light.semantic.border?.alias,
	};
}

function withSpare(ramps: RampSet): RampSet {
	return { ...ramps, spare: ramps.brand } as RampSet;
}

/**
 * The real engine, plus a `spare` ramp copied from `brand` whenever the seed's hue is 30. No real
 * seed changes which ramps exist today, so this is the only way to hold an override that applied
 * against one base and has no target on the next.
 */
function reshapingEngine(): ScaleEngine {
	const real = createOklchScaleEngine();

	return {
		id: real.id,
		generate(seed, params) {
			const result = real.generate(seed, params);

			if (!result.ok || seed.keyColors?.[0]?.oklch[2] !== 30) {
				return result;
			}

			return {
				...result,
				schemes: { light: withSpare(result.schemes.light), dark: withSpare(result.schemes.dark) },
			};
		},
	};
}

describe('the workspace store’s token set and overrides', () => {
	it('builds the token set from the same derivation, and rebuilds it when the seed changes', () => {
		const { store } = openWorkspace();

		expect(store.getState().tokenSet?.primitives.brand[8]!.h).toBe(
			brandHue(store.getState().derived),
		);

		store.getState().editSeed({ keyColors: seedWith(30).keyColors });

		expect(store.getState().tokenSet?.primitives.brand[8]!.h).toBe(
			brandHue(store.getState().derived),
		);
		expect(store.getState().tokenSet?.primitives.brand[8]!.h).toBeCloseTo(30, 0);
	});

	it('holds no token set when nothing is derived, and refuses an override there', () => {
		const { store } = openWorkspace(makeRecord([]));

		expect(store.getState().tokenSet).toBeNull();
		expect(() => store.getState().setOverride(BORDER_TO_8)).toThrow(/nothing is derived/);
		expect(store.getState().overrides).toEqual({});
	});

	it('applies an override to the light scheme and its mirror, and holds it by key', () => {
		const { store } = openWorkspace();

		store.getState().setOverride(BORDER_TO_8);

		expect(borderAlias(store.getState().tokenSet)).toEqual({
			mirror: 'neutral.8',
			light: 'neutral.8',
		});
		expect(store.getState().overrides).toEqual({ [overrideKey(BORDER_TO_8)]: BORDER_TO_8 });
		expect(store.getState().overrideIssues).toEqual({});
	});

	it('replaces an earlier override on the same token', () => {
		const { store } = openWorkspace();

		store.getState().setOverride(BORDER_TO_8);
		store.getState().setOverride({ ...BORDER_TO_8, alias: 'neutral.3' });

		expect(Object.keys(store.getState().overrides)).toHaveLength(1);
		expect(borderAlias(store.getState().tokenSet).light).toBe('neutral.3');
	});

	it('refuses an override the derived set cannot take, and changes nothing', () => {
		const { store } = openWorkspace();

		store.getState().setOverride(BORDER_TO_8);

		const before = store.getState();
		const invalid: TokenOverride = { ...BORDER_TO_8, token: 'ring', alias: 'neutral.13' };
		let thrown: unknown;

		try {
			store.getState().setOverride(invalid);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(OverrideRejectedError);
		expect(thrown).toMatchObject({ kind: 'override-rejected', key: overrideKey(invalid) });
		expect((thrown as OverrideRejectedError).issues.length).toBeGreaterThan(0);
		expect(store.getState()).toBe(before);
	});

	it('keeps an overridden alias across a preset switch, on a token set rebuilt for that preset', () => {
		const { store, engine } = openWorkspace();

		store.getState().setOverride(BORDER_TO_8);

		const before = store.getState().tokenSet;
		const derivations = engine.generate.mock.calls.length;

		store.getState().selectPreset('expressive');

		// All three presets share Balanced's numbers until #37, so a rebuilt set is otherwise equal
		// to the old one. Identity and the engine call are what show it was rebuilt at all.
		expect(engine.generate.mock.calls.length).toBe(derivations + 1);
		expect(store.getState().tokenSet).not.toBe(before);
		expect(borderAlias(store.getState().tokenSet)).toEqual({
			mirror: 'neutral.8',
			light: 'neutral.8',
		});
		expect(store.getState().overrides).toEqual({ [overrideKey(BORDER_TO_8)]: BORDER_TO_8 });
	});

	it('keeps overrides across a seed edit while the rest of the set follows the new seed', () => {
		const { store } = openWorkspace();
		const primitive: TokenOverride = {
			kind: 'primitive',
			scheme: 'light',
			ramp: 'brand',
			step: 3,
			l: 0.5,
			c: 0.1,
			h: 120,
		};

		store.getState().setOverride(BORDER_TO_8);
		store.getState().setOverride(primitive);
		store.getState().editSeed({ keyColors: seedWith(30).keyColors });

		const { tokenSet } = store.getState();

		expect(tokenSet?.primitives.brand[8]!.h).toBeCloseTo(30, 0);
		expect(tokenSet?.primitives.brand[2]).toMatchObject({ step: 3, l: 0.5, c: 0.1, h: 120 });
		expect(borderAlias(tokenSet).light).toBe('neutral.8');
	});

	it('keeps overrides when a commit adopts storage’s spelling of the seed', async () => {
		const { store } = openWorkspace();

		store.getState().setOverride(BORDER_TO_8);
		store.getState().editSeed({ keyColors: seedWith(360).keyColors });
		await store.getState().commit(PROVENANCE);

		// The hue came back as 0, so the adopting branch re-derived. The override has to ride through.
		expect(store.getState().draftSeed?.keyColors?.[0]?.oklch[2]).toBe(0);
		expect(borderAlias(store.getState().tokenSet).light).toBe('neutral.8');
	});

	it('commits no token set even while an override is held', async () => {
		const { store, recordStore } = openWorkspace();

		store.getState().setOverride(BORDER_TO_8);
		store.getState().editSeed({ keyColors: seedWith(30).keyColors });
		await store.getState().commit(PROVENANCE);

		const written = recordStore.puts.at(-1)!.versions.at(-1)!;

		expect(written.tokenSet).toBeNull();
		expect(written.seed).toEqual(seedWith(30));
	});

	/** A second version, newer than `makeVersion()`'s, carrying the overrides it is handed. */
	const savedWith = (overrides: TokenOverride[], seed = seedWith(259.8)) =>
		makeVersion({ createdAt: '2026-02-01T00:00:00.000Z', ordinal: 2, seed, overrides });

	/** What the same seed derives to with nothing overridden, so a test can tell a restore apart. */
	const underived = () => openWorkspace().store.getState().tokenSet;

	it('commits the overrides it holds, restored ones included, in the order they were first made', async () => {
		const { store, recordStore } = openWorkspace(
			makeRecord([makeVersion(), savedWith([BORDER_TO_8])]),
		);

		store.getState().setOverride(RADIUS_LG_TO_1);
		store.getState().setOverride({ ...BORDER_TO_8, alias: 'neutral.3' });

		const committed = await store.getState().commit(PROVENANCE);
		// Read back through storage rather than off what was handed to `put`, since the stored
		// record is what the next `open` sees.
		const stored = await recordStore.get(committed.id);

		// Replacing the border edit keeps its place: it was made first, in the version restored.
		expect(stored?.versions.at(-1)?.overrides).toEqual([
			{ ...BORDER_TO_8, alias: 'neutral.3' },
			RADIUS_LG_TO_1,
		]);
	});

	it('opens a record with its newest version’s overrides applied and held by key', async () => {
		const { store, recordStore } = openWorkspace(makeRecord([]));
		const stored = await recordStore.put(
			makeRecord([makeVersion(), savedWith([BORDER_TO_8, RADIUS_LG_TO_1])]),
		);

		store.getState().open(stored);

		// The oracle is the edit path: opening has to land where setting the same two by hand does.
		const { store: byHand } = openWorkspace();

		byHand.getState().setOverride(BORDER_TO_8);
		byHand.getState().setOverride(RADIUS_LG_TO_1);

		const state = store.getState();

		expect(underived()?.radius.values.lg?.value).not.toBe(1);
		expect(borderAlias(state.tokenSet)).toEqual({ mirror: 'neutral.8', light: 'neutral.8' });
		expect(state.tokenSet?.radius.values.lg?.value).toBe(1);
		expect(Object.keys(state.overrides)).toEqual([
			overrideKey(BORDER_TO_8),
			overrideKey(RADIUS_LG_TO_1),
		]);
		expect(state.overrides).toEqual(byHand.getState().overrides);
		expect(state.tokenSet).toEqual(byHand.getState().tokenSet);
		expect(state.overrideIssues).toEqual({});
	});

	it('restores the selected version’s overrides, not the ones the previous version held', () => {
		const record = makeRecord([
			makeVersion({ overrides: [BORDER_TO_8] }),
			savedWith([RING_TO_BRAND_9]),
		]);
		const { store } = openWorkspace(record);
		const derivedRing = underived()?.semantic.ring?.alias;

		expect(derivedRing).not.toBe('brand.9');
		expect(store.getState().tokenSet?.semantic.ring?.alias).toBe('brand.9');

		store.getState().selectVersion(1);

		const state = store.getState();

		expect(state.overrides).toEqual({ [overrideKey(BORDER_TO_8)]: BORDER_TO_8 });
		expect(borderAlias(state.tokenSet).light).toBe('neutral.8');
		expect(state.tokenSet?.semantic.ring?.alias).toBe(derivedRing);
	});

	it('discards edits back to the version’s stored overrides, not to none', () => {
		const { store } = openWorkspace(makeRecord([makeVersion(), savedWith([BORDER_TO_8])]));
		const derivedRing = underived()?.semantic.ring?.alias;

		store.getState().setOverride({ ...BORDER_TO_8, alias: 'neutral.3' });
		store.getState().setOverride(RING_TO_BRAND_9);
		store.getState().discardEdits();

		const state = store.getState();

		expect(state.overrides).toEqual({ [overrideKey(BORDER_TO_8)]: BORDER_TO_8 });
		expect(borderAlias(state.tokenSet).light).toBe('neutral.8');
		expect(state.tokenSet?.semantic.ring?.alias).toBe(derivedRing);
	});

	it('carries provenance forward on a commit that only adds overrides', async () => {
		const record = makeRecord([makeVersion(), savedWith([BORDER_TO_8])]);
		const { store } = openWorkspace(record);

		store.getState().setOverride(RING_TO_BRAND_9);

		const next = await store.getState().commit();
		const previous = record.versions[1]!;

		expect(next.versions[2]).toMatchObject({
			provider: previous.provider,
			model: previous.model,
			promptVersion: previous.promptVersion,
			fontTable: previous.fontTable,
			rawResponse: null,
			seed: previous.seed,
			overrides: [BORDER_TO_8, RING_TO_BRAND_9],
		});
	});

	it('opens a stored override the base cannot take as an issue, and applies the rest', () => {
		const toSpare: TokenOverride = { ...BORDER_TO_8, token: 'ring', alias: 'spare.11' };
		const record = makeRecord([makeVersion(), savedWith([toSpare, BORDER_TO_8])]);
		let opened!: ReturnType<typeof openWorkspace>;

		// Hue 259.8 gives `reshapingEngine` no spare ramp, so `spare.11` has no target on open.
		expect(() => {
			opened = openWorkspace(record, { engine: reshapingEngine() });
		}).not.toThrow();

		const { store } = opened;
		let state = store.getState();

		expect(Object.keys(state.overrides)).toEqual([overrideKey(toSpare), overrideKey(BORDER_TO_8)]);
		expect(Object.keys(state.overrideIssues)).toEqual([overrideKey(toSpare)]);
		expect(state.tokenSet?.semantic.ring?.alias).toBe(underived()?.semantic.ring?.alias);
		expect(borderAlias(state.tokenSet).light).toBe('neutral.8');

		store.getState().editSeed({ keyColors: seedWith(30).keyColors });
		state = store.getState();

		expect(state.overrideIssues).toEqual({});
		expect(state.tokenSet?.semantic.ring?.alias).toBe('spare.11');
	});

	it('commits the overrides held when the commit was asked for, not one set mid-write', async () => {
		const { store, records, writeInFlight, releaseWrite } = gatedWorkspace();

		store.getState().open(makeRecord([makeVersion(), savedWith([BORDER_TO_8])]));

		const pending = store.getState().commit();

		await writeInFlight;
		store.getState().setOverride(RING_TO_BRAND_9);
		releaseWrite();

		const committed = await pending;
		const stored = await records.get(committed.id);

		expect(stored?.versions.at(-1)?.overrides).toEqual([BORDER_TO_8]);
		// The mid-write edit is the user's, so the workspace keeps it on top of what was committed.
		expect(Object.keys(store.getState().overrides)).toEqual([
			overrideKey(BORDER_TO_8),
			overrideKey(RING_TO_BRAND_9),
		]);
	});

	const twoVersions = () =>
		makeRecord([
			makeVersion(),
			makeVersion({ createdAt: '2026-02-01T00:00:00.000Z', ordinal: 2, seed: seedWith(200) }),
		]);

	it.each([
		[
			'open',
			(s: ReturnType<typeof openWorkspace>['store'], r: BrandRecord) => s.getState().open(r),
		],
		[
			'selectVersion',
			(s: ReturnType<typeof openWorkspace>['store']) => s.getState().selectVersion(1),
		],
		['discardEdits', (s: ReturnType<typeof openWorkspace>['store']) => s.getState().discardEdits()],
	])('drops unsaved overrides on %s and shows the derived value again', (_name, act) => {
		const record = twoVersions();
		const { store } = openWorkspace(record);

		store.getState().setOverride(BORDER_TO_8);
		act(store, record);

		expect(store.getState().overrides).toEqual({});
		expect(store.getState().overrideIssues).toEqual({});
		expect(borderAlias(store.getState().tokenSet)).toEqual({
			mirror: 'neutral.6',
			light: 'neutral.6',
		});
	});

	it('drops overrides and the token set on close', () => {
		const { store } = openWorkspace();

		store.getState().setOverride(BORDER_TO_8);
		store.getState().close();

		expect(store.getState().overrides).toEqual({});
		expect(store.getState().tokenSet).toBeNull();
	});

	it('clears one override back to the derived value and leaves the others', () => {
		const { store } = openWorkspace();
		const ring: TokenOverride = { ...BORDER_TO_8, token: 'ring', alias: 'brand.9' };

		store.getState().setOverride(BORDER_TO_8);
		store.getState().setOverride(ring);
		store.getState().clearOverride(overrideKey(BORDER_TO_8));

		expect(borderAlias(store.getState().tokenSet).light).toBe('neutral.6');
		expect(store.getState().tokenSet?.semantic.ring?.alias).toBe('brand.9');
		expect(store.getState().overrides).toEqual({ [overrideKey(ring)]: ring });
	});

	it('treats clearing a key nothing holds as a no-op', () => {
		const { store } = openWorkspace();
		const before = store.getState();

		store.getState().clearOverride(overrideKey(BORDER_TO_8));

		expect(store.getState()).toBe(before);
	});

	it('keeps an override the new base rejects, applies the rest, and reapplies it once it fits', () => {
		const { store } = openWorkspace(makeRecord([makeVersion({ seed: seedWith(30) })]), {
			engine: reshapingEngine(),
		});
		const toSpare: TokenOverride = { ...BORDER_TO_8, token: 'ring', alias: 'spare.11' };

		store.getState().setOverride(toSpare);
		store.getState().setOverride(BORDER_TO_8);

		// No spare ramp at this hue. The edit has to land, not throw, and the override stays held.
		store.getState().editSeed({ keyColors: seedWith(259.8).keyColors });

		let state = store.getState();

		expect(state.draftSeed?.keyColors?.[0]?.oklch[2]).toBe(259.8);
		expect(Object.keys(state.overrides)).toEqual([overrideKey(toSpare), overrideKey(BORDER_TO_8)]);
		expect(Object.keys(state.overrideIssues)).toEqual([overrideKey(toSpare)]);
		expect(state.tokenSet?.semantic.ring?.alias).toBe('brand.11');
		expect(borderAlias(state.tokenSet).light).toBe('neutral.8');

		// A held override the base rejects must not block an unrelated edit.
		store.getState().setOverride({ ...BORDER_TO_8, alias: 'neutral.5' });
		expect(borderAlias(store.getState().tokenSet).light).toBe('neutral.5');

		store.getState().editSeed({ keyColors: seedWith(30).keyColors });
		state = store.getState();

		expect(state.overrideIssues).toEqual({});
		expect(state.tokenSet?.semantic.ring?.alias).toBe('spare.11');
	});
});

describe('the workspace store’s contrast repair (#8)', () => {
	/**
	 * The seed every test in this file opens on by default (`makeVersion`'s own `seedWith(259.8)`).
	 * `core/semantic-map.ts` documents it failing AA in light on `primary-foreground`,
	 * `sidebar-primary-foreground` and `muted-foreground` before any repair runs, so it needs no
	 * fixture of its own to prove the store is applying one.
	 */
	const failingSeed = seedWith(259.8);

	/** What `tokensFor` would report with the repair step skipped, the baseline the tests below rule out. */
	function unrepairedReport() {
		const result = createOklchScaleEngine().generate(failingSeed, BALANCED);

		if (!result.ok) {
			throw new Error(`expected a derived ramp set, got ${result.error.kind}`);
		}

		return checkContrast(buildTokenSet(result.schemes, failingSeed, BALANCED));
	}

	it('repairs the derived base so the store’s token set passes AA, where the same seed built with no repair would not', () => {
		// Grounds the rest of the test in the seed actually failing today, rather than trusting the
		// docblock above: a seed the engine stopped breaking would make every assertion below vacuous.
		expect(unrepairedReport().some((entry) => !entry.passes)).toBe(true);

		const { store } = openWorkspace();
		const { contrast } = store.getState();

		expect(contrast).not.toBeNull();
		expect(contrast?.report.every((entry) => entry.passes)).toBe(true);
		expect(contrast?.unrepaired).toEqual([]);
	});

	it('keeps a user override that re-breaks a repaired pair, and reports it failing in contrast', () => {
		const { store } = openWorkspace();
		const mutedAlias = store.getState().tokenSet?.schemes.light.semantic.muted?.alias;

		if (!mutedAlias) {
			throw new Error('expected "muted" to resolve in the light scheme');
		}

		// Aliasing the foreground straight onto its own background is the bluntest re-break there
		// is: contrast collapses to 1:1 no matter what the repair already did to either side.
		store.getState().setOverride({
			kind: 'alias',
			scheme: 'light',
			token: 'muted-foreground',
			alias: mutedAlias,
		});

		const { tokenSet, contrast } = store.getState();
		const mutedEntry = contrast?.report.find(
			(entry) => entry.scheme === 'light' && entry.foreground === 'muted-foreground',
		);

		expect(tokenSet?.schemes.light.semantic['muted-foreground']?.alias).toBe(mutedAlias);
		expect(mutedEntry).toMatchObject({ passes: false });
	});

	it('stores only the user’s overrides on commit, never the repair, which is recomputed on load', async () => {
		const { store, recordStore } = openWorkspace();

		// No `setOverride` call: this workspace is open on `failingSeed` and passes AA only because
		// of the repair the first test above proves ran.
		await store.getState().commit();

		const written = recordStore.puts.at(-1)!.versions.at(-1)!;

		expect(written.tokenSet).toBeNull();
		expect(written.overrides).toEqual([]);
	});
});
