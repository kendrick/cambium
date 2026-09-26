import { z } from 'zod';

import { BrandSeedSchema } from './brand-seed';
import { BRAND_URL_MAX_LENGTH } from './brand-url';
import { IMAGE_TAGS } from './image-tag';
import { keyColorIndex, SeedPinPathSchema } from './seed-pins';
import { overrideKey, TokenOverrideSchema } from './token-overrides';
import { TokenSetSchema } from './token-set';

/**
 * Bumped whenever a stored record's shape changes. Parsing rejects anything else, because
 * the export archive is the only migration path and it only works if a mismatch is loud.
 *
 * 4 folded in two shape changes that landed on separate branches, each independently bumping from
 * 2 to 3: #19's `ordinal` field on `BrandVersionSchema`, and #53's `expressive` field on
 * `BrandSeedSchema`. Merging both at 3 would leave a record stamped 3 ambiguous about which shape
 * it actually holds, so that merge moved the number to 4 instead.
 *
 * 5 is #7's nine non-colour categories on `TokenSetSchema`, all required. A stored record's
 * `tokenSet` is the shape that changed, so a version-4 archive holding a colour-only token set now
 * fails eleven fields inside `BrandRecordSchema.parse`, the nine categories plus a shadow scale in
 * each of the two schemes. Without this bump that record claims a version
 * matching the current format and then dies on a Zod issue list, instead of reaching the loud
 * mismatch this number exists to trigger.
 *
 * 6 is #9's `$extensions` payload, required on every token in a `TokenSetSchema`: every ramp step,
 * every semantic entry, and every non-colour leaf. Nothing was removed, but a version-5 archive
 * carries none of it, so it fails once per token inside `BrandRecordSchema.parse` rather than
 * anywhere a reader could act on. No migration shim: the payload is computed from the seed and the
 * derivation path, and a stored set holds neither, so backfilling one would be inventing the very
 * provenance the field exists to record. `app/storage/indexed-db-record-store.ts` throws on the
 * mismatch and the export archive stays the migration path.
 *
 * 7 is #78's `revision` on `BrandRecordSchema`, required. The change is one key on the record
 * rather than a change inside every token. Without this bump a version-6 archive fails on that
 * one missing key, which reads like any malformed record; with it the archive fails on the
 * version and says why.
 *
 * No migration is written, and what the code does with a version-6 record is throw. Such a record
 * carries no `revision`, so `BrandRecordSchema.parse` rejects it, and because `get` and `list` both
 * parse on the way out it is unreadable rather than silently wrong: `components/landing/landing-route.tsx`
 * catches that rejection and reports the record as unreadable. It cannot be exported around the
 * problem either, since an export reads through the same parse. The reason no shim was written is a
 * fact about deployments rather than about this file: no deployed copy of Cambium held a saved brand
 * when this shipped, confirmed by the project owner on 2026-09-23.
 *
 * 8 is #26's `overrides` on `BrandVersionSchema`, required. A version used to hold what the model
 * said and nothing the user did after, so an override lived only in the workspace draft and was
 * gone on the next open. The overrides are stored rather than the token set they produce, because
 * the derived tokens are recomputed from the seed and storing both puts the same facts in two
 * places. Without this bump a version-7 archive fails once per version on the missing key, which
 * reads like corruption; with it the first issue names `schemaVersion`.
 *
 * No migration is written here either, for the same reason as 7: no deployed copy of Cambium held
 * a saved brand when this shipped. A shim would be trivial, since every version-7 version means
 * `overrides: []`, but a shim for records nobody holds is code nobody runs.
 *
 * 9 is three shape changes landing together so they share one bump: #77's `tag`, required on every
 * `ReferenceImageSchema`; #77's `brandUrl` on `BrandRecordSchema`, required and nullable; and #83's
 * removal of `surfacePolarity` from `BrandSeedSchema`, which nothing read. #22 already asked a
 * person for the tag and the URL, and both were lost when the page closed. Without this bump a
 * version-8 archive fails once per image on the missing tag, once on the missing URL, and once per
 * seed on a key the strict seed schema no longer declares, which reads like corruption; with it the
 * first issue names `schemaVersion`. No migration here either, for the same deployment reason as 7
 * and 8.
 *
 * 10 is #25's `pins` on `BrandVersionSchema`, required. A pinned seed field is one a preset switch
 * and a contrast repair must leave alone, and pins save and revert with the rest of the draft, so
 * like `overrides` they belong to the version rather than to the workspace. Without this bump a
 * version-9 archive fails once per version on the missing key, which reads like corruption; with it
 * the first issue names `schemaVersion`.
 *
 * No migration, for the same deployment reason as 7 through 9. It still held when this shipped:
 * `.github/` holds Dependabot's config and no deploy workflow. A shim would be one line,
 * `defaultSeedPins` on each version's seed, since that pins exactly the observed steps repair
 * protected on a version-9 record, but a shim for records nobody holds is code nobody runs.
 */
export const SCHEMA_VERSION = 10;

