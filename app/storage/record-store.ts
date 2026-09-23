import { type BrandRecord, FIRST_REVISION } from '../../core/brand-record';

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
 * `put` refuses a write that was not built on the record as storage currently holds it. A write has
 * to match the stored record on both counts: its `revision` is the one storage holds, naming the
 * revision this copy was read at, and its `versions` carry every stored version unchanged and in
 * place. Anything else rejects with `StaleRecordWriteError`. Storage stamps the next revision
 * itself: on an insert it writes `FIRST_REVISION` over whatever the record arrived carrying, and on
 * a commit it writes one past what it holds. A caller is meant to carry the revision it read rather
 * than compute one, and `wasBuiltOnStored` says what this seam can and cannot do about a caller that
 * computes one anyway. See `nextCommit`, where the rule and the stamp are written down once for
 * every implementation to share.
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
 * A caller carries `revision` through a commit unchanged, images-only ones included, because it
 * says which revision the copy was read at and committing does not change that. The record `put`
 * resolves with carries the revision storage stamped, so a caller that adopts it is holding the base
 * for its next write; one that keeps its own object instead is holding a base storage has left, and
 * its next write is refused.
 *
 * `versions` keeps a second rule on top of that one, which is #67's. The stored history has to
 * arrive unchanged and in place: a write may append to that history or leave it alone, and may
 * never rewrite or drop from it. Callers read the last entry as current, and a version is the
 * record of what was generated at one moment, so editing one rewrites history a later version may
 * cite.
 *
 * Both rules compare an incoming write against the record as storage holds it now. Neither can say
 * which incarnation the write came from, and `revision` cannot supply that, because it restarts
 * at `FIRST_REVISION` when a record is deleted and recreated under the same id. A copy of the
 * deleted incarnation can therefore hold, or later reach, the revision the live record has since
 * reached. Its write then carries the revision storage holds over a history the stored history
 * continues, which is the whole of what `wasBuiltOnStored` checks, so the write is accepted and
 * whatever the live record held is overwritten with no error raised.
 *
 * How often that lines up is deliberately not stated here as a condition. Four attempts to bound it
 * have each been wrong, and each was tested against the cases its own author thought of. #78's
 * red-team measured sixteen, and `record-store-contract.ts` pins the one an ordinary sequence of
 * writes reaches.
 *
 * Closing it takes identity carried on the record, which `core/brand-record.ts` owns rather than
 * this seam. #78 opened it: demanding a longer history used to refuse those writes whatever
 * incarnation they came from, and accepting metadata-only writes took that side effect away. No
 * product code calls `delete` today, and every record is created under a fresh uuid, so no id is
 * ever recreated and nothing a user can do reaches it.
 *
 * Restoring an archive over a record that still exists gets no special handling here. `put` judges
 * an archive as it judges any other write, so it accepts one carrying the revision storage holds
 * over versions that continue the stored history, storing it over what is there. Nothing asks
 * whether the two records share a past. An archive carrying any other revision, or a different
 * history, rejects.
 *
 * #20 owns restore, not #15 or #29: those two export derived token artifacts and both exclude a
 * record archive in their non-goals, and a `BrandRecord` cannot be rebuilt from what either emits.
 * #20 serializes a record to a re-importable archive, and one of its acceptance criteria is "Export,
 * clear storage, then import yields a token set identical to the original". Clearing storage and
 * importing is delete and recreate, which is the sequence the gap above needs.
 *
 * #20 restores a record as a copy under a fresh uuid rather than in place under the id it was
 * exported with, and it decided that against this gap. Restoring in place recreates an id, and
 * closing what that opens needs incarnation identity on `BrandRecord`, which is a schema change
 * #36's Boundary rules out for the phase: "Nothing in this phase changes an interface, a schema, or
 * a call site established in v1."
 *
 * Nothing recreates an id, then. `delete` has no caller outside the test suites, every record is
 * created under a fresh uuid, and an import mints another one. That is why the gap is dormant, and
 * dormant is not closed: `delete` is still on this interface and `wasBuiltOnStored` still accepts a
 * write against a record recreated under a deleted id. Whatever recreates one first turns the gap
 * on and owes the schema change with it.
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
 * Whether `incoming` was built on `stored`, which is what "derived from the record as it stands"
 * means, and the only thing `put` accepts.
 *
 * The revision has to equal the stored one, not follow it. Comparing against `stored.revision + 1`
 * asks what number the writer wants to write, which a writer can reach by more than one route: a
 * copy read at revision 1 that commits twice locally arrives holding 3, and against a record another
 * writer has already moved to 2 that reads as the legitimate next commit while the history it brings
 * extends the stored one cleanly. Comparing the revision the writer read asks the question that
 * actually decides the write, and there is one answer to it.
 *
 * What this cannot check is whether a revision the writer presents is one it really read. The
 * number is small and a caller can compute one, so a caller that increments its own revision can
 * land on the value storage holds and be accepted. Nothing in the two records distinguishes that
 * from a copy read at that revision. It is the same limit the module docblock describes for an id
 * that was deleted and recreated, reached by a different route: `revision` counts commits and does
 * not identify a lineage. A caller carries the revision it read and does not compute one; that is a
 * contract this function cannot enforce.
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
 * Compared by serialisation, which is sound only because of what the schema refuses. Only `versions`
 * is serialised here, so it is `BrandVersionSchema` that has to hold: nothing in it is optional, so
 * no key holds `undefined` for `JSON.stringify` to drop; Zod rejects every non-finite number,
 * checked against each unbounded field rather than assumed, so nothing serialises to `null` without
 * being null; and `z.array` yields dense arrays, so no hole does either. Both sides have been
 * through that parse: the incoming record at the top of `put`, the stored one when it was written.
 * A change relaxing any of those weakens this comparison with nothing failing to say so. #77 is not
 * that change: it adds a tag to `ReferenceImageSchema` and an optional brand URL to
 * `BrandRecordSchema`, and neither sits inside `versions`.
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
export function wasBuiltOnStored(stored: BrandRecord, incoming: BrandRecord): boolean {
	return (
		incoming.revision === stored.revision &&
		JSON.stringify(stored.versions) ===
			JSON.stringify(incoming.versions.slice(0, stored.versions.length))
	);
}

