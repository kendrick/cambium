import { describe, expect, it, vi } from 'vitest';

import { type BrandRecord, type BrandVersion, SCHEMA_VERSION } from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import type { ScaleEngine, ScaleEngineResult } from '../../core/scale-engine';
import { createInMemoryRecordStore } from '../storage/in-memory-record-store';
import type { RecordStore } from '../storage/record-store';
import { StorageQuotaExceededError } from '../storage/storage-estimate';

import { type CommitProvenance, createWorkspaceStore } from './workspace-store';

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
			await inner.put(record);
		},
	};
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

describe('the workspace store', () => {
	// Says only what it can: the whole suite runs under `environment: 'node'`, so this asserts the
	// store drives to completion where a browser never existed. `zustand/vanilla` is what makes that
	// true — the React entry point would have pulled in `useSyncExternalStore`.
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

		const next = await store.getState().commit();

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
		const store = createWorkspaceStore({ recordStore: createInMemoryRecordStore() });

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
			now: () => '2026-06-01T12:00:00.000Z',
		});

		store.getState().open(record);

		await expect(store.getState().commit()).rejects.toBeInstanceOf(StorageQuotaExceededError);

		const state = store.getState();

		expect(state.record).toBe(record);
		expect(state.activeOrdinal).toBe(1);
	});
});
