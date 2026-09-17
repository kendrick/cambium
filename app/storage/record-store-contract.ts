import { beforeEach, describe, expect, it } from 'vitest';

import { type BrandRecord, type BrandVersion, SCHEMA_VERSION } from '../../core/brand-record';

import type { RecordStore } from './record-store';

function makeVersion(overrides: Partial<BrandVersion> = {}): BrandVersion {
	return {
		createdAt: '2026-01-01T00:00:00.000Z',
		ordinal: 1,
		seed: null,
		tokenSet: null,
		provider: 'anthropic',
		model: 'claude-opus-5',
		promptVersion: 'seed-v3',
		rawResponse: null,
		scaleEngine: 'cambium-oklch-1',
		fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		interpretation: 'balanced',
		...overrides,
	};
}

function makeRecord(overrides: Partial<BrandRecord> = {}): BrandRecord {
	return {
		id: crypto.randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		images: [],
		versions: [makeVersion()],
		...overrides,
	};
}

/**
 * Runs against any `RecordStore`. This file imports nothing but the interface and the schema it
 * moves, so a future IndexedDB or HTTP implementation passes it unchanged; if it doesn't, the
 * seam promised something this contract never actually specified.
 *
 * `createStore` is called fresh before every test rather than once for the whole suite, so one
 * test's records can never leak into the next regardless of how the implementation persists.
 */
export function testRecordStoreContract(createStore: () => RecordStore | Promise<RecordStore>) {
	let store: RecordStore;

	beforeEach(async () => {
		store = await createStore();
	});

	describe('list', () => {
		it('resolves an empty list before anything is stored', async () => {
			expect(await store.list()).toEqual([]);
		});

		it('resolves every stored record', async () => {
			const a = makeRecord();
			const b = makeRecord();

			await store.put(a);
			await store.put(b);

			const listed = await store.list();
			// toSorted would say this better, but it's ES2023 and tsconfig targets ES2022; both
			// arrays here are already fresh, so sort has nothing of the caller's to mutate.
			// oxlint-disable-next-line unicorn/no-array-sort
			const ids = listed.map((record) => record.id).sort();
			// oxlint-disable-next-line unicorn/no-array-sort
			expect(ids).toEqual([a.id, b.id].sort());
		});
	});

	describe('get', () => {
		it('resolves null for an id nothing has stored', async () => {
			expect(await store.get(crypto.randomUUID())).toBeNull();
		});

		it('resolves the record most recently put under that id', async () => {
			const record = makeRecord();
			await store.put(record);

			expect(await store.get(record.id)).toEqual(record);
		});
	});

	describe('put', () => {
		// AC 6 is a property of the schema rather than a check this store adds; see the
		// no-credential guarantee documented on `RecordStore` in ./record-store.ts.
		it('rejects a record carrying a field the schema does not declare', async () => {
			const withSmuggledKey = { ...makeRecord(), apiKey: 'sk-live-something' };

			// Matching against `Error` rather than a message keeps this implementation-blind: any
			// validator wording works, as long as an invalid record actually rejects.
			await expect(store.put(withSmuggledKey)).rejects.toThrow(Error);
			expect(await store.get(withSmuggledKey.id)).toBeNull();
		});

		it('overwrites the record already stored under the same id', async () => {
			const record = makeRecord();
			await store.put(record);

			const replaced: BrandRecord = {
				...record,
				versions: [makeVersion({ interpretation: 'expressive' })],
			};
			await store.put(replaced);

			expect(await store.get(record.id)).toEqual(replaced);
			expect(await store.list()).toHaveLength(1);
		});

		// A real backend serializes on the way in (structured clone, JSON over the wire); an
		// in-memory implementation has to earn that isolation on purpose, or a caller holding a
		// reference to what it just passed in can corrupt the store without calling it again.
		it('is not affected by a caller mutating the object passed to put afterward', async () => {
			const record = makeRecord();
			const versionsAtPutTime = [...record.versions];
			await store.put(record);

			record.versions.push(makeVersion({ ordinal: 2, interpretation: 'faithful' }));

			expect(await store.get(record.id)).toEqual({ ...record, versions: versionsAtPutTime });
		});

		// The same isolation has to hold in the other direction: a caller mutating what get handed
		// back must not reach into the store and change what the next get sees. The snapshot has
		// to be taken before the mutation and compared on its own terms: a store that hands back
		// its own internal reference makes `fetched` and a later `get()` result the same object,
		// so asserting against `record` (or against `fetched` itself) would pass either way.
		it('is not affected by a caller mutating a record returned from get', async () => {
			const record = makeRecord();
			await store.put(record);

			const fetched = await store.get(record.id);
			const versionsBeforeMutation = fetched ? [...fetched.versions] : [];
			fetched?.versions.push(makeVersion({ ordinal: 2, interpretation: 'faithful' }));

			expect((await store.get(record.id))?.versions).toEqual(versionsBeforeMutation);
		});

		// This is the store-level half of "a generation appends a version and leaves earlier
		// versions unchanged": generating one is the record library's job and out of scope here,
		// but the store must not corrupt an earlier version when a caller re-puts a longer history.
		it('leaves earlier versions unchanged when a longer history is put under the same id', async () => {
			const first = makeVersion({ ordinal: 1, createdAt: '2026-01-01T00:00:00.000Z' });
			const record = makeRecord({ versions: [first] });
			await store.put(record);

			const second = makeVersion({
				ordinal: 2,
				createdAt: '2026-01-02T00:00:00.000Z',
				interpretation: 'expressive',
			});
			await store.put({ ...record, versions: [first, second] });

			expect((await store.get(record.id))?.versions).toEqual([first, second]);
		});

		// Neither the shape above nor the schema's own tests exercise more than two versions, so
		// a store that reorders on the way out, or drops one from the middle, has nothing here to
		// catch it. Three versions, checked as one array so both position and count matter.
		it('preserves version order and drops none of a longer history', async () => {
			const v1 = makeVersion({ ordinal: 1, createdAt: '2026-01-01T00:00:00.000Z' });
			const v2 = makeVersion({
				ordinal: 2,
				createdAt: '2026-01-02T00:00:00.000Z',
				interpretation: 'expressive',
			});
			const v3 = makeVersion({
				ordinal: 3,
				createdAt: '2026-01-03T00:00:00.000Z',
				interpretation: 'faithful',
			});
			const record = makeRecord({ versions: [v1, v2, v3] });

			await store.put(record);

			expect((await store.get(record.id))?.versions).toEqual([v1, v2, v3]);
		});
	});

	describe('delete', () => {
		it('removes a stored record so a later get resolves null', async () => {
			const record = makeRecord();
			await store.put(record);

			await store.delete(record.id);

			expect(await store.get(record.id)).toBeNull();
		});

		it('leaves the rest of the store alone', async () => {
			const kept = makeRecord();
			const removed = makeRecord();
			await store.put(kept);
			await store.put(removed);

			await store.delete(removed.id);

			expect(await store.list()).toEqual([kept]);
		});

		// Matches IndexedDB's own `objectStore.delete`, which succeeds silently on a missing key,
		// confirmed against fake-indexeddb rather than assumed: a caller holding an id usually
		// can't know whether it's already gone, so treating that as an error invents a failure the
		// platform doesn't have.
		it('resolves without error for an id nothing has stored', async () => {
			await expect(store.delete(crypto.randomUUID())).resolves.toBeUndefined();
		});
	});
}
