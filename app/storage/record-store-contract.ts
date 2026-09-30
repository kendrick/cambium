import { beforeEach, describe, expect, it } from 'vitest';

import {
	type BrandRecord,
	type BrandVersion,
	FIRST_REVISION,
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
		promptVersion: 'seed-v4',
		rawResponse: null,
		scaleEngine: 'cambium-oklch-1',
		fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		interpretation: 'balanced',
		overrides: [],
		pins: [],
		...overrides,
	};
}

function makeRecord(overrides: Partial<BrandRecord> = {}): BrandRecord {
	return {
		id: crypto.randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl: null,
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
				tag: 'auto',
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
 * The commit a caller makes from whatever copy of a record it is holding. `revision` rides along
 * untouched, because it says which revision this copy was read at and a commit does not change
 * that. Storage stamps the next one. A fixture that advanced it here would be answering the
 * question `put` exists to ask, and every test built on it would agree with a store that never
 * checked anything.
 */
function appended(record: BrandRecord, overrides: Partial<BrandVersion> = {}): BrandRecord {
	return {
		...record,
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
 * The commit a caller makes that changes only `images`, appending no version — the write #78 exists
 * to accept. Nothing here moves a counter: `versions` does not grow and `revision` still names the
 * revision this copy was read at, so what makes the write well formed is the base it carries, not
 * anything the caller increments.
 */
function withAddedImage(record: BrandRecord, image: ReferenceImage): BrandRecord {
	return {
		...record,
		images: [...record.images, image],
	};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** #122's criterion asks for every version count, zero included. */
const VERSION_COUNTS = [0, 1, 2];

function historyOf(count: number): BrandVersion[] {
	return Array.from({ length: count }, (_, index) =>
		makeVersion({ ordinal: index + 1, createdAt: `2026-01-0${index + 1}T00:00:00.000Z` }),
	);
}

function imageNamed(id: string): ReferenceImage {
	return {
		id,
		downscaled: 'data:image/png;base64,AA==',
		originalHash: `sha256:${id}`,
		tag: 'auto',
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
			const stored = await store.put(record);

			expect(await store.get(record.id)).toEqual({ ...record, incarnation: stored.incarnation });
		});

		// #77: a person tags each image and, optionally, names the brand's site at upload. Both used
		// to have nowhere to land. Two distinct non-default tags stand in for every tag a form could
		// send, so a store that dropped or collapsed one would be caught here rather than by a case
		// that happens to use the same tag twice.
		it('keeps every image tag and the brand URL through a put and a get', async () => {
			const record = makeRecord({
				brandUrl: 'acme.com',
				images: [
					{
						id: 'img-logo',
						downscaled: 'data:image/png;base64,AA==',
						originalHash: 'sha256:logo',
						tag: 'logo',
					},
					{
						id: 'img-storefront',
						downscaled: 'data:image/png;base64,BB==',
						originalHash: 'sha256:storefront',
						tag: 'photo',
					},
				],
			});

			await store.put(record);
			const reread = await read(store, record.id);

			expect(reread.brandUrl).toBe('acme.com');
			expect(reread.images.map((image) => image.tag)).toEqual(['logo', 'photo']);
			expect(reread).toEqual({ ...record, incarnation: reread.incarnation });
			expect(reread.incarnation).toMatch(UUID);
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

		// An unnamed record has one stored form, with no `name` key. Structured clone keeps an own
		// `name: undefined`, so a store that took one would hold a spelling the archive can't carry.
		it('rejects a record whose name key holds undefined', async () => {
			const unnamedByValue = { ...makeRecord(), name: undefined };

			await expect(store.put(unnamedByValue)).rejects.toThrow(Error);
			expect(await store.get(unnamedByValue.id)).toBeNull();
		});

		// Storage decides the revision, not the caller. An insert starts at `FIRST_REVISION` whatever
		// number the record arrived carrying, and each accepted commit moves it by one. A store that
		// took the caller's number instead would let a record land at 7 in an empty store, and every
		// later write would then be compared against a revision no commit of this record produced.
		it('stamps the revision itself, starting a new record at the first one', async () => {
			const arriving = makeRecord({ revision: 7 });

			const inserted = await store.put(arriving);
			expect(inserted.revision).toBe(FIRST_REVISION);
			expect((await read(store, arriving.id)).revision).toBe(FIRST_REVISION);

			// A commit built on what storage handed back moves it by exactly one.
			const committed = await store.put(appended(inserted));
			expect(committed.revision).toBe(FIRST_REVISION + 1);
			expect((await read(store, arriving.id)).revision).toBe(FIRST_REVISION + 1);
		});

		// A second write under an id already taken replaces that record rather than filing a second
		// one beside it. An append is one way to say that and not the only one: a write that grows
		// nothing but `images` is accepted too, which the images-only cases below cover. What decides
		// acceptance is the base the write was built on, not whether anything grew.
		it('replaces the record already stored under the same id rather than storing a second', async () => {
			const record = makeRecord();
			await store.put(record);

			// Compared against what `put` resolved with rather than against the object passed in,
			// because storage stamps the revision and the caller's copy still carries the base.
			const stored = await store.put(appended(record, { interpretation: 'expressive' }));

			expect(await store.get(record.id)).toEqual(stored);
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

		// The property criterion 2 states. Both tabs read the same copy, B commits once and storage
		// moves on, and A then writes after accumulating local work. A is refused however much of it
		// there is, because every one of those changes was built on a copy that is no longer current.
		//
		// The parameter varies the size of A's write, not the base it carries: `withAddedImage` leaves
		// `revision` alone, so all three cases present the revision A read. That is what a caller
		// following this seam's contract sends, and the case where a caller does not is pinned below.
		it.each([1, 2, 3])(
			'refuses a write built on a copy another write has already passed (%i local commits)',
			async (localCommits) => {
				const record = makeRecord();
				await store.put(record);

				const readByA = await read(store, record.id);
				const readByB = await read(store, record.id);

				await store.put(
					withAddedImage(readByB, {
						id: 'img-from-b',
						downscaled: 'data:image/png;base64,BB==',
						originalHash: 'sha256:b',
						tag: 'auto',
					}),
				);

				let fromA = readByA;
				for (let commit = 1; commit <= localCommits; commit += 1) {
					fromA = withAddedImage(fromA, {
						id: `img-from-a-${commit}`,
						downscaled: 'data:image/png;base64,AA==',
						originalHash: `sha256:a${commit}`,
						tag: 'auto',
					});
				}

				await expect(store.put(fromA)).rejects.toBeInstanceOf(StaleRecordWriteError);

				// B's commit is what storage holds, and nothing of A's reached it.
				expect((await read(store, record.id)).images.map((image) => image.id)).toEqual([
					'img-from-b',
				]);
			},
		);

		/**
		 * A limit of this rule rather than a guarantee, pinned so it cannot move unnoticed.
		 *
		 * The base a write carries is a small integer the caller supplies, so a caller that computes
		 * one instead of carrying the revision it read can land on the number storage happens to
		 * hold, and nothing in the two records tells that apart from a copy genuinely read at it.
		 * Here the loser reads revision 1, advances its own revision once, and arrives at 2 against a
		 * record another writer has already moved to 2. The write is taken and the winner's image is
		 * replaced.
		 *
		 * Advancing twice or not at all is refused, so this is not a bound on the limit and no bound
		 * is stated: it is one reachable instance of `revision` counting commits rather than
		 * identifying a lineage, which is the same reason the delete-and-recreate gap is open.
		 * Closing it needs a base a caller cannot fabricate, which this field is not.
		 *
		 * `app/state/workspace-store.ts` computed its own revision until #78 and is the caller this
		 * would have bitten. It now carries what `put` resolved with. Delete this test if a base
		 * arrives that a caller cannot forge, and assert the refusal in its place.
		 */
		it('takes a write whose caller computed a revision that lands on the stored one', async () => {
			const record = makeRecord();
			await store.put(record);

			const readByLoser = await read(store, record.id);
			const readByWinner = await read(store, record.id);

			await store.put(
				withAddedImage(readByWinner, {
					id: 'img-from-the-winner',
					downscaled: 'data:image/png;base64,BB==',
					originalHash: 'sha256:b',
					tag: 'auto',
				}),
			);

			// The loser advances its own revision, as `app/state/workspace-store.ts` did on this branch
			// before it began carrying the revision it read.
			const fabricated = {
				...withAddedImage(readByLoser, {
					id: 'img-from-the-loser',
					downscaled: 'data:image/png;base64,AA==',
					originalHash: 'sha256:a',
					tag: 'auto',
				}),
				revision: readByLoser.revision + 1,
			};

			await expect(store.put(fabricated)).resolves.toMatchObject({
				images: fabricated.images,
			});
			expect((await read(store, record.id)).images.map((image) => image.id)).toEqual([
				'img-from-the-loser',
			]);
		});

		/**
		 * A limit of this rule rather than a guarantee, pinned so it cannot move unnoticed.
		 *
		 * A new record carries `FIRST_REVISION`, which is also what a copy read straight after an
		 * insert carries, and `put` takes nothing else that could tell the two apart. So a second
		 * insert under an id storage holds at `FIRST_REVISION`, bringing a history the stored one
		 * continues, is taken as a commit: it lands at the next revision and replaces the first
		 * insert's images, with no error.
		 *
		 * The self-computed revision above is the same limit reached by a caller that increments;
		 * this one needs no increment at all. It stays dormant while every insert mints a fresh id,
		 * which `components/landing/upload-form.tsx` does. The incarnation doesn't close this. A
		 * caller's own inserted object carries none, and a write carrying none is allowed through to
		 * the revision check, so an insert under a taken id still reads as a commit. Delete this test
		 * if `put` gains a way to tell an insert from a commit, and assert the refusal in its place.
		 */
		it('takes a second insert under an id stored at the first revision as a commit', async () => {
			const id = crypto.randomUUID();
			const versions = [makeVersion()];

			await store.put(
				makeRecord({
					id,
					versions,
					images: [
						{
							id: 'img-from-the-first-insert',
							downscaled: 'data:image/png;base64,AA==',
							originalHash: 'sha256:a',
							tag: 'auto',
						},
					],
				}),
			);

			const secondInsert = makeRecord({
				id,
				versions,
				images: [
					{
						id: 'img-from-the-second-insert',
						downscaled: 'data:image/png;base64,BB==',
						originalHash: 'sha256:b',
						tag: 'auto',
					},
				],
			});

			await expect(store.put(secondInsert)).resolves.toMatchObject({
				revision: FIRST_REVISION + 1,
				images: secondInsert.images,
			});
			expect((await read(store, id)).images.map((image) => image.id)).toEqual([
				'img-from-the-second-insert',
			]);
		});

		/**
		 * A known limit, pinned so it cannot move unnoticed: the same limit as the test above, with
		 * nothing changed between the two sends.
		 *
		 * A caller that lost the response to an insert can send the identical record again. Storage
		 * takes the resend as a commit built on `FIRST_REVISION` and moves the record to the next
		 * revision, though no field changed. Only a
		 * third send is refused, once storage has left `FIRST_REVISION`. A resent commit behaves
		 * differently, and 'does not tell a retried commit that another write landed in between'
		 * covers it.
		 *
		 * The incarnation doesn't close this, for the reason the test above gives. Delete this test
		 * with the one above if `put` gains a way to tell an insert from a commit.
		 */
		it('takes an identical resend of an insert as a commit, which is a known limit', async () => {
			const record = makeRecord();

			await store.put(record);

			await expect(store.put(record)).resolves.toMatchObject({
				revision: FIRST_REVISION + 1,
				images: record.images,
				versions: record.versions,
			});
			expect((await read(store, record.id)).revision).toBe(FIRST_REVISION + 1);

			await expect(store.put(record)).rejects.toBeInstanceOf(StaleRecordWriteError);
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

		// A copy that fabricates a revision rather than carrying the one it read. It arrives holding a
		// number storage has never issued for this record, over a history that extends the stored one
		// cleanly, so the history rule has nothing to refuse and the base check is the only thing that
		// can. A store that checks only
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
				tag: 'auto',
			});
			await store.put(landed);

			await expect(
				store.put(
					withAddedImage(readByAnother, {
						id: 'img-2',
						downscaled: 'data:image/png;base64,BB==',
						originalHash: 'sha256:b',
						tag: 'auto',
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
		// This write is built on the revision storage currently holds, so the base check passes it and
		// #67's history rule is what has to refuse it. A fixture carrying a stale base would reject
		// before the two histories were compared at all, and could not tell a store that dropped the
		// comparison from one that kept it.
		it('rejects a longer history that diverges from the stored one', async () => {
			const first = makeVersion({ ordinal: 1, createdAt: '2026-01-01T00:00:00.000Z' });
			const record = makeRecord({ versions: [first] });
			await store.put(record);

			const landed = makeVersion({ ordinal: 2, createdAt: '2026-01-02T00:00:00.000Z' });
			await store.put({ ...record, versions: [first, landed] });

			// Built on the revision storage currently holds, so the base check passes it through and
			// #67's history rule is the only thing left that can refuse it. A write carrying a stale
			// base would be refused before the two histories were compared at all.
			const divergent: BrandRecord = {
				...(await read(store, record.id)),
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
		// Built on the revision storage currently holds, for the reason the divergent case above
		// gives: a write carrying a stale base rejects on the base alone, which leaves #67's rule
		// unmeasured. The write below is a well-formed commit that lost a version.
		it('rejects a write whose history is shorter than the stored one', async () => {
			const record = makeRecord();
			await store.put(record);
			const committed = appended(record);
			await store.put(committed);

			// Read back rather than computed: the base has to be what storage reports, or this fixture
			// is asserting against a number the producer made up.
			const shortened: BrandRecord = {
				...record,
				revision: (await read(store, record.id)).revision,
			};

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

		// What a caller needs from a refusal is where the record stands and what its own write was
		// built on. It cannot read the first off its own copy, which is the whole reason the write
		// was refused, so the error carries both and a caller branches on a field rather than on the
		// wording of a message.
		it('reports where the record stands and the revision the refused write was built on', async () => {
			const record = makeRecord();
			await store.put(record);
			const staleCopy = await read(store, record.id);

			// Someone else commits, so storage moves to revision 2 while this copy still reads 1.
			await store.put(appended(record));

			const thrown = await store.put(appended(staleCopy, { interpretation: 'expressive' })).then(
				() => null,
				(error: unknown) => error,
			);

			expect(thrown).toMatchObject({
				kind: 'stale-record-write',
				recordId: record.id,
				storedRevision: 2,
				incomingRevision: 1,
			});
		});

		// A commit that landed and lost its response is the input most likely to be told a falsehood.
		// The caller sends the identical payload again; storage refuses it, because the base it was
		// built on is no longer current, and the refusal has to say that rather than blame a second
		// writer. Refusing rather than accepting it as a duplicate is the choice here: re-reading
		// shows the caller its own commit already in place, so nothing is lost by making it look.
		// This covers commits only. A resent insert is accepted the first time, which the known-limit
		// test for it pins.
		it('does not tell a retried commit that another write landed in between', async () => {
			const record = makeRecord();
			await store.put(record);
			const held = await read(store, record.id);

			const commit = withAddedImage(held, {
				id: 'img-1',
				downscaled: 'data:image/png;base64,AA==',
				originalHash: 'sha256:a',
				tag: 'auto',
			});
			await store.put(commit);

			// The same payload a second time, as a caller that never saw the first response sends it.
			const thrown = await store.put(commit).then(
				() => null,
				(error: unknown) => error,
			);

			expect(thrown).toBeInstanceOf(StaleRecordWriteError);
			const { message } = thrown as StaleRecordWriteError;

			// Nothing landed in between, and no second writer exists in this test to have landed it.
			expect(message).not.toContain('has been written since');
			expect(message).not.toContain('landed in between');
			// What is true instead: where the record stands, and what this write was built on.
			expect(message).toContain('is at revision 2');
			expect(message).toContain('built on revision 1');

			// The commit that did land is still there, which is what makes re-reading the recovery.
			expect((await read(store, record.id)).images.map((image) => image.id)).toEqual(['img-1']);
		});

		// The error carries two pairs of numbers and all four are numbers, so a construction site that
		// fed one field from another's source would report something a reader cannot tell from the
		// truth. Two tests part them, because no single scenario separates all four at once.
		//
		// This one parts a revision from a count: two image-only commits take the record to revision
		// 3 while its history stays at one version.
		it('reports the version counts and the revisions as quantities that can differ', async () => {
			const record = makeRecord();
			await store.put(record);
			const staleCopy = await read(store, record.id);

			await store.put(
				withAddedImage(await read(store, record.id), {
					id: 'img-1',
					downscaled: 'data:image/png;base64,AA==',
					originalHash: 'sha256:a',
					tag: 'auto',
				}),
			);
			await store.put(
				withAddedImage(await read(store, record.id), {
					id: 'img-2',
					downscaled: 'data:image/png;base64,BB==',
					originalHash: 'sha256:b',
					tag: 'auto',
				}),
			);

			const thrown = await store
				.put(
					withAddedImage(staleCopy, {
						id: 'img-3',
						downscaled: 'data:image/png;base64,CC==',
						originalHash: 'sha256:c',
						tag: 'auto',
					}),
				)
				.then(
					() => null,
					(error: unknown) => error,
				);

			// One version throughout, against a record that has reached revision 3. Feed either
			// revision field from a count, or either count from a revision, and one of these moves.
			expect(thrown).toMatchObject({
				kind: 'stale-record-write',
				recordId: record.id,
				storedVersions: 1,
				incomingVersions: 1,
				storedRevision: 3,
				incomingRevision: 1,
			});
		});

		// And this one parts the two counts from each other, which the scenario above cannot: it
		// holds both at 1, so a field given the other record's count reports the same number. Here
		// the write that landed appended a version and the stale copy still carries the shorter
		// history it read.
		it("reports each side's version count from its own record", async () => {
			const record = makeRecord();
			await store.put(record);
			const staleCopy = await read(store, record.id);

			await store.put(appended(record));

			const thrown = await store
				.put(
					withAddedImage(staleCopy, {
						id: 'img-1',
						downscaled: 'data:image/png;base64,AA==',
						originalHash: 'sha256:a',
						tag: 'auto',
					}),
				)
				.then(
					() => null,
					(error: unknown) => error,
				);

			// Two stored versions against the copy's one.
			expect(thrown).toMatchObject({
				kind: 'stale-record-write',
				recordId: record.id,
				storedVersions: 2,
				incomingVersions: 1,
				storedRevision: 2,
				incomingRevision: 1,
			});
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
					tag: 'auto',
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
			const first = await store.put(original);
			await store.delete(original.id);

			const recreated = makeRecord({ id: original.id });
			const stored = await store.put(recreated);

			// Everything the caller sent comes back unchanged. The incarnation is storage's, and it has
			// to be a new one, or a copy of the deleted record would read as a copy of this one.
			expect(stored).toEqual({ ...recreated, incarnation: stored.incarnation });
			expect(stored.incarnation).not.toBe(first.incarnation);
			expect((await read(store, original.id)).versions).toHaveLength(1);
		});

		// Storage mints the incarnation, and nothing a caller sends can choose it.
		it('stamps a fresh incarnation on every insert and carries it through each commit', async () => {
			const inserted = await store.put(makeRecord());
			const other = await store.put(makeRecord());

			expect(inserted.incarnation).toMatch(UUID);
			expect(other.incarnation).not.toBe(inserted.incarnation);

			const committed = await store.put(appended(inserted));
			expect(committed.incarnation).toBe(inserted.incarnation);
		});

		// The insert exception `record-store.ts` documents: a caller that kept its own object after an
		// insert holds no incarnation, and its next write still lands and keeps the stamped one.
		it('keeps the stored incarnation when a write built on the inserted object carries none', async () => {
			const record = makeRecord();
			const inserted = await store.put(record);

			const committed = await store.put(appended(record));

			expect(committed.incarnation).toBe(inserted.incarnation);
		});

		// #122's verbatim replica, now refused. The recreate sits at the revision the copy was read at,
		// so without an incarnation the copy's write would carry the base storage holds.
		it.each(VERSION_COUNTS)(
			'refuses a write from an incarnation that was deleted and recreated (%i versions)',
			async (count) => {
				const versions = historyOf(count);
				const original = makeRecord({ versions });
				await store.put(original);
				const copyOfTheOriginal = await read(store, original.id);

				await store.delete(original.id);
				const recreated = await store.put(makeRecord({ id: original.id, versions }));

				await expect(
					store.put(
						withAddedImage(copyOfTheOriginal, imageNamed('img-from-a-deleted-incarnation')),
					),
				).rejects.toMatchObject({ kind: 'stale-record-write', incarnation: 'replaced' });

				// Both halves, because refusing every write would pass the first alone. The recreated
				// incarnation's own first write still lands.
				await expect(
					store.put(withAddedImage(recreated, imageNamed('img-the-owner-added'))),
				).resolves.toMatchObject({ revision: FIRST_REVISION + 1 });
				expect((await read(store, original.id)).images.map((held) => held.id)).toEqual([
					'img-the-owner-added',
				]);
			},
		);

		// Case P, the ordinary sequence that broke the fourth attempt to bound the gap. The second
		// brand's owner writes from their own inserted object, which is the insert exception above,
		// and that write is what brings the revisions level.
		it.each(VERSION_COUNTS)(
			'refuses a stale write once the recreated record has caught up to the copy revision (%i versions)',
			async (count) => {
				const versions = historyOf(count);
				const original = makeRecord({ versions });
				await store.put(original);
				await store.put(withAddedImage(original, imageNamed('img-the-first-brand-had')));
				const staleCopy = await read(store, original.id);
				expect(staleCopy.revision).toBe(FIRST_REVISION + 1);

				await store.delete(original.id);
				const recreated = makeRecord({ id: original.id, versions });
				await store.put(recreated);
				await store.put(withAddedImage(recreated, imageNamed('img-the-owner-added')));
				expect((await read(store, original.id)).revision).toBe(staleCopy.revision);

				await expect(
					store.put(withAddedImage(staleCopy, imageNamed('img-from-a-deleted-incarnation'))),
				).rejects.toMatchObject({ kind: 'stale-record-write', incarnation: 'replaced' });
				expect((await read(store, original.id)).images.map((held) => held.id)).toEqual([
					'img-the-owner-added',
				]);
			},
		);

		// The shorter route: no recreate, only a delete. The copy carries the incarnation storage handed
		// out, and nothing stored holds it now.
		it.each(VERSION_COUNTS)(
			'refuses to bring a deleted record back from a copy read before the delete (%i versions)',
			async (count) => {
				const original = makeRecord({ versions: historyOf(count) });
				await store.put(original);
				const copyReadBeforeTheDelete = await read(store, original.id);

				await store.delete(original.id);

				await expect(
					store.put(
						withAddedImage(copyReadBeforeTheDelete, imageNamed('img-from-a-deleted-record')),
					),
				).rejects.toMatchObject({
					kind: 'stale-record-write',
					incarnation: 'deleted',
					storedRevision: 0,
					storedVersions: 0,
				});
				expect(await store.get(original.id)).toBeNull();
			},
		);

		it('says the record was deleted when it refuses a copy of one', async () => {
			const original = makeRecord();
			await store.put(original);
			const copy = await read(store, original.id);
			await store.delete(original.id);

			await expect(store.put(copy)).rejects.toThrow(/no longer stored/);
		});

		// One sequence where the stale write is refused, asserted as that sequence and not as a rule
		// about divergence: a recreate whose history differs from the dead copy's can still take a
		// stale write, when the stale write appends the version that closes the difference. Here the
		// recreate carries the same single version at a different instant and the stale write appends
		// nothing, so the histories never agree and the write is refused. Both halves are asserted,
		// because refusing every write would satisfy the first on its own and would be a different
		// defect: the live record's own next image still lands. Since #122 the incarnation refuses this
		// write before the histories are compared.
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
				tag: 'auto',
			});

			await expect(store.put(fromTheDeadIncarnation)).rejects.toBeInstanceOf(StaleRecordWriteError);

			const live = await read(store, recreated.id);
			await expect(
				store.put(
					withAddedImage(live, {
						id: 'img-the-live-record-added',
						downscaled: 'data:image/png;base64,BB==',
						originalHash: 'sha256:live',
						tag: 'auto',
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
			const stored = await store.put(record);

			record.versions.push(makeVersion({ ordinal: 2, interpretation: 'faithful' }));

			expect(await store.get(record.id)).toEqual({
				...record,
				versions: versionsAtPutTime,
				incarnation: stored.incarnation,
			});
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
			await store.put({ ...record, versions: [first, second] });

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

		// #26 stores the user's edits instead of the token set they'd produce, so a version's
		// `overrides` has to round-trip exactly like any other field: nothing here should collapse,
		// reorder, or drop an entry on the way to storage and back.
		it('round-trips a version carrying two overrides unchanged', async () => {
			const record = makeRecord({
				versions: [
					makeVersion({
						overrides: [
							{ kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand.4' },
							{ kind: 'value', category: 'radius', path: ['lg', 'value'], value: 12 },
						],
					}),
				],
			});

			const stored = await store.put(record);
			expect(stored.versions[0]?.overrides).toEqual(record.versions[0]?.overrides);
			expect((await read(store, record.id)).versions[0]?.overrides).toEqual(
				record.versions[0]?.overrides,
			);
		});

		// Pins save and revert with the draft the way overrides do, so they round-trip the same way:
		// a key colour pin and a field pin, in the order they were set.
		it('round-trips a version carrying pins unchanged', async () => {
			const pins: BrandVersion['pins'] = ['keyColors.0', 'radiusCharacter'];
			const record = makeRecordWithHue(200);
			record.versions[0] = { ...record.versions[0]!, pins };

			const stored = await store.put(record);
			expect(stored.versions[0]?.pins).toEqual(pins);
			expect((await read(store, record.id)).versions[0]?.pins).toEqual(pins);
		});

		// Matched against `Error` to stay implementation-blind, like the smuggled-field case. Putting
		// the same record at the current version afterward shows the stamp is what `put` refused,
		// because that put succeeds and the stamp is the only difference.
		// 10 is the last stamp a pre-release build wrote, so it's one a real store can still hold.
		it('rejects a record stamped with a pre-release schema version', async () => {
			const current = makeRecord();
			const stale = {
				...current,
				schemaVersion: 10,
			} as unknown as BrandRecord;

			await expect(store.put(stale)).rejects.toThrow(Error);
			expect(await store.get(stale.id)).toBeNull();
			await expect(store.put(current)).resolves.toMatchObject({
				id: stale.id,
				schemaVersion: SCHEMA_VERSION,
			});
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
			const keptStored = await store.put(kept);
			await store.put(removed);

			await store.delete(removed.id);

			expect(await store.list()).toEqual([keptStored]);
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
