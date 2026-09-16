import type { BrandRecord } from '../../core/brand-record';

/**
 * Storage is deliberately not part of the pure core. This phase keeps records in memory, the
 * next writes them to IndexedDB, and a hosted version would put them behind HTTP; every method
 * here is async and can reject so that none of those rewrites has to widen the interface.
 *
 * `put` takes a whole `BrandRecord`, a `z.strictObject` with no field shaped for a credential.
 * An implementation that validates its input before storing therefore cannot accept an API key
 * even if a caller tries to smuggle one in alongside a record — the schema is where that
 * guarantee actually lives, not a check inside this seam.
 *
 * `delete` resolves whether or not a record with that id exists, matching IndexedDB's own
 * `objectStore.delete`, which succeeds silently on a missing key. A caller holding an id
 * usually can't know whether it's already gone, so treating that as an error would invent a
 * failure the platform doesn't have.
 *
 * `list` makes no promise about order. A Map preserves insertion order for free; IndexedDB
 * returns key order; an HTTP backend might paginate or sort server-side. Ordering versions
 * within a record is `BrandRecordSchema`'s job, not this seam's.
 */
export type RecordStore = {
	list(): Promise<BrandRecord[]>;
	get(id: string): Promise<BrandRecord | null>;
	put(record: BrandRecord): Promise<void>;
	delete(id: string): Promise<void>;
};
