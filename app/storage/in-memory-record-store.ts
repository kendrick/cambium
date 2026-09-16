import { type BrandRecord, BrandRecordSchema } from '../../core/brand-record';

import type { RecordStore } from './record-store';

/**
 * Backed by a `Map` keyed on record id. Every record entering or leaving it round-trips through
 * `BrandRecordSchema.parse`, which does two jobs at once. It is what makes AC 6 hold: the schema
 * is a `z.strictObject` with no field shaped for a credential, so a record carrying one, smuggled
 * or not, fails to parse and the promise rejects rather than reaching the map. And because a
 * parsed strictObject is a fresh object graph rather than the input re-wrapped, it is also what
 * keeps a caller's own reference to a record it just put or just got from ever reaching the map
 * itself — the isolation a real backend gets for free from structured clone or JSON.
 */
export function createInMemoryRecordStore(): RecordStore {
	const records = new Map<string, BrandRecord>();

	return {
		async list() {
			return [...records.values()].map((record) => BrandRecordSchema.parse(record));
		},

		async get(id) {
			const record = records.get(id);
			return record ? BrandRecordSchema.parse(record) : null;
		},

		async put(record) {
			records.set(record.id, BrandRecordSchema.parse(record));
		},

		async delete(id) {
			records.delete(id);
		},
	};
}
