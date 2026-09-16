import { z } from 'zod';

/**
 * Where a seed value came from in the reference images. Null means the pipeline could
 * not trace it, which is different from the field being absent.
 */
export const SourceRefSchema = z.object({
	imageIndex: z.number().int().nonnegative(),
	note: z.string(),
});

/**
 * Lightness is a 0-1 ratio and hue is degrees. Both bounds are enforced because a model
 * returning `l: 62` for "62%" parses as a number and would anchor a ramp outside the gamut.
 */
export const OklchColorSchema = z.object({
	l: z.number().min(0).max(1),
	c: z.number().min(0),
	h: z.number().min(0).max(360),
	role: z.string().min(1),
	source: SourceRefSchema.nullable(),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type OklchColor = z.infer<typeof OklchColorSchema>;

/**
 * A ranked font suggestion. `derived` candidates come out of the tag lookup and carry the
 * score that placed them; a candidate the model named has no derivation edge behind it, so
 * it is `invented` and has no score. `observed` is deliberately absent: a typeface is never
 * read straight off an image the way a key colour is.
 */
export const FontCandidateSchema = z.object({
	family: z.string().min(1),
	score: z.number().min(0).max(100).nullable(),
	rationale: z.string().min(1),
	provenance: z.enum(['derived', 'invented']),
});

export type FontCandidate = z.infer<typeof FontCandidateSchema>;

/**
 * Every seed field is a required key with a nullable value, never an optional key.
 *
 * The distinction is load-bearing. A seed can be partial: the keyless local extractor
 * fills colours and leaves everything else untouched, and that seed gets persisted and
 * read back later. Optional keys would disappear through `JSON.stringify`, so a later
 * reader could not tell "nothing in the image informed this" from "this field is not in
 * the schema". Null says the gap is real and was recorded.
 */
export const BrandSeedSchema = z.object({
	keyColors: z.array(OklchColorSchema).nullable(),
	neutralTemperature: z.enum(['warm', 'neutral', 'cool']).nullable(),
	surfacePolarity: z.enum(['light', 'dark']).nullable(),
	radiusCharacter: z.string().min(1).nullable(),
	shadowCharacter: z.string().min(1).nullable(),
	trackingFeel: z.string().min(1).nullable(),
	typeClassification: z.string().min(1).nullable(),
	fontCandidates: z.array(FontCandidateSchema).nullable(),
	typeScaleRatio: z.number().positive().nullable(),
	imageClassifications: z.array(z.unknown()).nullable(),
});

export type BrandSeed = z.infer<typeof BrandSeedSchema>;
