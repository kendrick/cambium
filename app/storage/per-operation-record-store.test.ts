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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type BrandRecord, SCHEMA_VERSION } from '../../core/brand-record';

import {
	DATABASE_NAME,
	closeIndexedDbRecordStore,
	createIndexedDbRecordStore,
} from './indexed-db-record-store';
import { createPerOperationRecordStore } from './per-operation-record-store';
import type { RecordStore } from './record-store';
import { testRecordStoreContract } from './record-store-contract';

/** Installed by hand for the reason `indexed-db-record-store.test.ts` gives. */
function installFakeIndexedDb() {
	for (const [name, value] of Object.entries({
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
	})) {
		vi.stubGlobal(name, value);
	}

	vi.stubGlobal('indexedDB', new IDBFactory());
}

function makeRecord(): BrandRecord {
	return {
		id: crypto.randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: 1,
		brandUrl: null,
		images: [],
		versions: [],
	};
}

/**
 * Deleting a database waits on every open connection, and fires `blocked` while one is still open.
 * A delete that succeeds is the browser's own word that nothing was left holding the database.
 */
function deleteReportsBlocked(): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DATABASE_NAME);
		request.addEventListener('blocked', () => resolve(true));
		request.addEventListener('success', () => resolve(false));
		request.addEventListener('error', () => reject(request.error));
	});
}

describe('createPerOperationRecordStore over IndexedDB', () => {
	beforeEach(installFakeIndexedDb);

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	testRecordStoreContract(() =>
		createPerOperationRecordStore(createIndexedDbRecordStore, closeIndexedDbRecordStore),
	);
});

describe('createPerOperationRecordStore connection lifetime', () => {
	beforeEach(installFakeIndexedDb);

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('leaves no connection open once a call settles, so a delete is never blocked', async () => {
		const store = createPerOperationRecordStore(
			createIndexedDbRecordStore,
			closeIndexedDbRecordStore,
		);
		const record = makeRecord();

		await store.put(record);
		expect(await store.get(record.id)).toEqual(record);

		expect(await deleteReportsBlocked()).toBe(false);
	});

	it('still closes when the call rejects', async () => {
		const store = createPerOperationRecordStore(
			createIndexedDbRecordStore,
			closeIndexedDbRecordStore,
		);
		const record = makeRecord();
		await store.put(record);

		// Built on a revision storage has moved past, so `put` refuses it inside the operation.
		await expect(store.put({ ...record, revision: 7 })).rejects.toMatchObject({
			kind: 'stale-record-write',
		});

		expect(await deleteReportsBlocked()).toBe(false);
	});

	// The control for the two tests above: an unclosed store does block the delete, so a `false`
	// there is the close at work and not a fake that never reports `blocked`.
	it('is measured by a delete that does report a connection held open', async () => {
		const held: RecordStore = await createIndexedDbRecordStore();
		await held.put(makeRecord());

		expect(await deleteReportsBlocked()).toBe(true);

		closeIndexedDbRecordStore(held);
	});
});
