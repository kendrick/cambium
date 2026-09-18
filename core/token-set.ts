import { z } from 'zod';

import { BrandSeedSchema } from './brand-seed';
import { CAMBIUM_NAMESPACE } from './provenance';

/**
 * The three provenance values, ordered by distance from the brand: a value read off the seed, a
 * value computed from one, and a value the pipeline supplied because nothing in the seed spoke to
 * it.
 *
 * Destructured into the union below rather than restated there, so the list a consumer iterates and
 * the schema that validates a payload cannot come to name different sets.
 */
export const PROVENANCE_VALUES = ['observed', 'derived', 'invented'] as const;

const [OBSERVED, DERIVED, INVENTED] = PROVENANCE_VALUES;

/**
 * The eleven seed fields, read off `BrandSeedSchema` rather than written out a second time.
 *
 * A free string here would let a token claim a field no seed has, and a trace that resolves to
 * nothing still reads as evidence — the same failure `BrandRecordSchema` guards against when it
 * checks a key colour's `sourceImageId` against the images the record holds. Deriving the enum also
 * means renaming a seed field fails every stale reference at parse instead of leaving them
 * pointing at a name that no longer exists.
 *
 * `brand-seed.ts` imports only zod, so reaching for it here adds no cycle.
 */
export const SeedFieldSchema = z.enum(
	Object.keys(BrandSeedSchema.shape) as [
		keyof typeof BrandSeedSchema.shape,
		...Array<keyof typeof BrandSeedSchema.shape>,
	],
);

/** Long enough for a clause naming a field and what was done to it; short of a paragraph. */
const RATIONALE_MAX_LENGTH = 200;

/**
 * One sentence, bounded rather than parsed.
 *
 * Non-empty, capped, and rejecting a terminator followed by whitespace. That is deliberately a
 * bound on the shape and not a proof of grammar: it catches `Takes the brand hue. Then solves it.`
 * and leaves `0.625rem` and `8.4:1` alone, which is the whole of what it claims to do. A rationale
 * is read beside its token in a UI a line at a time, so a second sentence is a design document
 * filed in the wrong place rather than something to reflow.
 */
const RationaleSchema = z
	.string()
	.min(1, 'rationale cannot be empty')
	.max(RATIONALE_MAX_LENGTH, `rationale must fit in ${RATIONALE_MAX_LENGTH} characters`)
	.refine((rationale) => !/[.!?]\s/.test(rationale), {
		message: 'rationale must be a single sentence',
	});

/**
 * `seedField` is the discriminator's dependent, the same split `FontCandidateSchema` makes between
 * a ranked candidate and an invented one. A flat object with a nullable field would let a token
 * nothing informed point at a seed field anyway, and let one claiming to be observed name nothing —
 * both parse, and both are provenance that cannot be followed.
 */
export const TokenProvenanceSchema = z.discriminatedUnion('provenance', [
	z.strictObject({
		provenance: z.literal(OBSERVED),
		rationale: RationaleSchema,
		seedField: SeedFieldSchema,
	}),
	z.strictObject({
		provenance: z.literal(DERIVED),
		rationale: RationaleSchema,
		seedField: SeedFieldSchema,
	}),
	z.strictObject({
		provenance: z.literal(INVENTED),
		rationale: RationaleSchema,
		seedField: z.null(),
	}),
]);

/**
 * Strict, so the namespace is the only spelling. DTCG reserves `$extensions` for vendor data keyed
 * by a namespace; a payload filed under anyone else's key, or written as bare keys beside the
 * value, is a token this pipeline cannot read back and `core/strictness.test.ts` holds that line.
 */
export const TokenExtensionsSchema = z.strictObject({
	[CAMBIUM_NAMESPACE]: TokenProvenanceSchema,
});

/**
 * Five slots hold a bare number or a tuple and so have nowhere to hang a key: typography's weights
 * and line heights, opacity, z-index, and motion's easings. Wrapping the payload under `value`
 * reads the way `Dimension` and `Duration` already do rather than introducing a second idiom, and
 * it keeps every token in the set answering `$extensions` at its own level.
 */
