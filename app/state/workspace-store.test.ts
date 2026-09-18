import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { type BrandRecord, type BrandVersion, SCHEMA_VERSION } from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import type { ScaleEngine, ScaleEngineResult } from '../../core/scale-engine';
import { createInMemoryRecordStore } from '../storage/in-memory-record-store';
import type { RecordStore } from '../storage/record-store';
import { StorageQuotaExceededError } from '../storage/storage-estimate';

import {
	CommitAbandonedError,
	type CommitProvenance,
	createWorkspaceStore,
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
}

function makeVersion(overrides: Partial<BrandVersion> = {}): BrandVersion {
	return {
		createdAt: '2026-01-01T00:00:00.000Z',
		ordinal: 1,
		seed: seedWith(259.8),
		tokenSet: null,
		provider: 'anthropic',
		model: 'claude-opus-5',
		promptVersion: 'seed-v3',
		rawResponse: '{"keyColors":[]}',
		scaleEngine: 'cambium-oklch-1',
		fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		interpretation: 'balanced',
		...overrides,
	};
}

function makeRecord(versions: BrandVersion[] = [makeVersion()]): BrandRecord {
	return {
		id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
		schemaVersion: SCHEMA_VERSION,
		images: [{ id: 'img-1', downscaled: 'data:image/png;base64,AA==', originalHash: 'sha256-aa' }],
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
			surfacePolarity: null,
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

	it('serialises overlapping commits so the second cannot overwrite the first', async () => {
		const { store, recordStore } = openWorkspace();

		// No await between them: `put` writes the record whole, so a second commit that counted its
		// ordinal off the pre-commit record would drop the first version on the way past.
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
			promptVersion: 'seed-v3',
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
		// still in flight. Appending from there recounts an ordinal that already exists, and `put`
		// replaces the whole record, so the finished commit would vanish.
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
