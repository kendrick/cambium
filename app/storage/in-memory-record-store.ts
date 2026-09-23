import { type BrandRecord, BrandRecordSchema } from '../../core/brand-record';

import { type RecordStore, nextCommit } from './record-store';

/**
 * Backed by a `Map` keyed on record id. Every record entering or leaving it round-trips through
 * `BrandRecordSchema.parse`, which does two jobs at once. It is what enforces `RecordStore`'s
 * no-credential guarantee (see `record-store.ts`), and because a parsed strictObject is a fresh
 * object graph rather than the input re-wrapped, it is also what keeps a caller's own reference
 * to a record it just put or just got from ever reaching the map itself — the isolation a real
 * backend gets for free from structured clone or JSON.
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
			// Parsed before the map is consulted, so a record that is both malformed and stale reads
			// as malformed. Validation is the trust boundary; staleness is a fact about a valid
			// record's place in a history.
			const validated = BrandRecordSchema.parse(record);
			const stored = records.get(validated.id);

			// Throws where the write was not built on what is stored, and stamps the revision where it
			// was. Everything from the read to the set runs synchronously, so nothing can write
			// between them.
			const committed = nextCommit(stored, validated);

			records.set(validated.id, committed);

			// A second parse rather than the object just stored. `put` hands a record back now, and
			// the map must be no more reachable through that than through the caller's own input.
			return BrandRecordSchema.parse(committed);
		},

		async delete(id) {
			records.delete(id);
		},
	};
}
