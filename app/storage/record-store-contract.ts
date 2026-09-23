import { beforeEach, describe, expect, it } from 'vitest';

import {
	type BrandRecord,
	type BrandVersion,
	type ReferenceImage,
	SCHEMA_VERSION,
} from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';

import { type RecordStore, StaleRecordWriteError } from './record-store';

function makeVersion(overrides: Partial<BrandVersion> = {}): BrandVersion {
	return {
		createdAt: '2026-01-01T00:00:00.000Z',
		ordinal: 1,
		seed: null,
		tokenSet: null,
		provider: 'anthropic',
		model: 'claude-opus-5',
		promptVersion: 'seed-v3',
		rawResponse: null,
		scaleEngine: 'cambium-oklch-1',
		fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		interpretation: 'balanced',
		...overrides,
	};
}

function makeRecord(overrides: Partial<BrandRecord> = {}): BrandRecord {
	return {
		id: crypto.randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: 1,
		images: [],
		versions: [makeVersion()],
		...overrides,
	};
}

const REFERENCE_IMAGE_ID = 'img-1';

/**
 * A seed carrying one key colour at the hue it was given. Only the hue matters here: it is the one
 * seed field with two spellings for the same value, so it is where a caller adopting its own input
 * instead of what the store returned can be caught holding something storage does not have.
 */
function makeSeedWithHue(hue: number): BrandSeed {
	return {
		keyColors: [
			{
				oklch: [0.62, 0.18, hue],
				proposedRole: 'brand',
				sourceImageId: REFERENCE_IMAGE_ID,
				sourceRegion: null,
			},
		],
		neutralTemperature: null,
		surfacePolarity: null,
		radiusCharacter: null,
		shadowCharacter: null,
		trackingFeel: null,
		typeClassification: null,
		suggestedPairing: null,
		typeScaleRatio: null,
		imageClassifications: null,
		expressive: null,
	};
}

/**
 * Seed provenance is checked against the images a record actually holds, so a record carrying a key
 * colour has to carry the image that colour was read off.
 */
function makeRecordWithHue(hue: number): BrandRecord {
	return makeRecord({
		images: [
			{
				id: REFERENCE_IMAGE_ID,
				downscaled: 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
				originalHash: 'sha256:abc',
			},
		],
		versions: [makeVersion({ seed: makeSeedWithHue(hue) })],
	});
}

/** Fails the test rather than the assertion when a record that should be there is not. */
async function read(store: RecordStore, id: string): Promise<BrandRecord> {
	const record = await store.get(id);

	if (!record) {
		throw new Error(`expected a record stored under ${id}`);
	}

	return record;
}

/**
 * The commit a caller makes from whatever copy of a record it is holding. `revision` moves with
 * it: it counts commits of the whole record, not just ones that grow `versions`, so every commit
 * this fixture produces has to carry it forward for the record it builds to describe a write a
 * correct store would actually accept.
 */
function appended(record: BrandRecord, overrides: Partial<BrandVersion> = {}): BrandRecord {
	return {
		...record,
		revision: record.revision + 1,
		versions: [
			...record.versions,
			makeVersion({
				ordinal: record.versions.length + 1,
				createdAt: '2026-01-02T00:00:00.000Z',
				...overrides,
			}),
		],
	};
}

/**
 * The commit a caller makes that changes only `images`, appending no version — the write #78
 * exists to accept. `revision` is what makes it a well-formed commit rather than a no-op: unlike
 * `versions.length`, it moves on every commit to the record, images-only ones included, which is
 * the whole reason the field exists.
 */
function withAddedImage(record: BrandRecord, image: ReferenceImage): BrandRecord {
	return {
		...record,
		revision: record.revision + 1,
		images: [...record.images, image],
	};
}

/**
 * Runs against any `RecordStore`. This file imports nothing but the interface and the schema it
 * moves, so a future IndexedDB or HTTP implementation passes it unchanged; if it doesn't, the
 * seam promised something this contract never actually specified.
 *
 * `createStore` is called fresh before every test rather than once for the whole suite, so one
 * test's records can never leak into the next regardless of how the implementation persists.
 */
