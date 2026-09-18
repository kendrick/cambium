import { z } from 'zod';

export const RampStepSchema = z.strictObject({
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

/**
 * Every non-colour category is `{ source, values }`, and `source` says whether the seed informed
 * the category at all.
 *
 * The alternative was a list of constant names held somewhere in the set, which is a claim about
 * the values rather than a property of them and goes stale the first time someone adds a category
 * and forgets the list. With the discriminator, #7's "no system-constant category varies with the
 * seed" is checkable directly: run two seeds, keep the categories whose source is `system`, and
 * assert they are deep-equal.
 *
 * `source` rather than `provenance`, deliberately. #9's `provenance` is per token and says what
 * informed a value; this is per category and says whether the seed reached it. Two words keep the
 * two questions apart. `$extensions` is #9's and stays unwidened here, which is what keeps
 * `core/strictness.test.ts` guarding the next category rather than one already declared.
 *
 * `values` wraps the payload so a token named `source` cannot collide with the discriminator.
 */
function derivedCategory<T extends z.ZodType>(values: T) {
	return z.strictObject({ source: z.literal('derived'), values });
}

function systemCategory<T extends z.ZodType>(values: T) {
	return z.strictObject({ source: z.literal('system'), values });
}

/** A category that parsed clean while holding nothing reaches an adapter as a category with no tokens in it. */
function nonEmptyRecord<T extends z.ZodType>(value: T, label: string) {
	return z
		.record(z.string().min(1), value)
		.refine((held) => Object.keys(held).length > 0, { message: `${label} cannot be empty` });
}

/**
 * DTCG's dimension shape, with one addition. `em` is outside the `px` and `rem` that DTCG's
 * `dimension` type accepts, and tracking needs it: letter-spacing has to scale with the size it
 * applies to. The DTCG adapter therefore has a conversion to make for tracking rather than a value
 * to copy, which #7 records so the adapter ticket finds it before the format validator does.
 */
export const DimensionSchema = z.strictObject({
	value: z.number(),
	unit: z.enum(['px', 'rem', 'em']),
});

export const DurationSchema = z.strictObject({
	value: z.number().min(0),
	unit: z.literal('ms'),
});

/** DTCG's `cubicBezier` type. The two x coordinates are progress in time, so CSS rejects them outside 0 to 1. */
export const CubicBezierSchema = z.tuple([
	z.number().min(0).max(1),
	z.number(),
	z.number().min(0).max(1),
	z.number(),
]);

/**
 * A shadow colour carries alpha where a ramp step does not. Every other colour in the set is opaque
 * and composited by the consumer; a shadow is the one value whose whole job is to be partly
 * transparent, so an alpha-less shadow colour is a bug rather than a default.
 */
export const ShadowColorSchema = z.strictObject({
	l: z.number().min(0).max(1),
	c: z.number().min(0),
	h: z
		.number()
		.min(0)
		.max(360)
		.transform((h) => h % 360),
	alpha: z.number().min(0).max(1),
});

export const ShadowSchema = z.strictObject({
	color: ShadowColorSchema,
	offsetX: DimensionSchema,
	offsetY: DimensionSchema,
	blur: DimensionSchema,
	spread: DimensionSchema,
});

export const RadiusScaleSchema = derivedCategory(nonEmptyRecord(DimensionSchema, 'radius scale'));

export const TypographySchema = derivedCategory(
	z.strictObject({
		size: nonEmptyRecord(DimensionSchema, 'type scale'),
		/**
		 * Weights and line heights sit here rather than among the system constants because #7 names
		 * those five exhaustively and an adapter reads a weight beside the sizes it applies to. Only
		 * `size` derives from the seed: a Brand Seed measures a scale ratio and a type
		 * classification, and it measures no weight axis and no leading.
		 */
		weight: nonEmptyRecord(z.number().int().min(1).max(1000), 'weight set'),
		lineHeight: nonEmptyRecord(z.number().positive(), 'line height set'),
	}),
);

export const TrackingScaleSchema = derivedCategory(
	nonEmptyRecord(DimensionSchema, 'tracking scale'),
);

export const ShadowScaleSchema = derivedCategory(nonEmptyRecord(ShadowSchema, 'shadow scale'));

export const SpacingScaleSchema = systemCategory(nonEmptyRecord(DimensionSchema, 'spacing scale'));

export const OpacityScaleSchema = systemCategory(
	nonEmptyRecord(z.number().min(0).max(1), 'opacity scale'),
);

export const MotionScaleSchema = systemCategory(
	z.strictObject({
		duration: nonEmptyRecord(DurationSchema, 'duration set'),
		easing: nonEmptyRecord(CubicBezierSchema, 'easing set'),
	}),
);

/**
 * `focusRing` rather than `ring`. `SEMANTIC_MAP.ring` is already `brand.11`, a colour that reaches a
 * stylesheet as `--ring`, and a constant sharing that name flattens to the same variable and
 * overwrites it with a width. No adapter writing a flat variable list would report the collision.
 */
export const FocusRingSchema = systemCategory(
	z.strictObject({ width: DimensionSchema, offset: DimensionSchema }),
);

export const ZIndexScaleSchema = systemCategory(nonEmptyRecord(z.number().int(), 'z-index scale'));

/**
 * The colour half of a scheme, on its own.
 *
 * `deriveNonColor` resolves `background` through `resolveScheme` to tint the shadow it is about to
 * produce, and `SchemeSchema` requires that shadow, so taking the full scheme there would be
 * circular. This is the shape that call actually needs.
 */
export const ColorSchemeSchema = z
	.strictObject({ primitives: PrimitiveLayerSchema, semantic: SemanticLayerSchema })
	.superRefine(checkAliasesResolve);

/**
 * Shadow is the one non-colour category a scheme carries, because a shadow tuned for a white page
 * is invisible on a near-black one and the surface it tints resolves differently per scheme.
 * Everything else in the set holds still across the two.
 */
export const SchemeSchema = z
	.strictObject({
		primitives: PrimitiveLayerSchema,
		semantic: SemanticLayerSchema,
		shadow: ShadowScaleSchema.optional(),
	})
	.superRefine(checkAliasesResolve);

/**
 * Strict rather than stripping, here and throughout the persisted shapes. Zod drops unknown
 * keys by default, which for something written to disk means losing data without a word. The
 * `$extensions` payload #9 attaches still needs a slot this schema does not have, so that
 * ticket gets a parse error naming the file to widen instead of a silent gap in the archive.
 *
 * The nine non-colour categories are siblings of the colour layers rather than one `nonColor`
 * block, because an export adapter asks for a category by name and reads `tokenSet.radius`, and
 * because "non-colour" groups by what a category is not. DTCG groups by token type.
 *
 * Light and dark are both required. Dark is generated independently against the same step
 * roles rather than inverted from light, so a set holding one scheme is incomplete rather
 * than something the pipeline can finish later.
 */
export const TokenSetSchema = z
	.strictObject({
		primitives: PrimitiveLayerSchema,
		semantic: SemanticLayerSchema,
		schemes: z.strictObject({ light: SchemeSchema, dark: SchemeSchema }),
		radius: RadiusScaleSchema.optional(),
		typography: TypographySchema.optional(),
		tracking: TrackingScaleSchema.optional(),
		shadow: ShadowScaleSchema.optional(),
		spacing: SpacingScaleSchema.optional(),
		opacity: OpacityScaleSchema.optional(),
		motion: MotionScaleSchema.optional(),
		focusRing: FocusRingSchema.optional(),
		zIndex: ZIndexScaleSchema.optional(),
	})
	.superRefine(checkAliasesResolve);

export type RampStep = z.infer<typeof RampStepSchema>;
export type Ramp = z.infer<typeof RampSchema>;
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type Scheme = z.infer<typeof SchemeSchema>;
export type TokenSet = z.infer<typeof TokenSetSchema>;

export type Dimension = z.infer<typeof DimensionSchema>;
export type Duration = z.infer<typeof DurationSchema>;
export type CubicBezier = z.infer<typeof CubicBezierSchema>;
export type Shadow = z.infer<typeof ShadowSchema>;
export type RadiusScale = z.infer<typeof RadiusScaleSchema>;
export type Typography = z.infer<typeof TypographySchema>;
export type TrackingScale = z.infer<typeof TrackingScaleSchema>;
export type ShadowScale = z.infer<typeof ShadowScaleSchema>;
export type SpacingScale = z.infer<typeof SpacingScaleSchema>;
export type OpacityScale = z.infer<typeof OpacityScaleSchema>;
export type MotionScale = z.infer<typeof MotionScaleSchema>;
export type FocusRing = z.infer<typeof FocusRingSchema>;
export type ZIndexScale = z.infer<typeof ZIndexScaleSchema>;

/** The five categories #7 emits without consulting the seed, which `systemConstants` returns whole. */
export type SystemConstants = {
	spacing: SpacingScale;
	opacity: OpacityScale;
	motion: MotionScale;
	focusRing: FocusRing;
	zIndex: ZIndexScale;
};
