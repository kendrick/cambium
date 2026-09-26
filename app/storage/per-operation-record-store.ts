import type { BrandRecord } from '../../core/brand-record';

import type { RecordStore } from './record-store';

/**
 * A `RecordStore` that opens a connection for each call and closes it before the call settles, so
 * nothing stays open between a person's saves. The workspace outlives any one operation by minutes
 * or hours, and a connection it held that long is what a later tab's version upgrade would stall
 * behind: `openDB` passes no `blocked` handler, so that tab would hang rather than fail (see
 * `components/landing/landing-route.tsx`).
 *
 * The opener and closer are injected rather than imported, so this module names no storage engine
 * and the IndexedDB code stays in the chunk that already loads it.
 */
export function createPerOperationRecordStore(
	open: () => Promise<RecordStore>,
	close: (store: RecordStore) => void,
): RecordStore {
	async function withStore<T>(operation: (store: RecordStore) => Promise<T>): Promise<T> {
		const store = await open();

		try {
			return await operation(store);
		} finally {
			close(store);
		}
	}

	return {
		list: () => withStore((store) => store.list()),
		get: (id: string) => withStore((store) => store.get(id)),
		put: (record: BrandRecord) => withStore((store) => store.put(record)),
		delete: (id: string) => withStore((store) => store.delete(id)),
	};
}
