import {
	IDBCursor,
	IDBCursorWithValue,
	IDBDatabase,
	IDBFactory,
	IDBIndex,
	IDBKeyRange,
	IDBObjectStore,
	IDBOpenDBRequest,
	IDBRequest,
	IDBTransaction,
	IDBVersionChangeEvent,
} from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type BrandRecord, SCHEMA_VERSION } from '../../core/brand-record';

import {
	RECORD_STORE_NAME,
	closeIndexedDbRecordStore,
	createIndexedDbRecordStore,
} from './indexed-db-record-store';
import { testRecordStoreContract } from './record-store-contract';

/**
 * `fake-indexeddb/auto` is the documented way to install these and it cannot be used here. It is a
 * bare import, `.oxlintrc.json` errors on any bare import outside CSS, and that fails `pnpm verify`
 * before it fails anything else.
 *
 * Assigning the globals by hand costs nothing, because a fresh `IDBFactory` per test is what gives
 * every test its own database, which is the isolation the shared contract suite is written to
 * expect. The classes beside the factory are not optional. `idb` identifies what it wraps with
 * `instanceof` against the global `IDBRequest`, `IDBTransaction`, and the rest, and Node defines
 * none of them.
 */
const indexedDbClasses = {
	IDBCursor,
	IDBCursorWithValue,
	IDBDatabase,
	IDBIndex,
	IDBKeyRange,
	IDBObjectStore,
	IDBOpenDBRequest,
	IDBRequest,
	IDBTransaction,
	IDBVersionChangeEvent,
};

function installFakeIndexedDb() {
	for (const [name, value] of Object.entries(indexedDbClasses)) {
		vi.stubGlobal(name, value);
	}

	vi.stubGlobal('indexedDB', new IDBFactory());
}

// A real downscaled image is a data URL holding the WebP the pipeline resized before sending it to
// the model. This is the smallest honest stand-in for one: same shape, same encoding, one pixel.
const downscaled = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

function makeRecordWithImage(): BrandRecord {
	return {
		id: crypto.randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		images: [{ id: 'img-1', downscaled, originalHash: 'sha256:abc' }],
		versions: [
			{
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
			},
		],
	};
}

describe('createIndexedDbRecordStore', () => {
	beforeEach(installFakeIndexedDb);

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	testRecordStoreContract(() => createIndexedDbRecordStore());
});

/**
 * What the shared suite cannot say. Its `makeRecord` stores `images: []`, so no test in it holds a
 * reference image, and the suite keeps one store for the length of a test, so nothing in it
 * outlives a connection. Widening the suite to cover either would make it a suite about IndexedDB.
 */
describe('createIndexedDbRecordStore persistence', () => {
	beforeEach(installFakeIndexedDb);

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps a record and its images after the connection closes and another opens', async () => {
		const record = makeRecordWithImage();
		const store = await createIndexedDbRecordStore();
		await store.put(record);

		// Closing is what makes this a reload rather than a second read. A store that answered from
		// its own connection would pass either way while proving nothing about the database.
		closeIndexedDbRecordStore(store);
		const reopened = await createIndexedDbRecordStore();

		expect(await reopened.get(record.id)).toEqual(record);
		expect(await reopened.list()).toEqual([record]);
	});

	// Reading rejects rather than skipping or repairing. The export archive is the only migration
	// path, and a mismatch that reads as an empty list would look like lost work instead of a
	// version the archive can carry forward.
	it('throws when a stored record no longer matches the current schema version', async () => {
		const databaseName = 'schema-mismatch';
		const store = await createIndexedDbRecordStore({ databaseName });
		const stale = { ...makeRecordWithImage(), schemaVersion: SCHEMA_VERSION - 1 };

		// Written through a raw connection because `put` is exactly what refuses to store a record the
		// current schema rejects, which leaves such a record no other way into the database.
		const seeding = await openDB(databaseName);
		await seeding.put(RECORD_STORE_NAME, stale);
		seeding.close();

		await expect(store.get(stale.id)).rejects.toThrow(Error);
		await expect(store.list()).rejects.toThrow(Error);
	});
});
