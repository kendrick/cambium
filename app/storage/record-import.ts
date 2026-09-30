import { FIRST_REVISION } from '../../core/brand-record';
import { type ArchiveError, deserializeRecord } from '../../core/record-archive';

import type { RecordStore } from './record-store';

/**
 * `ok: false` carries the `ArchiveError` `deserializeRecord` returned, and `store.put` never ran. A
 * rejected `store.put` isn't caught here. It propagates to the caller, and a `put` that rejects has
 * written nothing: both stores parse and run `nextCommit` before writing, and the IndexedDB
 * store writes inside one transaction, so a quota failure rolls back too. `id` on success is the
 * fresh id `mintId` chose, not the one the archive was exported under, so import never recreates an
 * id. Import also drops the archive's `incarnation`, so storage stamps the new record a fresh one.
 */
export type ImportResult = { ok: true; id: string } | { ok: false; error: ArchiveError };

/**
 * Deserializes before minting anything, so a bad archive never spends an id or reaches `store.put`.
 * `mintId` is a parameter rather than a bare `crypto.randomUUID()` call so a test can hand it a
 * predictable id without stubbing a global.
 */
export async function importRecordArchive(
	store: RecordStore,
	bytes: Uint8Array,
	mintId: () => string = () => crypto.randomUUID(),
): Promise<ImportResult> {
	const deserialized = deserializeRecord(bytes);

	if (!deserialized.ok) return { ok: false, error: deserialized.error };

	const id = mintId();
	// The incarnation names the record this archive was exported from. `put` refuses an insert that
	// carries one, since only a copy of a stored record can, so storage has to mint a fresh one.
	const { incarnation: _exported, ...restored } = deserialized.record;
	await store.put({ ...restored, id, revision: FIRST_REVISION });

	return { ok: true, id };
}
