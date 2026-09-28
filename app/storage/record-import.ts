import { FIRST_REVISION } from '../../core/brand-record';
import { type ArchiveError, deserializeRecord } from '../../core/record-archive';

import type { RecordStore } from './record-store';

/**
 * `ok: false` carries the same `ArchiveError` `deserializeRecord` returned, so a caller branches on
 * one `kind` whether the archive was unreadable or the write itself failed. `id` on success is the
 * fresh id `mintId` chose, not the one the archive was exported under: import never recreates an id
 * (see `record-store.ts`'s docblock on why that gap has to stay dormant).
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
	await store.put({ ...deserialized.record, id, revision: FIRST_REVISION });

	return { ok: true, id };
}