/**
 * What storage stamps on a record's first commit. It lives here rather than in `app/storage/`
 * because `revision` is declared here: `z.number().int().positive()` sets the floor, and this names
 * the value a store is expected to start from so the number and the bound cannot drift apart.
 */
export const FIRST_REVISION = 1;

/**
 * Only the downscaled image actually sent to the model is stored, plus a hash of the
 * original. That is the true model input, so it is what makes a version reproducible, and it
 * costs a fraction of the original's storage. The id is what seed provenance points back at.
 *
 * `tag` is what the person said the image is, and it is required. An image nobody tagged holds
 * `auto`, the form's default, so a missing tag can only mean a writer forgot. Filling one in here
 * would hide that writer.
 */
export const ReferenceImageSchema = z.strictObject({
	id: z.string().min(1),
	downscaled: z.string().min(1),
	originalHash: z.string().min(1),
	tag: z.enum(IMAGE_TAGS),
});

export const FontTableRefSchema = z.strictObject({
	source: z.string().min(1),
	version: z.string().min(1),
});

/**
 * Stage 1 is not bit-reproducible, so reproducibility is achieved by reference: a version
 * names every input that can change its output.
 *
 * `scaleEngine` matters because the same seed under a different engine produces different
 * ramps. `fontTable` matters because a client that fell back to the in-repo table ranks the
 * same seed differently from one that fetched the full taxonomy; see
 * docs/adr/0001-fetch-google-fonts-tags-at-runtime.md. `interpretation` matters because the
 * presets re-derive the whole system with no model call, so two versions can share a seed and
 * hold different tokens with nothing else to tell them apart.
 *
 * `rawResponse` is the model's output as it arrived, kept so a version stays diagnosable long
 * after the call and so #23 can show it when parsing failed. It is null exactly when no model
 * call produced the version, which is the interpretation-preset case above.
 *
 * `ordinal` exists because `createdAt` cannot totally order a history by itself: two versions
 * can legally share an instant, and the interpretation-preset path just above is exactly the
 * one likely to produce that, since it re-derives a whole system with no model call and
 * therefore no network round trip to spread two versions across. `createdAt` still says when a
 * version was made; `ordinal` says which one is actually later when that isn't enough. It
 * starts at 1 for a record's first version and increases by exactly one with no gaps, checked
 * independently of `createdAt` in `BrandRecordSchema`'s refinement below.
 *
 * `overrides` is the user's edits to the derived set, in the order they were first made, and it
 * is input the same way `seed` is: a reader re-derives the tokens and applies these on top. It is
 * required, and empty on a version nobody edited, so a writer that forgets it fails the parse
 * instead of quietly dropping the user's work.
 *
 * `pins` names the seed fields a preset switch and a contrast repair must leave alone. Required for
 * the same reason as `overrides`: an empty list is a real answer, everything unpinned, so a missing
 * key can only be a writer that forgot.
 */
export const BrandVersionSchema = z
	.strictObject({
		createdAt: z.iso.datetime(),
		ordinal: z.number().int().positive(),
		seed: BrandSeedSchema.nullable(),
		tokenSet: TokenSetSchema.nullable(),
		provider: z.string().min(1),
		model: z.string().min(1),
		promptVersion: z.string().min(1),
		rawResponse: z.string().nullable(),
		scaleEngine: z.string().min(1),
		fontTable: FontTableRefSchema,
		interpretation: z.enum(['faithful', 'balanced', 'expressive']),
		overrides: z.array(TokenOverrideSchema),
		pins: z.array(SeedPinPathSchema),
	})
	.superRefine((version, ctx) => {
		// Checked here because this is where the seed and its pins meet. A pin past the end names no
		// colour today, and it names whichever colour lands in that slot if the list ever grows, so
		// reading it back would pin something the person never chose.
		const available = version.seed?.keyColors?.length ?? 0;

		version.pins.forEach((pin, index) => {
			const keyIndex = keyColorIndex(pin);

			if (keyIndex !== null && keyIndex >= available) {
				ctx.addIssue({
					code: 'custom',
					path: ['pins', index],
					message: `no key colour at index ${keyIndex}; the seed holds ${available}`,
				});
			}
		});
	});