export function testRecordStoreContract(createStore: () => RecordStore | Promise<RecordStore>) {
	let store: RecordStore;

	beforeEach(async () => {
		store = await createStore();
	});

	describe('list', () => {
		it('resolves an empty list before anything is stored', async () => {
			expect(await store.list()).toEqual([]);
		});

		it('resolves every stored record', async () => {
			const a = makeRecord();
			const b = makeRecord();

			await store.put(a);
			await store.put(b);

			const listed = await store.list();
			// toSorted would say this better, but it's ES2023 and tsconfig targets ES2022; both
			// arrays here are already fresh, so sort has nothing of the caller's to mutate.
			// oxlint-disable-next-line unicorn/no-array-sort
			const ids = listed.map((record) => record.id).sort();
			// oxlint-disable-next-line unicorn/no-array-sort
			expect(ids).toEqual([a.id, b.id].sort());
		});
	});

	describe('get', () => {
		it('resolves null for an id nothing has stored', async () => {
			expect(await store.get(crypto.randomUUID())).toBeNull();
		});

		it('resolves the record most recently put under that id', async () => {
			const record = makeRecord();
			await store.put(record);

			expect(await store.get(record.id)).toEqual(record);
		});
	});

	describe('put', () => {
		// AC 6 is a property of the schema rather than a check this store adds; see the
		// no-credential guarantee documented on `RecordStore` in ./record-store.ts.
		it('rejects a record carrying a field the schema does not declare', async () => {
			const withSmuggledKey = { ...makeRecord(), apiKey: 'sk-live-something' };

			// Matching against `Error` rather than a message keeps this implementation-blind: any
			// validator wording works, as long as an invalid record actually rejects.
			await expect(store.put(withSmuggledKey)).rejects.toThrow(Error);
			expect(await store.get(withSmuggledKey.id)).toBeNull();
		});

		// A second write under an id already taken replaces that record rather than filing a second
		// one beside it. The history has to grow for the write to be accepted at all, so this says
		// it with an append; what a write on an unchanged history does is the staleness rule below.
		it('replaces the record already stored under the same id rather than storing a second', async () => {
			const record = makeRecord();
			await store.put(record);

			const committed = appended(record, { interpretation: 'expressive' });
			await store.put(committed);

			expect(await store.get(record.id)).toEqual(committed);
			expect(await store.list()).toHaveLength(1);
		});

		// The defect this contract exists to close, in the shape #67 reports it: two readers load
		// the same record, both append their own version 2, and the second write replaces the whole
		// record. The first reader's version is gone, and nothing failed.
		it('rejects a write derived from a copy read before another write landed', async () => {
			const record = makeRecord();
			await store.put(record);

			const readByOne = await read(store, record.id);
			const readByAnother = await read(store, record.id);

			const landed = appended(readByOne);
			await store.put(landed);

			await expect(
				store.put(appended(readByAnother, { interpretation: 'expressive' })),
			).rejects.toBeInstanceOf(StaleRecordWriteError);

			expect((await read(store, record.id)).versions).toEqual(landed.versions);
		});

		// One reader is enough, which is what the two-tab framing misses. `get` hands back a fresh
		// object graph every read, so a re-read copy is a different object holding the same old
		// history: every check above this seam that keys on object identity misses it, and every
		// check that keys on the id alone refuses a record recreated under that id forever. Only the
		// store knows what the store holds.
		it('rejects a write built on a re-read copy after the reader wrote past it', async () => {
			const record = makeRecord();
			await store.put(record);

			const reRead = await read(store, record.id);

			await store.put(appended(record));

			await expect(
				store.put(appended(reRead, { interpretation: 'expressive' })),
			).rejects.toBeInstanceOf(StaleRecordWriteError);
		});

		// The successor rule, in the one shape that tells `=== stored.revision + 1` apart from
		// `> stored.revision`: a copy running more than one ahead. This writer read revision 1 and
		// committed twice without writing back, so it arrives holding 3 against a stored 1 while its
		// history extends the stored history cleanly. The history rule has nothing to refuse there,
		// which leaves the revision arithmetic as the only thing that can. A store that checks only
		// that the revision is ahead accepts the write and files two commits storage never saw.
		it('rejects a write whose revision runs ahead of the stored one instead of following it', async () => {
			const first = makeVersion({ ordinal: 1, createdAt: '2026-01-01T00:00:00.000Z' });
			const record = makeRecord({ versions: [first] });
			await store.put(record);

			const committedTwiceOffline: BrandRecord = {
				...record,
				revision: record.revision + 2,
				versions: [
					first,
					makeVersion({ ordinal: 2, createdAt: '2026-01-02T00:00:00.000Z' }),
					makeVersion({
						ordinal: 3,
						createdAt: '2026-01-03T00:00:00.000Z',
						interpretation: 'expressive',
					}),
				],
			};

			await expect(store.put(committedTwiceOffline)).rejects.toBeInstanceOf(StaleRecordWriteError);

			const stillStored = await read(store, record.id);
			expect(stillStored.versions).toEqual([first]);
			expect(stillStored.revision).toBe(record.revision);
		});

		// The metadata half of the same defect: two writers hold the same copy and each changes
		// only `images`, so neither commit touches `versions` and a rule keyed on version count
		// alone would wave both through, dropping the first. `revision` is what tells them apart:
		// both start from the same number, one commit moves it forward, and the second is derived
		// from a copy that number has already left behind.
		it('rejects a metadata-only write derived from a copy read before another metadata write landed', async () => {
			const record = makeRecord();
			await store.put(record);

			const readByOne = await read(store, record.id);
			const readByAnother = await read(store, record.id);

			const landed = withAddedImage(readByOne, {
				id: REFERENCE_IMAGE_ID,
				downscaled: 'data:image/png;base64,AA==',
				originalHash: 'sha256:a',
			});
			await store.put(landed);

			await expect(
				store.put(
					withAddedImage(readByAnother, {
						id: 'img-2',
						downscaled: 'data:image/png;base64,BB==',
						originalHash: 'sha256:b',
					}),
				),
			).rejects.toBeInstanceOf(StaleRecordWriteError);

			expect((await read(store, record.id)).images).toEqual(landed.images);
		});

		// A caller's own copy of a record is not always what storage holds. `put` parses, and
		// `BrandSeedSchema` canonicalises a hue of 360 to 0, so a caller that kept the object it
		// passed in still spells that hue 360. Its next write carries that spelling in the earlier
		// versions, and the write has to be accepted, because the history genuinely continued.
		//
		// What makes that safe is the order inside `put`: it parses before it compares, so both
		// sides of the comparison are parse outputs and the caller's spelling never reaches it.
		// Comparing the incoming record before parsing would turn a caller holding a stale spelling
		// into a record that can never be saved again, which is worse than the divergence itself.
		it('accepts an extension built from a copy whose values the store canonicalised', async () => {
			const committed = makeRecordWithHue(360);
			const stored = await store.put(committed);

			expect(stored.versions[0]?.seed?.keyColors?.[0]?.oklch[2]).toBe(0);
			expect(committed.versions[0]?.seed?.keyColors?.[0]?.oklch[2]).toBe(360);

			// Built from the caller's object, not from what `put` handed back.
			await expect(store.put(appended(committed))).resolves.toMatchObject({ id: committed.id });

			expect((await read(store, committed.id)).versions).toHaveLength(2);
		});

		// Counting alone lets this one through. A writer that read `[v1]` and committed twice
		// arrives holding three versions while storage holds two, so its history is longer and
		// still derived from a copy that never saw the version that landed. The ordinals are
		// well formed either way, which is exactly why a count cannot tell the two apart.
		//
		// The revision this write carries is the stored one's successor, so the revision rule
		// passes it and #67's history rule is what has to refuse it. A fixture arriving a revision
		// behind would reject before the two histories were compared at all, and could not tell a
		// store that dropped the comparison from one that kept it.
		it('rejects a longer history that diverges from the stored one', async () => {
			const first = makeVersion({ ordinal: 1, createdAt: '2026-01-01T00:00:00.000Z' });
			const record = makeRecord({ versions: [first] });
			await store.put(record);

			const landed = makeVersion({ ordinal: 2, createdAt: '2026-01-02T00:00:00.000Z' });
			await store.put({ ...record, revision: record.revision + 1, versions: [first, landed] });

			const divergent: BrandRecord = {
				...record,
				revision: record.revision + 2,
				versions: [
					first,
					makeVersion({
						ordinal: 2,
						createdAt: '2026-01-02T00:00:00.000Z',
						interpretation: 'expressive',
					}),
					makeVersion({
						ordinal: 3,
						createdAt: '2026-01-03T00:00:00.000Z',
						interpretation: 'faithful',
					}),
				],
			};

			await expect(store.put(divergent)).rejects.toBeInstanceOf(StaleRecordWriteError);

			expect((await read(store, record.id)).versions).toEqual([first, landed]);
		});

		// The shorter-history half. A write that drops a version is as lossy as one that recounts an
		// ordinal, and losing a version refuses it whatever else the write gets right.
		//
		// The revision is the stored one's successor here for the reason the divergent case above
		// gives: a caller still holding the old number rejects on arithmetic alone, which leaves
		// #67's rule unmeasured. The write below is a well-formed next commit that lost a version.
		it('rejects a write whose history is shorter than the stored one', async () => {
			const record = makeRecord();
			await store.put(record);
			const committed = appended(record);
			await store.put(committed);

			const shortened: BrandRecord = { ...record, revision: committed.revision + 1 };

			await expect(store.put(shortened)).rejects.toBeInstanceOf(StaleRecordWriteError);

			expect((await read(store, record.id)).versions).toEqual(committed.versions);
		});

		// A rejection a caller can act on: which record to reload, and how far behind it is. The
		// counts are the store's to report, because the store is the only thing that knows them.
		it('names the record and both version counts when it rejects a stale write', async () => {
			const record = makeRecord();
			await store.put(record);
			await store.put(appended(record));

			await expect(
				store.put(appended(record, { interpretation: 'expressive' })),
			).rejects.toMatchObject({
				kind: 'stale-record-write',
				recordId: record.id,
				storedVersions: 2,
				incomingVersions: 2,
			});
		});

		// A caller catching this has two different recoveries to choose between, and the documented
		// one is wrong for half the cases. A copy another writer overtook should re-read and commit
		// again. A copy that ran ahead holds commits storage never took, and re-reading discards
		// them. The revisions are what part the two, so the error carries both and a caller branches
		// on a field rather than on the wording of a message.
		it('reports both revisions, so a caller can tell a copy that ran ahead from one another writer overtook', async () => {
			const overtakenRecord = makeRecord();
			await store.put(overtakenRecord);
			await store.put(appended(overtakenRecord));

			const overtaken = await store
				.put(appended(overtakenRecord, { interpretation: 'expressive' }))
				.then(
					() => null,
					(thrown: unknown) => thrown,
				);

			// Storage moved to 2 while this copy was still deriving its own 2 from revision 1.
			expect(overtaken).toMatchObject({
				kind: 'stale-record-write',
				recordId: overtakenRecord.id,
				storedRevision: 2,
				incomingRevision: 2,
			});

			const aheadRecord = makeRecord();
			await store.put(aheadRecord);

			const ahead = await store.put(appended(appended(aheadRecord))).then(
				() => null,
				(thrown: unknown) => thrown,
			);

			// Nobody else wrote. This copy committed twice without writing back, so it arrives at 3
			// against a stored 1, and a caller can see that from the two fields alone.
			expect(ahead).toMatchObject({
				kind: 'stale-record-write',
				recordId: aheadRecord.id,
				storedRevision: 1,
				incomingRevision: 3,
			});
		});

		// Every other scenario here gives a record as many revisions as versions, so the two pairs
		// the error carries hold the same two numbers and a construction site that swapped them
		// would report the same four values. This one parts them: two image-only commits move the
		// revision twice while the history stays at one version, so the refusal carries counts and
		// revisions that cannot stand in for each other.
		it('reports the version counts and the revisions as quantities that can differ', async () => {
			const record = makeRecord();
			await store.put(record);
			const staleCopy = await read(store, record.id);

			const withOne = withAddedImage(record, {
				id: 'img-1',
				downscaled: 'data:image/png;base64,AA==',
				originalHash: 'sha256:a',
			});
			await store.put(withOne);
			const withTwo = withAddedImage(withOne, {
				id: 'img-2',
				downscaled: 'data:image/png;base64,BB==',
				originalHash: 'sha256:b',
			});
			await store.put(withTwo);

			const fromTheStaleCopy = withAddedImage(staleCopy, {
				id: 'img-3',
				downscaled: 'data:image/png;base64,CC==',
				originalHash: 'sha256:c',
			});
			const thrown = await store.put(fromTheStaleCopy).then(
				() => null,
				(error: unknown) => error,
			);

			// One version throughout, revision 3 against 2. Swap either pair into the other's place
			// and all four of these numbers change.
			expect(thrown).toMatchObject({
				kind: 'stale-record-write',
				recordId: record.id,
				storedVersions: 1,
				incomingVersions: 1,
				storedRevision: 3,
				incomingRevision: 2,
			});
		});

		// The scenario above holds both version counts at 1, so it cannot tell one side's count from
		// the other's: feeding `incomingVersions` the stored count, or `storedVersions` the incoming
		// one, reports the same four numbers. Here the two counts differ, because the write that
		// landed appended a version and the stale copy still carries the shorter history it read.
		it("reports each side's version count from its own record", async () => {
			const record = makeRecord();
			await store.put(record);
			const staleCopy = await read(store, record.id);

			// The write that lands takes the history to two versions.
			await store.put(appended(record));

			const fromTheStaleCopy = withAddedImage(staleCopy, {
				id: 'img-1',
				downscaled: 'data:image/png;base64,AA==',
				originalHash: 'sha256:a',
			});
			const thrown = await store.put(fromTheStaleCopy).then(
				() => null,
				(error: unknown) => error,
			);

			// Two stored versions against the copy's one. Swap the two counts and both change.
			expect(thrown).toMatchObject({
				kind: 'stale-record-write',
				recordId: record.id,
				storedVersions: 2,
				incomingVersions: 1,
				storedRevision: 2,
				incomingRevision: 2,
			});
		});

		// The message is the other half of the same problem, and the half a person reads. For a copy
		// that ran ahead, nothing landed in between, so a message saying something did names an
		// event that never happened and prescribes a recovery that throws the copy's own commits
		// away.
		it('does not tell a copy that ran ahead that another write landed in between', async () => {
			const record = makeRecord();
			await store.put(record);

			const thrown = await store.put(appended(appended(record))).then(
				() => null,
				(error: unknown) => error,
			);

			expect(thrown).toBeInstanceOf(StaleRecordWriteError);
			const { message } = thrown as StaleRecordWriteError;

			expect(message).not.toContain('has been written since this copy was read');
			// Says what is actually true instead: where storage stands, and where this copy stands.
			expect(message).toContain('revision 1');
			expect(message).toContain('revision 3');
			// Only the ran-ahead sentence says this. Without it the assertions above pass against the
			// diverged-history sentence too, which names neither the right cause nor the right
			// recovery, so the test would reach this branch without being able to fail on it.
			expect(message).toContain('more than one commit ahead');
		});

		// #67 pinned the old rule's limit here: a write that changed only `images` read as stale,
		// because `versions.length` never moved for it. #78 closes that with `revision`, which
		// counts every commit to the record rather than only the ones that grow the version
		// history, so a metadata-only write finally has a path through this seam.
		//
		// Checked at every version count including zero, because an empty history is the case a
		// rule keyed on `versions.length` gets most wrong: there is nothing to compare a change
		// against, so nothing here would catch a regression that quietly brought the old limit
		// back for a record that has never been generated yet.
		it.each([0, 1, 2, 3])(
			'stores a write that changes only images, appending no version (%i versions already stored)',
			async (versionCount) => {
				const versions = Array.from({ length: versionCount }, (_, index) =>
					makeVersion({
						ordinal: index + 1,
						createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
					}),
				);
				const record = makeRecord({ versions });
				await store.put(record);

				const withImage = withAddedImage(record, {
					id: REFERENCE_IMAGE_ID,
					downscaled: 'data:image/png;base64,AA==',
					originalHash: 'sha256:a',
				});

				await expect(store.put(withImage)).resolves.toMatchObject({ images: withImage.images });
				expect((await read(store, record.id)).versions).toEqual(versions);
				expect((await read(store, record.id)).images).toEqual(withImage.images);
			},
		);

		// #21's first attempt at this rule keyed on record id plus version count and refused a
		// record deleted and recreated under the same id, forever: a shorter history under a
		// familiar id is indistinguishable from a stale one by count alone. Deleting is what tells
		// them apart, and it has to keep working.
		it('accepts a record recreated under an id whose longer history was deleted', async () => {
			const original = makeRecord({
				versions: [
					makeVersion({ ordinal: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
					makeVersion({ ordinal: 2, createdAt: '2026-01-02T00:00:00.000Z' }),
					makeVersion({ ordinal: 3, createdAt: '2026-01-03T00:00:00.000Z' }),
				],
			});
			await store.put(original);
			await store.delete(original.id);

			const recreated = makeRecord({ id: original.id });

			await expect(store.put(recreated)).resolves.toEqual(recreated);
			expect((await read(store, original.id)).versions).toHaveLength(1);
		});

		/**
		 * A known hole, pinned here so it cannot move without someone noticing. This test asserts
		 * what the seam does today, not what it should do.
		 *
		 * The cause is that `revision` restarts when a record is deleted and recreated under the same
		 * id. `followsStoredRecord` compares an incoming write against the record storage holds now,
		 * and nothing in either record says which incarnation the write came from, so a copy of the
		 * deleted one whose revision has drawn level with the live record writes as its successor.
		 *
		 * No condition is stated for when that lines up. Four attempts to bound it were each wrong
		 * against cases their author had not thought of, and #78's red-team measured sixteen. Two
		 * tests stand here instead of a rule: an ordinary sequence that reaches it, and a verbatim
		 * replica. They are instances, not a boundary, and the gap between them is exactly the thing
		 * four bounds got wrong.
		 *
		 * #78 opened it. Before #78 an image-only write was refused whatever incarnation it came
		 * from, because `put` demanded a strictly longer history, and accepting metadata-only writes
		 * took that side effect away.
		 *
		 * Nothing in the product reaches it: `delete` has no caller outside the test suites, and every
		 * record is created under a fresh uuid, so no id is recreated. #20, which owns archive import,
		 * restores as a copy under a fresh uuid rather than in place, so it does not recreate one
		 * either. That is why this is dormant, and dormant is not closed: `delete` is still on the
		 * interface, and the two tests above still pass, so whatever recreates an id first turns it
		 * on.
		 *
		 * When the fix lands, delete both tests. Their inverse is the assertion to write instead.
		 */
		it('accepts a write from an incarnation that was deleted and recreated, which is a known hole', async () => {
			const original = makeRecord();
			await store.put(original);
			const copyOfTheOriginal = await read(store, original.id);

			// One instance of the cause: the recreate happens to sit at the revision the copy above
			// holds, so the copy's next write is the stored revision's successor.
			await store.delete(original.id);
			const recreated = makeRecord({ id: original.id, versions: original.versions });
			await store.put(recreated);

			const fromTheDeadIncarnation = withAddedImage(copyOfTheOriginal, {
				id: 'img-from-a-deleted-incarnation',
				downscaled: 'data:image/png;base64,AA==',
				originalHash: 'sha256:ghost',
			});

			await expect(store.put(fromTheDeadIncarnation)).resolves.toMatchObject({
				images: fromTheDeadIncarnation.images,
			});
			// Read back rather than trusting what `put` resolved with: the image is on the record
			// storage actually holds, which is the record the second brand's owner reads.
			expect((await read(store, original.id)).images.map((image) => image.id)).toEqual([
				'img-from-a-deleted-incarnation',
			]);
		});

		// The same cause reached by an ordinary sequence, with nothing arranged to meet a shape. The
		// first brand is created and given an image, so its holder's copy sits at revision 2. A
		// second brand takes the id, starts at revision 1 as any new record does, and its owner adds
		// one image, which brings it level at revision 2. The dead copy's next write is then the
		// stored revision's successor, and it overwrites the live owner's image.
		//
		// This is the sequence that broke the fourth attempt to bound the gap: every earlier bound was
		// drawn around the replica above, and this one sits outside all four. It is why the gap is
		// described by its cause rather than by a region.
		it('accepts a stale write once the recreated record has caught up to the copy revision', async () => {
			const original = makeRecord();
			await store.put(original);
			const firstBrandWithImage = withAddedImage(original, {
				id: 'img-the-first-brand-had',
				downscaled: 'data:image/png;base64,AA==',
				originalHash: 'sha256:first',
			});
			await store.put(firstBrandWithImage);
			const staleCopy = await read(store, original.id);
			expect(staleCopy.revision).toBe(2);

			await store.delete(original.id);
			const recreated = makeRecord({ id: original.id, versions: original.versions });
			await store.put(recreated);

			// Ordinary use by the second brand's owner, which is what brings the revisions level.
			const ownersImage = withAddedImage(recreated, {
				id: 'img-the-owner-added',
				downscaled: 'data:image/png;base64,BB==',
				originalHash: 'sha256:owner',
			});
			await store.put(ownersImage);
			expect((await read(store, original.id)).revision).toBe(staleCopy.revision);

			const fromTheDeadIncarnation = withAddedImage(staleCopy, {
				id: 'img-from-a-deleted-incarnation',
				downscaled: 'data:image/png;base64,CC==',
				originalHash: 'sha256:ghost',
			});
			await expect(store.put(fromTheDeadIncarnation)).resolves.toMatchObject({
				images: fromTheDeadIncarnation.images,
			});

			// Read back rather than trusting what `put` resolved with. Storage now holds the dead
			// incarnation's images, because the stale write carried that copy's whole record, and
			// the second brand owner's image is gone from it. Nothing errored.
			const held = (await read(store, original.id)).images.map((image) => image.id);
			expect(held).toEqual(['img-the-first-brand-had', 'img-from-a-deleted-incarnation']);
			expect(held).not.toContain('img-the-owner-added');
		});

		// One sequence where the stale write is refused, asserted as that sequence and not as a rule
		// about divergence: a recreate whose history differs from the dead copy's can still take a
		// stale write, when the stale write appends the version that closes the difference. Here the
		// recreate carries the same single version at a different instant and the stale write appends
		// nothing, so the histories never agree and the write is refused. Both halves are asserted,
		// because refusing every write would satisfy the first on its own and would be a different
		// defect: the live record's own next image still lands.
		it("refuses this stale write, where the recreated history never agrees with the copy's", async () => {
			const original = makeRecord();
			await store.put(original);
			const copyOfTheOriginal = await read(store, original.id);

			await store.delete(original.id);
			const recreated = makeRecord({
				id: original.id,
				versions: [makeVersion({ ordinal: 1, createdAt: '2026-03-03T00:00:00.000Z' })],
			});
			await store.put(recreated);

			const fromTheDeadIncarnation = withAddedImage(copyOfTheOriginal, {
				id: 'img-from-a-deleted-incarnation',
				downscaled: 'data:image/png;base64,AA==',
				originalHash: 'sha256:ghost',
			});

			await expect(store.put(fromTheDeadIncarnation)).rejects.toBeInstanceOf(StaleRecordWriteError);

			const live = await read(store, recreated.id);
			await expect(
				store.put(
					withAddedImage(live, {
						id: 'img-the-live-record-added',
						downscaled: 'data:image/png;base64,BB==',
						originalHash: 'sha256:live',
					}),
				),
			).resolves.toMatchObject({ revision: live.revision + 1 });

			expect((await read(store, recreated.id)).images.map((image) => image.id)).toEqual([
				'img-the-live-record-added',
			]);
		});

		// Two commits issued without awaiting between them, which is what a double click or two
		// generations racing actually looks like. The compare and the write have to be one atomic
		// step: a store that reads in one transaction and writes in another leaves a gap the other
		// write lands in, and then both resolve and a version is gone. Which of the two wins is the
		// implementation's business, so this only says that exactly one does.
		it('lets only one of two writes issued together win', async () => {
			const record = makeRecord();
			await store.put(record);

			const outcomes = await Promise.allSettled([
				store.put(appended(record)),
				store.put(appended(record, { interpretation: 'expressive' })),
			]);
			const rejections = outcomes.flatMap((outcome) =>
				outcome.status === 'rejected' ? [outcome.reason] : [],
			);

			expect(rejections).toHaveLength(1);
			expect(rejections[0]).toBeInstanceOf(StaleRecordWriteError);
			expect((await read(store, record.id)).versions).toHaveLength(2);
		});

		// The isolation both existing directions already assert, in the direction `put` only opened
		// by resolving with something. A store that hands back its own stored object lets a caller
		// reach into it without calling it again.
		it('is not affected by a caller mutating the record put resolved with', async () => {
			const record = makeRecord();

			const stored = await store.put(record);
			const versionsBeforeMutation = [...stored.versions];
			stored.versions.push(makeVersion({ ordinal: 2, interpretation: 'faithful' }));

			expect((await read(store, record.id)).versions).toEqual(versionsBeforeMutation);
		});

		// `put` parses, and `BrandSeedSchema` canonicalises: a hue committed as 360 is stored as 0,
		// because 360 and 0 name the same angle and one value may not have two spellings. So a
		// caller that adopts the object it passed in holds a record storage does not have.
		//
		// Checked against what `get` resolves rather than against a re-parse of the input, which
		// would only prove the code equals itself, and byte for byte rather than by deep equality,
		// because a caller that adopts this value goes on to serialise it.
		it('resolves with the record as stored, identical to what a later get resolves', async () => {
			const committed = makeRecordWithHue(360);

			const stored = await store.put(committed);
			const fetched = await read(store, committed.id);

			expect(stored.versions[0]?.seed?.keyColors?.[0]?.oklch[2]).toBe(0);
			// The caller's own object is untouched, which is exactly why it cannot be trusted as a
			// record of what was stored.
			expect(committed.versions[0]?.seed?.keyColors?.[0]?.oklch[2]).toBe(360);

			expect(JSON.stringify(stored)).toBe(JSON.stringify(fetched));
		});

		// A real backend serializes on the way in (structured clone, JSON over the wire); an
		// in-memory implementation has to earn that isolation on purpose, or a caller holding a
		// reference to what it just passed in can corrupt the store without calling it again.
		it('is not affected by a caller mutating the object passed to put afterward', async () => {
			const record = makeRecord();
			const versionsAtPutTime = [...record.versions];
			await store.put(record);

			record.versions.push(makeVersion({ ordinal: 2, interpretation: 'faithful' }));

			expect(await store.get(record.id)).toEqual({ ...record, versions: versionsAtPutTime });
		});

		// The same isolation has to hold in the other direction: a caller mutating what get handed
		// back must not reach into the store and change what the next get sees. The snapshot has
		// to be taken before the mutation and compared on its own terms: a store that hands back
		// its own internal reference makes `fetched` and a later `get()` result the same object,
		// so asserting against `record` (or against `fetched` itself) would pass either way.
		it('is not affected by a caller mutating a record returned from get', async () => {
			const record = makeRecord();
			await store.put(record);

			const fetched = await store.get(record.id);
			const versionsBeforeMutation = fetched ? [...fetched.versions] : [];
			fetched?.versions.push(makeVersion({ ordinal: 2, interpretation: 'faithful' }));

			expect((await store.get(record.id))?.versions).toEqual(versionsBeforeMutation);
		});

		// This is the store-level half of "a generation appends a version and leaves earlier
		// versions unchanged": generating one is the record library's job and out of scope here,
		// but the store must not corrupt an earlier version when a caller re-puts a longer history.
		it('leaves earlier versions unchanged when a longer history is put under the same id', async () => {
			const first = makeVersion({ ordinal: 1, createdAt: '2026-01-01T00:00:00.000Z' });
			const record = makeRecord({ versions: [first] });
			await store.put(record);

			const second = makeVersion({
				ordinal: 2,
				createdAt: '2026-01-02T00:00:00.000Z',
				interpretation: 'expressive',
			});
			await store.put({ ...record, revision: record.revision + 1, versions: [first, second] });

			expect((await store.get(record.id))?.versions).toEqual([first, second]);
		});

		// Neither the shape above nor the schema's own tests exercise more than two versions, so
		// a store that reorders on the way out, or drops one from the middle, has nothing here to
		// catch it. Three versions, checked as one array so both position and count matter.
		it('preserves version order and drops none of a longer history', async () => {
			const v1 = makeVersion({ ordinal: 1, createdAt: '2026-01-01T00:00:00.000Z' });
			const v2 = makeVersion({
				ordinal: 2,
				createdAt: '2026-01-02T00:00:00.000Z',
				interpretation: 'expressive',
			});
			const v3 = makeVersion({
				ordinal: 3,
				createdAt: '2026-01-03T00:00:00.000Z',
				interpretation: 'faithful',
			});
			const record = makeRecord({ versions: [v1, v2, v3] });

			await store.put(record);

			expect((await store.get(record.id))?.versions).toEqual([v1, v2, v3]);
		});
	});

	describe('delete', () => {
		it('removes a stored record so a later get resolves null', async () => {
			const record = makeRecord();
			await store.put(record);

			await store.delete(record.id);

			expect(await store.get(record.id)).toBeNull();
		});

		it('leaves the rest of the store alone', async () => {
			const kept = makeRecord();
			const removed = makeRecord();
			await store.put(kept);
			await store.put(removed);

			await store.delete(removed.id);

			expect(await store.list()).toEqual([kept]);
		});

		// Matches IndexedDB's own `objectStore.delete`, which succeeds silently on a missing key,
		// confirmed against fake-indexeddb rather than assumed: a caller holding an id usually
		// can't know whether it's already gone, so treating that as an error invents a failure the
		// platform doesn't have.
		it('resolves without error for an id nothing has stored', async () => {
			await expect(store.delete(crypto.randomUUID())).resolves.toBeUndefined();
		});
	});
}