/**
 * The record an implementation should write, or a throw where the write is refused. Both stores call
 * this so the rule and the number it stamps stay in one place: an implementation that checked the
 * base itself and then stamped its own revision could get either half wrong on its own.
 *
 * `stored` is `undefined` for an id nothing holds, which is an insert rather than a commit, so there
 * is no base to check and the record starts at `FIRST_REVISION`. A caller's own `revision` is
 * discarded there rather than trusted, which is what keeps a record that arrives at revision 7 from
 * being stored at 7 and making every later write compare against a number no commit produced.
 */
export function nextCommit(stored: BrandRecord | undefined, incoming: BrandRecord): BrandRecord {
	if (stored === undefined) {
		return { ...incoming, revision: FIRST_REVISION };
	}

	if (!wasBuiltOnStored(stored, incoming)) {
		throw new StaleRecordWriteError(incoming.id, {
			storedVersions: stored.versions.length,
			incomingVersions: incoming.versions.length,
			storedRevision: stored.revision,
			incomingRevision: incoming.revision,
		});
	}

	return { ...incoming, revision: stored.revision + 1 };
}

/**
 * Where the record stands and what the refused write was built on, named rather than positional so
 * the two pairs cannot be handed over in each other's place.
 */
export type StaleRecordWriteStanding = {
	storedVersions: number;
	incomingVersions: number;
	storedRevision: number;
	incomingRevision: number;
};

