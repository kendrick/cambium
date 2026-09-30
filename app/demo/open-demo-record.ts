import { BrandRecordSchema, FIRST_REVISION } from '../../core/brand-record';
import type { RecordStore } from '../storage/record-store';

/**
 * Inserts a committed demo record as a new record of the visitor's own, as `importRecordArchive` does: a fresh id every time and no incarnation, so storage mints one. Writing under the fixture's committed id would let a reopened demo recreate an id the visitor deleted (#122). Writes once, so it stays inside the insert-only limit `record-store.ts` documents.
 *
 * The incarnation drop is defensive. `scripts/demo-fixture.mjs` strips it before writing a fixture, but `put` refuses an insert that carries one, and a hand-edited fixture shouldn't break the demo.
 *
 * `raw` is the fetched JSON, so it's parsed here before anything is minted. `put` parses again, but a body that isn't a record shouldn't spend an id.
 */
export async function openDemoRecord(
	store: RecordStore,
	raw: unknown,
	name: string,
	mintId: () => string = () => crypto.randomUUID(),
): Promise<string> {
	const { incarnation: _dropped, ...fixture } = BrandRecordSchema.parse(raw);
	const id = mintId();

	await store.put({ ...fixture, id, revision: FIRST_REVISION, name: fixture.name ?? name });

	return id;
}