/**
 * Versions are append-only and ordered oldest first, so a record is a history rather than a
 * current value. The order is enforced because callers read the last entry as current, and an
 * archive that arrives newest-first would hand them an older result without erroring.
 *
 * `revision` counts commits of the whole record, and it is storage that sets it. On a record read
 * out of a store it is the revision that record stands at; on a record handed to `RecordStore.put`
 * it is the revision the copy was read at, which is what lets storage tell a write built on what it
 * holds from one built on something else. `versions.length` cannot do either job: a write that adds
 * a reference image appends no version, so the count stands still while the record changes. #78 is
 * where that bit: a saved brand that could never gain a second reference image.
 *
 * Two writers editing the same copy read the same revision. The first to commit moves storage past
 * it, and the second is refused because the base it carries is no longer the one storage holds. That
 * holds for a writer that carries the revision it read, which is what this field asks of a caller.
 * A caller that computes a revision instead can land on the number storage happens to hold, and
 * `RecordStore.put` cannot tell that from a copy read at it.
 *
 * `revision` starts at `FIRST_REVISION`, matching `ordinal` above rather than counting from 0, so
 * the third commit is revision 3. Nothing here ties it to `versions.length`, because a record can
 * gain commits and no version at all. The schema bounds it to a positive safe integer, since Zod's
 * `.int()` refuses anything past `Number.MAX_SAFE_INTEGER`, and checks nothing else about it:
 * whether a given revision is the one a write may be built on is a question only storage can answer,
 * and `RecordStore.put` holds that check.
 *
 * `brandUrl` is the brand's site as the person typed it, trimmed, or null when they left it blank.
 * It is never parsed as a URL: the form accepts `acme.com` on purpose, because that is what people
 * type, and a URL parse would refuse it. Nothing fetches it either. The length cap is a bound on
 * stored text, not a claim about URLs.
 *
 * Seed provenance is checked against the images the record actually holds. An id pointing at
 * no image is provenance that cannot be followed, which is worse than none, because it still
 * reads as evidence.
 */
export const BrandRecordSchema = z
	.strictObject({
		id: z.uuid(),
		schemaVersion: z.literal(SCHEMA_VERSION),
		revision: z.number().int().positive(),
		brandUrl: z.string().trim().min(1).max(BRAND_URL_MAX_LENGTH).nullable(),
		images: z.array(ReferenceImageSchema),
		versions: z.array(BrandVersionSchema),
	})
	.superRefine((record, ctx) => {
		record.versions.forEach((version, index) => {
			const previous = record.versions[index - 1];
			// z.iso.datetime() accepts variable fractional precision, and lexicographic order is
			// not chronological across it: ".1Z" sorts before "Z" while naming a later instant.
			if (previous && Date.parse(version.createdAt) < Date.parse(previous.createdAt)) {
				ctx.addIssue({
					code: 'custom',
					path: ['versions', index, 'createdAt'],
					message: 'versions must run oldest first',
				});
			}
		});

		// Independent of the createdAt check above: two versions can legally share an instant
		// (the interpretation-preset path makes no model call, so nothing spreads them across
		// time), and ordinal is what still orders that pair. A gap or a repeat here is corrupt
		// regardless of what the timestamps say.
		record.versions.forEach((version, index) => {
			const expected = index + 1;
			if (version.ordinal !== expected) {
				ctx.addIssue({
					code: 'custom',
					path: ['versions', index, 'ordinal'],
					message: `expected ordinal ${expected}, starting at 1 with no gaps`,
				});
			}
		});

		// The workspace holds overrides in a map keyed by `overrideKey`, so it never writes two
		// edits to one leaf. A version that holds two came from somewhere else, and reading it back
		// into that map drops one without a word, so the record wouldn't survive its own round
		// trip. Scoped to one version, since a later version re-editing a leaf is just history.
		record.versions.forEach((version, index) => {
			const seen = new Set<string>();

			version.overrides.forEach((override, overrideIndex) => {
				const key = overrideKey(override);

				if (seen.has(key)) {
					ctx.addIssue({
						code: 'custom',
						path: ['versions', index, 'overrides', overrideIndex],
						message: 'an earlier override in this version already targets the same leaf',
					});
				}
				seen.add(key);
			});
		});

		const imageIds = new Set(record.images.map((image) => image.id));

		// Two images sharing an id leave every reference to it ambiguous, so provenance resolves
		// while identifying nothing in particular.
		if (imageIds.size !== record.images.length) {
			ctx.addIssue({
				code: 'custom',
				path: ['images'],
				message: 'reference image ids must be unique',
			});
		}

		// The seed is the principal input behind a generated token set. A version holding tokens
		// without one cannot be regenerated or explained, which is what a history is for.
		record.versions.forEach((version, index) => {
			if (version.tokenSet && !version.seed) {
				ctx.addIssue({
					code: 'custom',
					path: ['versions', index, 'seed'],
					message: 'a version storing a token set must store the seed that produced it',
				});
			}
		});

		record.versions.forEach((version, index) => {
			version.seed?.keyColors?.forEach((color, colorIndex) => {
				if (!imageIds.has(color.sourceImageId)) {
					ctx.addIssue({
						code: 'custom',
						path: ['versions', index, 'seed', 'keyColors', colorIndex, 'sourceImageId'],
						message: `no reference image with id "${color.sourceImageId}"`,
					});
				}
			});

			version.seed?.imageClassifications?.forEach((classification, classIndex) => {
				if (!imageIds.has(classification.imageId)) {
					ctx.addIssue({
						code: 'custom',
						path: ['versions', index, 'seed', 'imageClassifications', classIndex, 'imageId'],
						message: `no reference image with id "${classification.imageId}"`,
					});
				}
			});
		});
	});

export type ReferenceImage = z.infer<typeof ReferenceImageSchema>;
export type FontTableRef = z.infer<typeof FontTableRefSchema>;
export type BrandVersion = z.infer<typeof BrandVersionSchema>;
export type BrandRecord = z.infer<typeof BrandRecordSchema>;
