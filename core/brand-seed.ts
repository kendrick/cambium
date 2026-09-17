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
 * The twenty `/Expressive/*` names from Google's tag taxonomy. These are ordinary English
 * adjectives, not the data. The score is the data. Closing the enum means a model returning
 * `serious` instead of `Competent` fails at this trust boundary instead of silently ranking
 * nothing downstream. That couples the seed to the upstream taxonomy, but #42's ranking
 * depends on the same taxonomy regardless of where it is enforced.
 */
export const ExpressiveAxisSchema = z.enum([
	'Active',
	'Artistic',
	'Awkward',
	'Business',
	'Calm',
	'Childlike',
	'Competent',
	'Cute',
	'Excited',
	'Fancy',
	'Futuristic',
	'Happy',
	'Innovative',
	'Loud',
	'Playful',
	'Rugged',
	'Sincere',
	'Sophisticated',
	'Stiff',
	'Vintage',
]);

export const ExpressiveScoreSchema = z.strictObject({
	axis: ExpressiveAxisSchema,
	score: z.number().min(0).max(100),
});

/**
 * Ranked means ordered, the same convention `rankedByScore` enforces for font candidates.
 * Every entry here carries a score, so unlike that refinement there is no invented/derived
 * split to filter out first.
 *
 * An axis is a named measurement, so a seed cannot hold two readings of it: the duplicate
 * check below is the same shape `BrandRecordSchema` uses to reject a repeated reference
 * image id. Without it, `[{Calm, 90}, {Calm, 80}]` would parse, since the ordering check
 * only compares each score against the one before it and never looks at the axis name.
 * #42 ranks on these scores, so a duplicate would silently double one axis's weight.
 */
const rankedByExpressiveScore = z
	.array(ExpressiveScoreSchema)
	.refine((axes) => axes.every((axis, i) => i === 0 || axis.score <= axes[i - 1]!.score), {
		message: 'expressive axes must run highest score first',
	})
	.superRefine((axes, ctx) => {
		const seen = new Set<string>();

		axes.forEach((axis, i) => {
			if (seen.has(axis.axis)) {
				ctx.addIssue({
					code: 'custom',
					path: [i, 'axis'],
					message: `axis "${axis.axis}" is already ranked; a seed holds one reading per axis`,
				});
			}

			seen.add(axis.axis);
		});
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
	expressive: rankedByExpressiveScore.nullable(),
});

export type OklchTriple = z.infer<typeof OklchTripleSchema>;
export type Rect = z.infer<typeof RectSchema>;
export type KeyColor = z.infer<typeof KeyColorSchema>;
export type FontCandidate = z.infer<typeof FontCandidateSchema>;
export type SuggestedPairing = z.infer<typeof SuggestedPairingSchema>;
export type TypeClassification = z.infer<typeof TypeClassificationSchema>;
export type ImageClassification = z.infer<typeof ImageClassificationSchema>;
export type ExpressiveAxis = z.infer<typeof ExpressiveAxisSchema>;
export type ExpressiveScore = z.infer<typeof ExpressiveScoreSchema>;
export type BrandSeed = z.infer<typeof BrandSeedSchema>;
