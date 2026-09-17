import {
	type DBSchema,
	type IDBPDatabase,
	type IDBPObjectStore,
	type StoreNames,
	openDB,
} from 'idb';

import { type BrandRecord, BrandRecordSchema } from '../../core/brand-record';

import type { RecordStore } from './record-store';
import { toStorageWriteError } from './storage-estimate';

interface CambiumDatabase extends DBSchema {
	records: {
		key: string;
		value: BrandRecord;
	};
}

export const DATABASE_NAME = 'cambium';

/**
 * The database version says what object stores exist. A record's `schemaVersion` says what shape a
 * record has. Migration between record shapes is a declared non-goal, so the database version
 * moves only when the store layout does.
 */
export const DATABASE_VERSION = 1;

export const RECORD_STORE_NAME: StoreNames<CambiumDatabase> = 'records';

type RecordWriteStore = IDBPObjectStore<
	CambiumDatabase,
	[typeof RECORD_STORE_NAME],
	typeof RECORD_STORE_NAME,
	'readwrite'
>;

const openConnections = new WeakMap<RecordStore, IDBPDatabase<CambiumDatabase>>();

export type IndexedDbRecordStoreOptions = {
	/** Lets a test or a dev tool work in a database of its own, away from the user's. */
	databaseName?: string;
};

/**
 * A `RecordStore` over IndexedDB, which is here for the quota. Three downscaled reference images
 * run to roughly a megabyte each, and `localStorage` holds about five for the whole origin, so it
 * fails on the second saved brand.
 *
 * One object store holds whole records, images included, as the data URLs the record already
 * carries. Splitting the images into Blobs in a second store would save the roughly one-third
 * base64 overhead and cost a wider transaction plus orphan cleanup on delete. Worth revisiting
 * when a real record makes `list` slow, and not before, because nothing has been persisted yet.
 *
 * Every record round-trips through `BrandRecordSchema.parse` in both directions, the same idea the
 * in-memory implementation runs on. Parsing on the way in enforces `RecordStore`'s no-credential
 * guarantee, and it runs before the write so a rejected `put` leaves nothing behind. Parsing on
 * the way out validates what actually came off disk, which matters more here than it does over a
 * Map. A record stamped with an older `schemaVersion` therefore throws on `get` and on `list`
 * alike, which is deliberate. The export archive is the only migration path, and it only works if
 * a mismatch is loud.
 *
 * Opening is async, so the factory is too. The contract suite already accepts a promised store.
 */
export async function createIndexedDbRecordStore(
	options: IndexedDbRecordStoreOptions = {},
): Promise<RecordStore> {
	const database = await openDB<CambiumDatabase>(
		options.databaseName ?? DATABASE_NAME,
		DATABASE_VERSION,
		{
			upgrade(created) {
				// Keyed in-line on the record's own id, so a put cannot file a record under a key that
				// disagrees with it.
				created.createObjectStore(RECORD_STORE_NAME, { keyPath: 'id' });
			},
		},
	);

	/**
	 * Awaits the request and the transaction together, and both halves earn their place. A write can
	 * succeed and the transaction still abort afterwards, which is what WebKit does when it suspends
	 * a page on iOS, and `tx.done` is the only thing that reports it. Every generation is an
	 * immutable version, so a write dropped in silence loses one. Awaiting the two in sequence
	 * instead would leave whichever rejects second unhandled.
	 */
	async function write(operation: (records: RecordWriteStore) => Promise<unknown>): Promise<void> {
		const tx = database.transaction(RECORD_STORE_NAME, 'readwrite');

		try {
			await Promise.all([operation(tx.store), tx.done]);
		} catch (cause) {
			throw toStorageWriteError(cause);
		}
	}

	const store: RecordStore = {
		async list() {
			const stored = await database.getAll(RECORD_STORE_NAME);
			return stored.map((record) => BrandRecordSchema.parse(record));
		},

		async get(id) {
			const stored = await database.get(RECORD_STORE_NAME, id);
			return stored === undefined ? null : BrandRecordSchema.parse(stored);
		},

		async put(record) {
			const validated = BrandRecordSchema.parse(record);
			await write((records) => records.put(validated));
		},

		async delete(id) {
			await write((records) => records.delete(id));
		},
	};

	openConnections.set(store, database);

	return store;
}

/**
 * Releases the connection a store opened. It is a function beside the interface rather than a
 * method on it, because `RecordStore` describes moving records and a hosted implementation would
 * have nothing to close.
 *
 * A tab that holds one store for its lifetime never needs this. A test proving a record outlives
 * the connection that wrote it does.
 */
export function closeIndexedDbRecordStore(store: RecordStore): void {
	openConnections.get(store)?.close();
}
