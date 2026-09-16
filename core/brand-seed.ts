import { z } from 'zod';

/**
 * Hue is an angle, so 360 and 0 name the same colour. Canonicalising at the trust boundary
 * keeps one value from having two spellings, which is what the promise that identical seeds
 * produce identical tokens depends on.
 */
const HueSchema = z
	.number()
	.min(0)
	.max(360)
	.transform((h) => h % 360);

/** Lightness is a 0-1 ratio. A model returning `62` for "62%" parses as a number and would anchor a ramp outside the gamut. */
export const OklchTripleSchema = z.tuple([z.number().min(0).max(1), z.number().min(0), HueSchema]);

/**
 * A source region is expressed as 0-to-1 fractions of the reference image, matching the
 * extraction contract in docs/research/oss-landscape.md. Fractions rather than pixels keep the
 * region meaningful after the image is downscaled, which it always is before storage.
 *
 * The sum checks are the ones worth writing down: every coordinate can sit inside 0 to 1 while
 * the rectangle still runs off the edge, and a region pointing at pixels that do not exist is
 * provenance that cannot be followed.
 */
export const RectSchema = z
	.strictObject({
		x: z.number().min(0).max(1),
		y: z.number().min(0).max(1),
		width: z.number().gt(0).max(1),
		height: z.number().gt(0).max(1),
	})
	.refine((r) => r.x + r.width <= 1, {
		message: 'region extends past the right edge of the image',
	})
	.refine((r) => r.y + r.height <= 1, {
		message: 'region extends past the bottom edge of the image',
	});

export const KeyColorSchema = z.strictObject({
	oklch: OklchTripleSchema,
	proposedRole: z.enum(['brand', 'accent', 'danger', 'warning', 'success', 'info']),
	sourceImageId: z.string().min(1),
	sourceRegion: RectSchema.nullable(),
});

/**
 * Provenance is the discriminator rather than a label beside the data. A `derived` candidate
 * came out of the tag lookup and carries the score that ranked it; one the model named has no
 * derivation edge behind it and therefore no score. Allowing any combination would let an
 * unranked guess present itself as a ranked result, which is the confusion provenance exists
 * to prevent. `observed` is absent on purpose: a typeface is never read off an image the way
 * a key colour is.
 */
export const FontCandidateSchema = z.discriminatedUnion('provenance', [
	z.strictObject({
		provenance: z.literal('derived'),
		family: z.string().min(1),
		score: z.number().min(0).max(100),
		rationale: z.string().min(1),
	}),
	z.strictObject({
		provenance: z.literal('invented'),
		family: z.string().min(1),
		score: z.null(),
		rationale: z.string().min(1),
	}),
]);

/**
 * Candidates are ranked per role, not as one list. A brand needs a display face and a body
 * face, and `typeClassification.displayDiffersFromBody` only means something if the two are
 * addressed separately. An empty array is a role with no candidate, which is different from
 * the whole pairing being absent.
 */
/**
 * Ranked means ordered. The score is what ranks a derived candidate, so a consumer taking the
 * first entry has to get the best one. Invented candidates carry no score and sit outside the
 * ordering rather than breaking it.
 */
const rankedByScore = z.array(FontCandidateSchema).refine(
	(candidates) => {
		const scores = candidates.filter((c) => c.provenance === 'derived').map((c) => c.score);
		return scores.every((score, i) => i === 0 || score <= scores[i - 1]!);
	},
	{ message: 'derived candidates must run highest score first' },
);

export const SuggestedPairingSchema = z.strictObject({
	display: rankedByScore,
	body: rankedByScore,
	mono: rankedByScore,
});

export const TypeClassificationSchema = z.strictObject({
	category: z.enum(['serif', 'sans', 'slab', 'mono']),
	tone: z.enum(['geometric', 'humanist', 'grotesque']),
	xHeight: z.enum(['low', 'medium', 'high']),
	displayDiffersFromBody: z.boolean(),
});

export const ImageClassificationSchema = z.strictObject({
	imageId: z.string().min(1),
	detected: z.enum(['logo', 'ui', 'photo', 'artwork']),
});

/**
 * Every field is a required key holding a nullable value, never an optional key.
 *
 * A seed can be partial: the keyless extractor fills colours and leaves the rest untouched,
 * and that seed gets persisted and read back later. Optional keys disappear through
 * `JSON.stringify`, so a later reader could not tell "nothing in the image informed this"
 * from "this field is not in the schema". Null records the gap. That applies to `sourceRegion`
 * too, which the spec marks optional; here it is nullable for the same reason.
 *
 * Field shapes come from the canonical type block in issue #1, which is more precise than the
 * prose beside it.
 */
export const BrandSeedSchema = z.strictObject({
	keyColors: z.array(KeyColorSchema).nullable(),
	neutralTemperature: z.strictObject({ hue: HueSchema, chroma: z.number().min(0) }).nullable(),
	surfacePolarity: z.enum(['light-first', 'dark-first']).nullable(),
	radiusCharacter: z
		.strictObject({ base: z.number().min(0), progression: z.enum(['sharp', 'soft', 'pill']) })
		.nullable(),
	shadowCharacter: z
		.strictObject({ spread: z.enum(['tight', 'diffuse']), tintFromSurface: z.boolean() })
		.nullable(),
	trackingFeel: z.enum(['tight', 'normal', 'wide']).nullable(),
	typeClassification: TypeClassificationSchema.nullable(),
	suggestedPairing: SuggestedPairingSchema.nullable(),
	typeScaleRatio: z.number().positive().nullable(),
	imageClassifications: z.array(ImageClassificationSchema).nullable(),
});

export type OklchTriple = z.infer<typeof OklchTripleSchema>;
export type Rect = z.infer<typeof RectSchema>;
export type KeyColor = z.infer<typeof KeyColorSchema>;
export type FontCandidate = z.infer<typeof FontCandidateSchema>;
export type SuggestedPairing = z.infer<typeof SuggestedPairingSchema>;
export type TypeClassification = z.infer<typeof TypeClassificationSchema>;
export type ImageClassification = z.infer<typeof ImageClassificationSchema>;
export type BrandSeed = z.infer<typeof BrandSeedSchema>;
