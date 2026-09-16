import { z } from 'zod';

export const RampStepSchema = z.object({
	step: z.number().int().min(1).max(12),
	l: z.number().min(0).max(1),
	c: z.number().min(0),
	h: z
		.number()
		.min(0)
		.max(360)
		.transform((h) => h % 360),
});

/**
 * A ramp is steps 1 through 12, each exactly once, in order.
 *
 * Fixing only the length is not enough: twelve entries all labelled step 1 pass a length
 * check and the per-entry bounds, and the semantic layer addresses steps by number, so the
 * ramp would be missing the very steps its aliases target. Border is step 6, primary is
 * step 9, foreground is step 12.
 */
export const RampSchema = z
	.array(RampStepSchema)
	.length(12)
	.refine((steps) => steps.every((s, i) => s.step === i + 1), {
		message: 'ramp steps must be 1 through 12, each exactly once, in order',
	});

/** An alias names a ramp and a step within it, so it can be resolved and checked rather than trusted. */
const ALIAS_PATTERN = /^([A-Za-z][\w-]*)\.(\d{1,2})$/;

export const SemanticLayerSchema = z
	.record(z.string().min(1), z.string().regex(ALIAS_PATTERN, 'alias must be in ramp.step form'))
	.refine((layer) => Object.keys(layer).length > 0, { message: 'semantic layer cannot be empty' });

export const PrimitiveLayerSchema = z
	.record(z.string().min(1), RampSchema)
	.refine((layer) => Object.keys(layer).length > 0, { message: 'primitive layer cannot be empty' });

/**
 * An alias that parses but resolves to nothing passes validation and then fails during
 * generation or export, which moves the error a long way from its cause. Checking the target
 * needs both layers in scope, so it lives here rather than on the alias string.
 */
function checkAliasesResolve(
	value: { primitives: Record<string, unknown[]>; semantic: Record<string, string> },
	ctx: z.RefinementCtx,
) {
	for (const [token, alias] of Object.entries(value.semantic)) {
		const match = ALIAS_PATTERN.exec(alias);
		if (!match) continue;

		const [, rampName, rawStep] = match;
		// `primitives` is a plain object, so a bare index walks the prototype chain: an alias of
		// `constructor.1` returns a truthy function whose `length` is 1 and satisfies both checks
		// below without any such ramp being declared.
		const ramp = Object.hasOwn(value.primitives, rampName!)
			? value.primitives[rampName!]
			: undefined;
		const step = Number(rawStep);

		if (!ramp) {
			ctx.addIssue({
				code: 'custom',
				path: ['semantic', token],
				message: `alias targets unknown ramp "${rampName}"`,
			});
			continue;
		}

		if (step < 1 || step > ramp.length) {
			ctx.addIssue({
				code: 'custom',
				path: ['semantic', token],
				message: `alias targets step ${step}, outside ramp "${rampName}"`,
			});
		}
	}
}

export const SchemeSchema = z
	.object({ primitives: PrimitiveLayerSchema, semantic: SemanticLayerSchema })
	.superRefine(checkAliasesResolve);

/**
 * Light and dark are both required. Dark is generated independently against the same step
 * roles rather than inverted from light, so a set holding one scheme is incomplete rather
 * than something the pipeline can finish later.
 */
export const TokenSetSchema = z
	.object({
		primitives: PrimitiveLayerSchema,
		semantic: SemanticLayerSchema,
		schemes: z.object({ light: SchemeSchema, dark: SchemeSchema }),
	})
	.superRefine(checkAliasesResolve);

export type RampStep = z.infer<typeof RampStepSchema>;
export type Ramp = z.infer<typeof RampSchema>;
export type Scheme = z.infer<typeof SchemeSchema>;
export type TokenSet = z.infer<typeof TokenSetSchema>;
