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
 * `put` refuses a write that did not come from the record as storage currently holds it. A write
 * has to follow the stored record on both counts: its `revision` is the one after the stored
 * record's, and its `versions` carry every stored version unchanged and in place. Anything else
 * rejects with `StaleRecordWriteError`. See `followsStoredRecord`, where the rule is written down
 * once for every implementation to share.
 *
 * The check lives here because nothing above it can make it. Keying on record id plus version count
 * refuses a record deleted and recreated under the same id, forever; keying on object identity is
 * defeated by `get`, which hands back a fresh object graph on every read, so a re-read copy is a
 * different object holding the same old history. #21 tried both and review defeated both. The only
 * authority on what is stored is storage.
 *
 * The guarantee covers every field, because `revision` counts commits of the record rather than
 * entries in its history. A write that adds a reference image and appends no version still moves
 * the revision, so `put` stores it. That covers `images` today, and an image tag and a brand URL
 * once #77 lands.
 *
 * A caller has to carry `revision` forward on every commit, images-only ones included. A commit
 * that leaves the revision where it was reads exactly like a second write off the same copy, and
 * `put` refuses it as one.
 *
 * `versions` keeps a second rule on top of that one, which is #67's. The stored history has to
 * arrive unchanged and in place: a write may append to that history or leave it alone, and may
 * never rewrite or drop from it. Callers read the last entry as current, and a version is the
 * record of what was generated at one moment, so editing one rewrites history a later version may
 * cite.
 *
 * Restoring an archive over a record that still exists gets no special handling here. `put` judges
 * an archive as it judges any other write, so it accepts one whose revision is the successor of the
 * stored revision and whose versions extend the stored history, storing it over what is there.
 * Nothing asks whether the two records share a past. An archive further ahead than that, or one
 * carrying a different history, rejects. Restore belongs to #15 and #29, and whether to keep that
 * behaviour or force `delete` and then `put` instead is theirs to settle.
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
 * Whether `incoming` follows `stored`, which is what "derived from the record as it stands" means,
 * and the only thing `put` accepts.
 *
 * The revision has to be the stored one's successor rather than merely ahead of it. The successor
 * test and a bare `> stored.revision` part company over a copy that runs more than one ahead: a
 * writer that read revision 1 and committed twice without writing back arrives holding 3 while
 * storage still holds 1. That copy's history can extend the stored history cleanly, so the history
 * rule below has nothing to say about it and `>` takes the write. Storage is the only authority on
 * what the next revision is, and every write it accepts moves the number by one. A copy that jumps
 * the count files commits storage never took, and `revision` stops counting the writes the record
 * actually holds. The recovery is the one every stale copy gets: re-read and commit again.
 *
 * Equal revisions are the case worth spelling out, because accepting them looks harmless while the
 * history check is still in place. Two writers read revision 1. One adds an image and commits 2,
 * which leaves the stored history untouched. The other appends a version and commits its own 2.
 * The stored history is still a prefix of what that second write brings, so the revision is the
 * only thing standing between it and an image dropped in silence. That is this seam's own defect
 * wearing the field #78 filed it for.
 *
 * The history comparison does a job the revision cannot, which is why #67's rule stays on top of
 * it. A revision that agrees says nothing about whether the incoming history is well formed, and
 * comparing counts is necessary and not sufficient. A writer that read `[v1]` and committed twice
 * arrives holding `[v1, v2b, v3b]` while storage holds `[v1, v2a]`, so the incoming history is
 * longer and still derived from a copy that never saw `v2a`, and a count-only rule accepts it and
 * drops `v2a`.
 * `BrandRecordSchema` forces ordinals to start at 1 and increase with no gaps, so a longer history
 * always looks well formed and the ordinals cannot tell these two apart.
 *
 * A history shorter than the stored one needs no check of its own. Slicing it to the stored length
 * yields the whole of that history back, and two JSON arrays of different lengths never serialise
 * alike, so the comparison below already refuses it.
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
export function followsStoredRecord(stored: BrandRecord, incoming: BrandRecord): boolean {
	return (
		incoming.revision === stored.revision + 1 &&
		JSON.stringify(stored.versions) ===
			JSON.stringify(incoming.versions.slice(0, stored.versions.length))
	);
}

/**
 * Thrown when a `put` arrives from a copy storage has already moved past. Either the incoming
 * revision is not the one after the stored record's, or the history the write brings is not the
 * stored history continued. The version counts this error carries are context rather than the test
 * the write failed, and they measure neither that test nor how far behind the losing copy is. Two
 * writers that each added only an image produce equal counts. A loser that appended no version
 * behind a winner that appended one produces 2 against 1. `kind` follows the same
 * discriminated-error convention as `StorageQuotaExceededError` and the core's `SeedParseError`,
 * so a caller branches on a field rather than on a message. The recovery is always the same—re-read
 * the record and commit again—and a caller can only choose it if it can tell this apart from a
 * malformed record or a full origin.
 *
 * The counts are reported because the store is the only thing that can report them honestly.
 * `StaleWorkspaceError` one layer up deliberately carries none, since anything the workspace could
 * offer would be what it wrote rather than what storage holds.
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
			`record ${recordId} has been written since this copy was read, so writing it back would drop what landed in between; storage holds ${storedVersions} versions and this copy holds ${incomingVersions}`,
			options,
		);
		this.name = 'StaleRecordWriteError';
		this.recordId = recordId;
		this.storedVersions = storedVersions;
		this.incomingVersions = incomingVersions;
	}
}