/**
 * Thrown when `wasBuiltOnStored` refuses a write. Two things can fail: the base the write was built
 * on is not the revision storage holds, or it is and the versions do not continue the stored
 * history. `storedRevision` is where the record stands, `incomingRevision` is the base the refused
 * write carried, and a caller reads which failed off those two without parsing the message.
 *
 * The recovery is the same either way, which is why there is one error and not two: re-read the
 * record and commit again from what comes back. That holds for a copy another writer overtook, for a
 * write whose own response was lost and was sent a second time, and for a copy of an id that was
 * deleted and recreated. Only the first of those has a second writer in it, so no wording here says
 * one landed.
 *
 * The version counts are context rather than the test the write failed, and they measure neither
 * that test nor how far behind the losing copy is. Two writers that each added only an image
 * produce equal counts. A loser that appended no version behind a winner that appended one
 * produces 2 against 1. They are still reported, because the store is the only thing that can
 * report them honestly, and a caller showing a person what is at stake wants them.
 *
 * `kind` follows the same discriminated-error convention as `StorageQuotaExceededError` and the
 * core's `SeedParseError`, so a caller branches on a field rather than on a message, and can tell
 * this apart from a malformed record or a full origin. `StaleWorkspaceError` one layer up
 * deliberately carries no counts, since anything the workspace could offer would be what it wrote
 * rather than what storage holds.
 *
 * The four numbers arrive named rather than positional. All four are numbers, and on a record whose
 * every commit appended a version the count and the revision on each side are the same number, so a
 * transposed pair reads correctly at the call site and reports values a reader cannot tell from the
 * right ones. Naming them makes that transposition unspellable, and naming alone still permits
 * feeding a field the wrong value, which takes two tests in the contract suite to cover rather than
 * one. `reports the version counts and the revisions as quantities that can differ` parts a revision
 * from a count, by driving a record to revision 3 over a single version. `reports each side's
 * version count from its own record` parts the two counts from each other, by refusing a write whose
 * copy is a version behind; without it, a field given the other record's count reports a number no
 * assertion contradicts.
 */
export class StaleRecordWriteError extends Error {
	readonly kind = 'stale-record-write';
	readonly recordId: string;
	readonly storedVersions: number;
	readonly incomingVersions: number;
	readonly storedRevision: number;
	readonly incomingRevision: number;

	constructor(recordId: string, standing: StaleRecordWriteStanding, options?: { cause?: unknown }) {
		super(staleWriteMessage(recordId, standing.storedRevision, standing.incomingRevision), options);
		this.name = 'StaleRecordWriteError';
		this.recordId = recordId;
		this.storedVersions = standing.storedVersions;
		this.incomingVersions = standing.incomingVersions;
		this.storedRevision = standing.storedRevision;
		this.incomingRevision = standing.incomingRevision;
	}
}

/**
 * The sentence for whichever of the two refusals happened, told apart by the revisions alone.
 * Version counts stay out of it: they are the same number in the case two writers race on images,
 * and they run the wrong way for a copy that ran ahead, so a message built on them describes the
 * write rather than the reason it was refused.
 */
function staleWriteMessage(recordId: string, stored: number, builtOn: number): string {
	// Two branches rather than the three the old rule needed. That rule compared the revision a
	// writer wanted to write, so it could tell a copy that had been overtaken from one that had run
	// ahead, and the two wanted different recoveries. A base that does not match is one thing however
	// it came to differ, and re-reading is the answer to all of it, so a wording that sorted the
	// mismatch further would be drawing a distinction the rule no longer makes.
	//
	// Neither sentence says another write landed. A base can miss because one did, because this write
	// already landed and its response was lost, or because the id was deleted and recreated under it,
	// and only the first of those had a second writer in it.
	if (builtOn !== stored) {
		return `record ${recordId} is at revision ${stored} and this write was built on revision ${builtOn}; a write has to be built on the revision the record currently holds, so re-read it and commit again`;
	}

	return `record ${recordId} is at revision ${stored} and this write was built on it, but the versions it brings are not the stored history continued`;
}