function scalarToken<T extends z.ZodType>(value: T) {
	return z.strictObject({ value, $extensions: TokenExtensionsSchema });
}

/**
 * The three OKLCH channels and their bounds, in one place.
 *
 * Hue is an angle, so 360 and 0 name the same colour, and canonicalising here keeps one value from
 * having two spellings. `BrandSeedSchema` makes the same move at the trust boundary and for the
 * same reason: identical seeds have to produce identical tokens.
 *
 * A ramp step and a shadow colour both build on this rather than restating it. They had the bounds
 * and the transform written out twice, which is one hue clamp fixed in one place away from a drift
 * nothing would catch.
 */
const OklchChannelsSchema = z.strictObject({
	l: z.number().min(0).max(1),
	c: z.number().min(0),
	h: z
		.number()
		.min(0)
		.max(360)
		.transform((h) => h % 360),
});

export const RampStepSchema = OklchChannelsSchema.extend({
	step: z.number().int().min(1).max(12),
	$extensions: TokenExtensionsSchema,
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

/**
 * `primitives` is a plain object, so a bare index walks the prototype chain: an alias of
 * `constructor.1` hands back a truthy function whose `length` is 1, which satisfies both an
 * existence check and a step bound without any such ramp being declared.
 *
 * One copy, here, because `semantic-layer.ts` needs the same guard. It held its own for as long as
 * this file belonged to an unstarted ticket, and two copies of a trap this quiet are two chances to
 * fix only one of them.
 */
export function declaredRamp<T>(primitives: Record<string, T>, name: string): T | undefined {
	return Object.hasOwn(primitives, name) ? primitives[name] : undefined;
}

/**
 * The step an alias names, or undefined when nothing is there.
 *
 * Splits on the last dot rather than re-running `ALIAS_PATTERN`. Form is the schema's job and it
 * has already run by the time a parsed scheme exists, so the only question left for a caller
 * holding one is whether the target is present. `checkAliasesResolve` keeps its own walk over
 * `declaredRamp` instead of calling this, because it has to tell an unknown ramp apart from a step
 * out of range to report them differently.
 */
export function stepForAlias<T>(
	primitives: Record<string, readonly T[]>,
	alias: string,
): T | undefined {
	const dot = alias.lastIndexOf('.');

	if (dot < 0) return undefined;

	return declaredRamp(primitives, alias.slice(0, dot))?.[Number(alias.slice(dot + 1)) - 1];
}

/**
 * A semantic entry was a bare alias string until it had to carry provenance, and a string has
 * nowhere to put it.
 *
 * The key stays `alias` rather than DTCG's `$value`. Cambium's alias is `ramp.step`, DTCG's is
 * `{group.token}`, and sharing the key would invite a reader to treat one as the other. The
 * borrowed key here is `$extensions` and only that.
 */
export const SemanticEntrySchema = z.strictObject({
	alias: z.string().regex(ALIAS_PATTERN, 'alias must be in ramp.step form'),
	$extensions: TokenExtensionsSchema,
});

export const SemanticLayerSchema = z
	.record(z.string().min(1), SemanticEntrySchema)
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
	value: { primitives: Record<string, unknown[]>; semantic: Record<string, { alias: string }> },
	ctx: z.RefinementCtx,
) {
	for (const [token, entry] of Object.entries(value.semantic)) {
		const match = ALIAS_PATTERN.exec(entry.alias);
		if (!match) continue;

		const [, rampName, rawStep] = match;
		const ramp = declaredRamp(value.primitives, rampName!);
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
 * `source` rather than `provenance`, deliberately. #9's `provenance` now sits on every token inside
 * `values` and says what informed that value; this stays per category and says whether the seed
 * reached the category at all. A category is `derived` whether its governing seed field was stated
 * or fell back, so the two answers genuinely differ and two words keep them apart — reading one off
 * the other is the mistake a producer here is most likely to make.
 *
 * `values` wraps the payload so a token named `source` cannot collide with the discriminator.
 */
function derivedCategory<T extends z.ZodType>(values: T) {
	return z.strictObject({ source: z.literal('derived'), values });
}

function systemCategory<T extends z.ZodType>(values: T) {
	return z.strictObject({ source: z.literal('system'), values });
}

/** A category that parses clean while holding nothing reaches an adapter with no tokens in it. */
function nonEmptyRecord<T extends z.ZodType>(value: T, label: string) {
	return z
		.record(z.string().min(1), value)
		.refine((held) => Object.keys(held).length > 0, { message: `${label} cannot be empty` });
}

/**
 * DTCG's dimension shape, plus `em`, which DTCG's own `dimension` type does not accept.
 * `tracking-scale.ts` records why tracking needs it and what it costs the DTCG adapter.
 *
 * Non-negative, and `SignedDimensionSchema` below is the exception a slot opts into rather than
 * this being the permissive default. A dimension that admits `-1rem` for a border radius is not
 * describing a dimension, it is describing a number wearing a unit: it parses, it persists, and it
 * reaches a stylesheet as a declaration the browser drops.
 *
 * The ten dimension slots in this file split evenly, so the default is chosen on cost rather than
 * on count. A slot wrongly unsigned fails loudly the first time a real negative reaches it, and a
 * slot wrongly signed ships CSS nobody can see is broken. The tenth slot someone adds should
 * inherit the one that fails loudly.
 */
export const DimensionValueSchema = z.strictObject({
	value: z.number().min(0),
	unit: z.enum(['px', 'rem', 'em']),
});

/**
 * The same dimension where it is a token in its own right rather than a part of one.
 *
 * `ShadowSchema` holds four dimensions and is itself one token, because DTCG's `shadow` is a
 * composite type whose `$value` carries colour and geometry together. The shadow takes the payload
 * and its offsets take none, which is what forces the split: `Duration`, `SignedDimension` and
 * `CubicBezier` all make it too. The bare name stays on the token so downstream annotations keep
 * reading the way they did, and the `Value` suffix marks the half a composite holds.
 */
export const DimensionSchema = DimensionValueSchema.extend({
	$extensions: TokenExtensionsSchema,
});

/**
 * The same shape at the five slots where CSS reads a sign as a direction rather than an error.
 *
 * A shadow's `offsetX` and `offsetY` point up and left at negative values, and its `spread` pulls
 * the shadow in: this repo's own scale runs 0 to -5px there. Tracking is negative at the tight end
 * of every feel, three steps of five under a `tight` seed and two under the others.
 * `outline-offset` takes a negative to draw the ring inside the element's edge.
 *
 * Blur is the one shadow dimension that stays unsigned, because CSS rejects a negative blur radius
 * outright rather than treating it as a direction.
 *
 * The split binds at parse time only. Both schemas infer to the same TypeScript type, so a
 * producer annotated `Dimension` while emitting negatives still compiles, and the schema is what
 * catches it. Naming `SignedDimension` at the producing site is documentation rather than
 * enforcement, which is worth knowing before relying on the compiler here.
 */
export const SignedDimensionValueSchema = z.strictObject({
	value: z.number(),
	unit: z.enum(['px', 'rem', 'em']),
});

export const SignedDimensionSchema = SignedDimensionValueSchema.extend({
	$extensions: TokenExtensionsSchema,
});

export const DurationValueSchema = z.strictObject({
	value: z.number().min(0),
	unit: z.literal('ms'),
});

export const DurationSchema = DurationValueSchema.extend({
	$extensions: TokenExtensionsSchema,
});

/** DTCG's `cubicBezier` type. The x coordinates are progress in time, so CSS rejects them outside 0 to 1. */
export const CubicBezierValueSchema = z.tuple([
	z.number().min(0).max(1),
	z.number(),
	z.number().min(0).max(1),
	z.number(),
]);

export const CubicBezierSchema = scalarToken(CubicBezierValueSchema);

/**
 * A shadow colour carries alpha where a ramp step does not. Every other colour in the set is opaque
 * and composited by the consumer; a shadow is the one value whose whole job is to be partly
 * transparent, so an alpha-less shadow colour is a bug rather than a default.
 */
export const ShadowColorSchema = OklchChannelsSchema.extend({
	alpha: z.number().min(0).max(1),
});

/**
 * One token, five parts. A shadow's geometry only means anything together with its colour, so
 * `shadow.md` is what a consumer reads and what carries the payload; tagging each of the five
 * separately would make the token count wrong in every tool that walks the set for provenance.
 */
export const ShadowSchema = z.strictObject({
	color: ShadowColorSchema,
	offsetX: SignedDimensionValueSchema,
	offsetY: SignedDimensionValueSchema,
	blur: DimensionValueSchema,
	spread: SignedDimensionValueSchema,
	$extensions: TokenExtensionsSchema,
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
		weight: nonEmptyRecord(scalarToken(z.number().int().min(1).max(1000)), 'weight set'),
		lineHeight: nonEmptyRecord(scalarToken(z.number().positive()), 'line height set'),
	}),
);

export const TrackingScaleSchema = derivedCategory(
	nonEmptyRecord(SignedDimensionSchema, 'tracking scale'),
);

export const ShadowScaleSchema = derivedCategory(nonEmptyRecord(ShadowSchema, 'shadow scale'));

/**
 * Unsigned, which is the one assignment here that is a judgement rather than a reading of CSS. A
 * scale fed to `margin` may legally be negative, where one fed to `padding` or `gap` may not.
 * Tailwind resolves this by keeping the scale non-negative and letting a negative margin reference
 * it with a `-` prefix, and this follows that: a spacing token is a distance, and the direction
 * belongs to the property using it.
 */
export const SpacingScaleSchema = systemCategory(nonEmptyRecord(DimensionSchema, 'spacing scale'));

export const OpacityScaleSchema = systemCategory(
	nonEmptyRecord(scalarToken(z.number().min(0).max(1)), 'opacity scale'),
);

export const MotionScaleSchema = systemCategory(
	z.strictObject({
		duration: nonEmptyRecord(DurationSchema, 'duration set'),
		easing: nonEmptyRecord(CubicBezierSchema, 'easing set'),
	}),
);

/**
 * `focusRing` rather than `ring`. `SEMANTIC_MAP.ring` is already `brand.11`, a colour that
 * reaches a stylesheet as `--ring`, and a constant sharing that name flattens to the same
 * variable and overwrites it with a width. No adapter writing a flat list reports the collision.
 */
export const FocusRingSchema = systemCategory(
	z.strictObject({ width: DimensionSchema, offset: SignedDimensionSchema }),
);

export const ZIndexScaleSchema = systemCategory(
	nonEmptyRecord(scalarToken(z.number().int()), 'z-index scale'),
);

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
 * Declared as a shape rather than written inline, so `checkMirroredLayers` can derive the mirrored
 * key set from it. The top level repeats every key a scheme holds, and nothing else discovers when
 * a fourth one is added.
 */
const SCHEME_SHAPE = {
	primitives: PrimitiveLayerSchema,
	semantic: SemanticLayerSchema,
	shadow: ShadowScaleSchema,
};

/**
 * Shadow is the one non-colour category a scheme carries, because a shadow tuned for a white page
 * is invisible on a near-black one and the surface it tints resolves differently per scheme.
 * Everything else in the set holds still across the two.
 */
export const SchemeSchema = z.strictObject(SCHEME_SHAPE).superRefine(checkAliasesResolve);

/**
 * Equality over own enumerable keys, which is what these schemas parse to and all this has to
 * compare. Insensitive to key order, because a round trip through a JSON tool reorders keys
 * without changing a token.
 *
 * Not general-purpose structural equality: two objects with no own keys compare equal, so a pair of
 * `Date`s would. Nothing here parses to one, and widening this to handle shapes the schemas cannot
 * produce would be answering a question nobody asked.
 */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;

	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);

	if (keys.length !== Object.keys(right).length) return false;

	return keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

/**
 * The top level is the light scheme, so it has to hold what the light scheme holds.
 *
 * Every key a scheme carries appears twice in a stored set, once unprefixed and once under
 * `schemes.light`, and each copy validated alone. Two copies that may disagree are one copy and a
 * rumour: an adapter reading `tokenSet.primitives` and one reading `tokenSet.schemes.light
 * .primitives` would emit different light themes from the same file, and neither could be called
 * wrong. Round-tripping through any tool that rewrites one half is enough to separate them.
 *
 * Checked over the derived key set rather than a written list. #7 added `shadow` to a mirror that
 * already held `primitives` and `semantic` unguarded, and guarding only the new one would leave a
 * reader to infer from it that the other two were guarded too.
 */
function checkMirroredLayers(
	value: Record<string, unknown> & { schemes: { light: Record<string, unknown> } },
	ctx: z.RefinementCtx,
) {
	const light = value.schemes?.light;

	if (!light) return;

	for (const key of Object.keys(SCHEME_SHAPE)) {
		if (sameValue(value[key], light[key])) continue;

		ctx.addIssue({
			code: 'custom',
			path: [key],
			message: `the unprefixed ${key} is the light scheme's, so it must equal schemes.light.${key}`,
		});
	}
}

/**
 * Strict rather than stripping, here and throughout the persisted shapes. Zod drops unknown
 * keys by default, which for something written to disk means losing data without a word. That is
 * also exactly how #9's `$extensions` payload would fail silently: it would satisfy every
 * in-memory assertion and then vanish on the way to disk. The payload has a declared slot now, so
 * what strictness still guards is the spelling — anything else is a parse error naming the file to
 * widen rather than a gap in the archive.
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
		radius: RadiusScaleSchema,
		typography: TypographySchema,
		tracking: TrackingScaleSchema,
		shadow: ShadowScaleSchema,
		spacing: SpacingScaleSchema,
		opacity: OpacityScaleSchema,
		motion: MotionScaleSchema,
		focusRing: FocusRingSchema,
		zIndex: ZIndexScaleSchema,
	})
	.superRefine(checkAliasesResolve)
	.superRefine(checkMirroredLayers);

export type SeedField = z.infer<typeof SeedFieldSchema>;
export type TokenProvenance = z.infer<typeof TokenProvenanceSchema>;
export type TokenExtensions = z.infer<typeof TokenExtensionsSchema>;

export type RampStep = z.infer<typeof RampStepSchema>;
export type Ramp = z.infer<typeof RampSchema>;
export type SemanticEntry = z.infer<typeof SemanticEntrySchema>;
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;
export type Scheme = z.infer<typeof SchemeSchema>;
export type TokenSet = z.infer<typeof TokenSetSchema>;

/** The `Value` half of each pair is the part a composite holds; the bare name is the token. */
export type DimensionValue = z.infer<typeof DimensionValueSchema>;
export type SignedDimensionValue = z.infer<typeof SignedDimensionValueSchema>;
export type DurationValue = z.infer<typeof DurationValueSchema>;
export type CubicBezierValue = z.infer<typeof CubicBezierValueSchema>;

export type Dimension = z.infer<typeof DimensionSchema>;
export type SignedDimension = z.infer<typeof SignedDimensionSchema>;
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

/** The five categories #7 emits without consulting the seed, returned whole by `systemConstants`. */
export type SystemConstants = {
	spacing: SpacingScale;
	opacity: OpacityScale;
	motion: MotionScale;
	focusRing: FocusRing;
	zIndex: ZIndexScale;
};
