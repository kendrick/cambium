import type { BrandRecord, BrandVersion } from '../../core/brand-record';

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
 * `put` refuses a write from a record that is already behind what is stored: it rejects with
 * `StaleRecordWriteError` unless the incoming history extends the stored one, holding every stored
 * version unchanged and in place plus at least one more. See `extendsStoredHistory`, which is where
 * the rule is written down once for every implementation to share.
 *
 * The check lives here because nothing above it can make it. Keying on record id plus version count
 * refuses a record deleted and recreated under the same id, forever; keying on object identity is
 * defeated by `get`, which hands back a fresh object graph on every read, so a re-read copy is a
 * different object holding the same old history. #21 tried both and review defeated both. The only
 * authority on what is stored is storage.
 *
 * The guarantee covers `versions` and nothing else, because `versions.length` is the only counter a
 * record carries. Every other field rides along with whatever write happens to hold it: `images`
 * today, and an image tag and a brand URL once #77 lands. So a write that changes one of those
 * without appending a version is refused, since equal counts read as stale. A record stored before
 * its first generation is frozen at that moment, and adding a second reference image to a saved
 * brand has no path through this seam at all.
 *
 * That is a real limit rather than the rule working, and #78 owns closing it. The fix is a revision
 * covering the whole record, which is a `core/` schema change this seam does not own. Refusing is the safe half
 * of the trade in the meantime. Accepting equal counts would let two writers each add an image and
 * let the second drop the first's, which is this ticket's own defect wearing a different field.
 *
 * Restoring an archive over a record that still exists rejects for the same reason. The recovery is
 * `delete` and then `put`.
 *
 * `put` resolves with the record as stored, after parsing. `BrandSeedSchema` canonicalises values
 * that have two spellings — a hue committed as 360 is stored as 0 — so a caller that adopts the
 * object it passed in holds a record that differs from the persisted one. Returning the parsed
 * record costs nothing at a seam that already parses, and it saves the caller either a `get` after
 * every write or a zod schema in its own chunk.
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
	put(record: BrandRecord): Promise<BrandRecord>;
	delete(id: string): Promise<void>;
};

/**
 * Whether `incoming` extends `stored`, which is what "derived from the record as it stands" means
 * for an append-only history, and the only thing `put` accepts.
 *
 * Comparing counts is necessary and not sufficient. A writer that read `[v1]` and committed twice
 * arrives holding `[v1, v2b, v3b]` while storage holds `[v1, v2a]`: the incoming history is longer
 * and still derived from a copy that never saw `v2a`, so a count-only rule accepts it and drops
 * `v2a`. That is this seam's own defect one version further along. `BrandRecordSchema` forces
 * ordinals to start at 1 and increase with no gaps, so a longer history always looks well formed
 * and the ordinals cannot tell these two apart.
 *
 * Compared by serialisation, which is sound only because of what `BrandRecordSchema` refuses.
 * Nothing in a parsed record is optional, so no key holds `undefined` for `JSON.stringify` to drop.
 * Zod rejects every non-finite number, checked against each unbounded field rather than assumed, so
 * nothing serialises to `null` without being null. `z.array` yields dense arrays, so no hole does
 * either. Both sides have been through that parse: the incoming record at the top of `put`, the
 * stored one when it was written. A schema change that relaxes any of those weakens this comparison
 * with nothing failing to say so, and #77 edits these very schemas.
 *
 * `-0` is the one value the schema admits that serialises like another. It collapses to `0` here,
 * which is right rather than merely tolerated: the two are the same number, `sameJson` upstream
 * already treats them so, every adapter emits `0` for both, and a JSON archive cannot carry the
 * difference at all, so an export and import erases it whatever this comparison does.
 * Distinguishing them would refuse a write that changes nothing, and go on refusing it.
 *
 * Key order is the one assumption that can fail, and it fails safely. Both sides come out of the
 * same parse, and a stored record reaches this through a structured clone that preserves order, so
 * the two agree. If that stopped holding, the write would be refused where the caller can see it
 * rather than a version going missing in silence.
 *
 * A structural walk would say the same thing, and `app/state/` has one in `sameJson`. It stays
 * there: storage reaching up a layer to borrow a helper is the wrong direction, and against the
 * refusals above the walk has nothing left to catch.
 *
 * The walk costs one pass over the stored history. `put` already serialises the whole record,
 * reference images included, so this is cheaper than the write it guards.
 */
export function extendsStoredHistory(stored: BrandVersion[], incoming: BrandVersion[]): boolean {
	return (
		incoming.length > stored.length &&
		JSON.stringify(stored) === JSON.stringify(incoming.slice(0, stored.length))
	);
}

/**
 * Thrown when a `put` arrives from a record that is already behind what is stored: storage holds at
 * least as many versions as the incoming record does. `kind` follows the same discriminated-error
 * convention as `StorageQuotaExceededError` and the core's `SeedParseError`, so a caller branches
 * on a field rather than on a message. The recovery is always the same — re-read the record and
 * commit again — and a caller can only choose it if it can tell this apart from a malformed record
 * or a full origin.
 *
 * The counts are reported because the store is the only thing that can report them honestly.
 * `StaleWorkspaceError` one layer up deliberately carries none, since anything the workspace could
 * offer would be what it wrote rather than what storage holds. Here they are the same number.
 */
export class StaleRecordWriteError extends Error {
	readonly kind = 'stale-record-write';
	readonly recordId: string;
	readonly storedVersions: number;
	readonly incomingVersions: number;

	constructor(
		recordId: string,
		storedVersions: number,
		incomingVersions: number,
		options?: { cause?: unknown },
	) {
		super(
			`record ${recordId} already holds ${storedVersions} versions, so writing ${incomingVersions} from an older copy would drop one`,
			options,
		);
		this.name = 'StaleRecordWriteError';
		this.recordId = recordId;
		this.storedVersions = storedVersions;
		this.incomingVersions = incomingVersions;
	}
}
