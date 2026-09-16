import { z } from 'zod';

/**
 * A ramp is exactly twelve steps because the semantic layer addresses them positionally:
 * border is step 6, primary is step 9, foreground is step 12. A ramp of any other length
 * parses fine as an array and then silently breaks every alias pointing into it, so the
 * length is a schema constraint rather than a convention.
 */
export const RampStepSchema = z.object({
	step: z.number().int().min(1).max(12),
	l: z.number().min(0).max(1),
	c: z.number().min(0),
	h: z.number().min(0).max(360),
});

export const RampSchema = z.array(RampStepSchema).length(12);

/** Semantic tokens alias into a ramp rather than carrying a literal, so editing a ramp moves everything downstream. */
export const SemanticLayerSchema = z.record(z.string().min(1), z.string().min(1));

export const PrimitiveLayerSchema = z.record(z.string().min(1), RampSchema);

export const SchemeSchema = z.object({
	primitives: PrimitiveLayerSchema,
	semantic: SemanticLayerSchema,
});

/**
 * Light and dark are both required. Dark is generated independently against the same step
 * roles rather than inverted from light, so a set holding only one scheme is incomplete
 * rather than something the pipeline can finish later.
 */
export const TokenSetSchema = z.object({
	primitives: PrimitiveLayerSchema,
	semantic: SemanticLayerSchema,
	schemes: z.object({
		light: SchemeSchema,
		dark: SchemeSchema,
	}),
});

export type RampStep = z.infer<typeof RampStepSchema>;
export type Ramp = z.infer<typeof RampSchema>;
export type Scheme = z.infer<typeof SchemeSchema>;
export type TokenSet = z.infer<typeof TokenSetSchema>;
