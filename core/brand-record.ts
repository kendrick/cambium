import { z } from 'zod';

import { BrandSeedSchema } from './brand-seed';
import { TokenSetSchema } from './token-set';

/**
 * Bumped whenever a stored record's shape changes. Parsing rejects anything else, because
 * the export archive is the only migration path and it only works if a mismatch is loud.
 */
export const SCHEMA_VERSION = 3;

/**
 * Only the downscaled image actually sent to the model is stored, plus a hash of the
 * original. That is the true model input, so it is what makes a version reproducible, and it
 * costs a fraction of the original's storage. The id is what seed provenance points back at.
 */
export const ReferenceImageSchema = z.strictObject({
	id: z.string().min(1),
	downscaled: z.string().min(1),
	originalHash: z.string().min(1),
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
 */
export const BrandVersionSchema = z.strictObject({
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
});

/**
 * Versions are append-only and ordered oldest first, so a record is a history rather than a
 * current value. The order is enforced because callers read the last entry as current, and an
 * archive that arrives newest-first would hand them an older result without erroring.
 *
 * Seed provenance is checked against the images the record actually holds. An id pointing at
 * no image is provenance that cannot be followed, which is worse than none, because it still
 * reads as evidence.
 */
export const BrandRecordSchema = z
	.strictObject({
		id: z.uuid(),
		schemaVersion: z.literal(SCHEMA_VERSION),
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
