import { type Oklch, toSrgbHex } from '../oklch';
import { CAMBIUM_NAMESPACE } from '../provenance';
import {
	type CubicBezier,
	type Dimension,
	type DimensionValue,
	type Duration,
	type Ramp,
	type Scheme,
	type SemanticEntry,
	type Shadow,
	type SignedDimension,
	type SignedDimensionValue,
	type TokenExtensions,
	type TokenSet,
	TokenSetSchema,
} from '../token-set';
import {
	CAMBIUM_DTCG_NAMESPACE,
	DTCG_GROUP,
	type DtcgColorToken,
	type DtcgColorValue,
	type DtcgCubicBezierToken,
	type DtcgDimensionToken,
	type DtcgDimensionValue,
	type DtcgDocument,
	type DtcgDurationToken,
	type DtcgFontWeightToken,
	type DtcgGroup,
	type DtcgNumberToken,
	type DtcgShadowToken,
	type DtcgToken,
	toDtcgAlias,
} from './dtcg-types';

/**
 * Two complete documents rather than a base and an override: light and dark are generated
 * independently against the same step roles (`core/scale-engine.ts:21`), so neither one is a patch
 * on the other, and a consumer may take either without reading the sibling first.
 */
export type DtcgDocumentPair = { light: DtcgDocument; dark: DtcgDocument };

/**
 * Writes the internal `TokenSet` out as two DTCG 2025.10 documents, one per scheme.
 *
 * Pure in the sense the acceptance criterion asks for: same token set in, same bytes out. Nothing
 * here reads the DOM, the network, storage, or module state, and the input comes back untouched,
 * because every token is built fresh rather than annotated in place.
 *
 * Key order follows insertion order, which follows the order the token set holds its families and
 * names in, so one token set always writes one byte sequence. Ramp steps need no care at all: they
 * are named `"1"` through `"12"`, integer-like keys that every JS engine emits ascending ahead of
 * the string keys regardless of how they went in. A test asserting insertion order there would be
 * asserting something the engine overrides.
 *
 * Two things this deliberately does not do. It does not flatten a semantic token to the colour it
 * points at. `core/resolve-scheme.ts` is the flattener and belongs to the export adapters in #12
 * and #13, not to the canonical document, whose whole value is that the alias survives. And it
 * does not grade its own output: `validateDtcg` is the conformance check, and a second
 * hand-rolled one here would only prove this file agrees with itself.
 *
 * `hex` on every colour is a DTCG fallback for tools that cannot evaluate a colour space, and the
 * spec keeps it six digits so it cannot contradict a sibling `alpha`. Shadow colours do carry
 * alpha, so a consumer that reads their `hex` and ignores `alpha` renders an opaque shadow. That
 * is the spec's trade rather than a gap here, and `toSrgbHex` records the matching argument for
 * why the hex is the byte pair the contrast gate measured rather than a second rounding of it.
 */
export function serializeDtcg(tokenSet: TokenSet): DtcgDocumentPair {
	// `TokenSet` is Zod's output type, so the compiler accepting an argument here does not mean the
	// schema would. `buildTokenSet` never parses and `scripts/generate.mjs` hands its result
	// straight on, so a hue of exactly 360 reaches this function routinely: legal on the way in,
	// folded to 0 by the schema's transform, rejected by DTCG's `exclusiveMaximum`. Parsing makes
	// the type true and fails with a Zod path instead of nineteen Ajv diagnostics downstream.
	const set = TokenSetSchema.parse(tokenSet);

	return {
		light: documentFor(set, mirroredLightScheme(set)),
		dark: documentFor(set, set.schemes.dark),
	};
}

/**
 * Colours and shadows come from the scheme; every other family lives once on the set and is
 * written into both documents. That split is what makes the two documents hold matching key sets
 * while disagreeing about exactly the values a theme switch is allowed to change.
 *
 * Group keys are spelled through `DTCG_GROUP` rather than typed inline so the path a consumer
 * builds from those constants and the path this function writes cannot come apart. The `$type`
 * literals are written out at each construction site instead of read from `DTCG_FAMILY_TYPES`,
 * because the token union yokes `$type` to its `$value` shape and only a literal narrows it.
 * `serialize.test.ts` checks the two statements against each other rather than leaving them
 * unreconciled.
 */
function documentFor(set: TokenSet, scheme: Scheme): DtcgDocument {
	const typography = set.typography.values;
	const motion = set.motion.values;
	const focusRing = set.focusRing.values;

	return {
		[DTCG_GROUP.color]: {
			[DTCG_GROUP.primitive]: mapGroup(scheme.primitives, rampGroup),
			[DTCG_GROUP.semantic]: mapGroup(scheme.semantic, aliasToken),
		},
		[DTCG_GROUP.radius]: mapGroup(set.radius.values, (token, name) =>
			dimensionToken(token, `radius.${name}`),
		),
		[DTCG_GROUP.spacing]: mapGroup(set.spacing.values, (token, name) =>
			dimensionToken(token, `spacing.${name}`),
		),
		[DTCG_GROUP.typography]: {
			[DTCG_GROUP.size]: mapGroup(typography.size, (token, name) =>
				dimensionToken(token, `typography.size.${name}`),
			),
			[DTCG_GROUP.weight]: mapGroup(typography.weight, weightToken),
			[DTCG_GROUP.lineHeight]: mapGroup(typography.lineHeight, numberToken),
		},
		[DTCG_GROUP.tracking]: mapGroup(set.tracking.values, trackingToken),
		[DTCG_GROUP.shadow]: mapGroup(scheme.shadow.values, shadowToken),
		[DTCG_GROUP.motion]: {
			[DTCG_GROUP.duration]: mapGroup(motion.duration, durationToken),
			[DTCG_GROUP.easing]: mapGroup(motion.easing, easingToken),
		},
		[DTCG_GROUP.opacity]: mapGroup(set.opacity.values, numberToken),
		[DTCG_GROUP.zIndex]: mapGroup(set.zIndex.values, numberToken),
		[DTCG_GROUP.focusRing]: {
			width: dimensionToken(focusRing.width, 'focusRing.width'),
			offset: dimensionToken(focusRing.offset, 'focusRing.offset'),
		},
	};
}

function mapGroup<T>(
	values: Record<string, T>,
	node: (value: T, name: string) => DtcgGroup | DtcgToken,
): DtcgGroup {
	return Object.fromEntries(
		Object.entries(values).map(([name, value]) => [name, node(value, name)]),
	);
}

/** A scalar family wraps its payload under `value` so it has somewhere to hang `$extensions`. */
type ScalarToken<T> = { value: T; $extensions: TokenExtensions };

function rampGroup(ramp: Ramp): DtcgGroup {
	return Object.fromEntries(
		ramp.map((step): [string, DtcgColorToken] => [
			String(step.step),
			{ $type: 'color', $value: colorValue(step), $extensions: step.$extensions },
		]),
	);
}

/**
 * Cambium's alias is `ramp.step` and DTCG's is `{group.token}`, so this is a translation rather
 * than a copy. It splits on the last dot the way `stepForAlias` does instead of re-running the
 * alias pattern: form is the schema's job and `checkAliasesResolve` has already proved both that
 * the alias parses and that it lands on a step that exists, which is why nothing here re-checks
 * the target. `toDtcgAlias` still grades each segment, because the segment Cambium accepts in a
 * ramp name and the segment the DTCG schema accepts in a path are two different rules.
 */
function aliasToken(entry: SemanticEntry): DtcgColorToken {
	const dot = entry.alias.lastIndexOf('.');

	if (dot < 0) throw new Error(`"${entry.alias}" is not in ramp.step form`);

	return {
		$type: 'color',
		$value: toDtcgAlias([
			DTCG_GROUP.color,
			DTCG_GROUP.primitive,
			entry.alias.slice(0, dot),
			entry.alias.slice(dot + 1),
		]),
		$extensions: entry.$extensions,
	};
}

function colorValue(color: Oklch & { alpha?: number }): DtcgColorValue {
	const { l, c, h, alpha } = color;
	const hex = toSrgbHex({ l, c, h });

	return alpha === undefined
		? { colorSpace: 'oklch', components: [l, c, h], hex }
		: { colorSpace: 'oklch', components: [l, c, h], alpha, hex };
}

/**
 * The unit rides through from the internal token rather than being fixed per family, which is why
 * `DTCG_FAMILY_TYPES` carries no unit column: `radius` and `focusRing` are both `dimension` and
 * one is rem where the other is px, so a table entry would have to be wrong for one of them.
 *
 * `em` is the internal model's third unit and DTCG's `dimension` has no room for it. Only tracking
 * uses it today, and tracking takes the `number` path below, so an `em` arriving here means a
 * family grew a unit nobody told this file about. Failing is the point: the alternative is
 * relabelling it px or rem, and an em is relative to the element's font size where those two are
 * not, so the relabelled value is right at one font size and wrong at every other.
 */
function dimensionValue(
	dimension: DimensionValue | SignedDimensionValue,
	path: string,
): DtcgDimensionValue {
	if (dimension.unit === 'em') {
		throw new Error(`${path} is in em, which DTCG's dimension type does not accept`);
	}

	return { value: dimension.value, unit: dimension.unit };
}

function dimensionToken(dimension: Dimension | SignedDimension, path: string): DtcgDimensionToken {
	return {
		$type: 'dimension',
		$value: dimensionValue(dimension, path),
		$extensions: dimension.$extensions,
	};
}

function weightToken(weight: ScalarToken<number>): DtcgFontWeightToken {
	return { $type: 'fontWeight', $value: weight.value, $extensions: weight.$extensions };
}

function numberToken(scalar: ScalarToken<number>): DtcgNumberToken {
	return { $type: 'number', $value: scalar.value, $extensions: scalar.$extensions };
}

/**
 * Tracking is the one family whose unit cannot be written down in DTCG, so the magnitude goes out
 * as a plain `number` and the unit rides beside the provenance payload in the transport namespace.
 *
 * The unit is asserted rather than assumed. Every tracking value this pipeline produces is in em
 * today, and if one ever is not, a silent pass here would publish a rem magnitude that the
 * deserializer reads back as em—a wrong number wearing the right shape, which is the failure
 * that survives a round trip looking correct.
 */
function trackingToken(tracking: SignedDimension, name: string): DtcgNumberToken {
	if (tracking.unit !== 'em') {
		throw new Error(
			`tracking.${name} is in ${tracking.unit}, and only em rides ${CAMBIUM_DTCG_NAMESPACE}`,
		);
	}

	return {
		$type: 'number',
		$value: tracking.value,
		$extensions: { ...tracking.$extensions, [CAMBIUM_DTCG_NAMESPACE]: { unit: 'em' } },
	};
}

function shadowToken(shadow: Shadow, name: string): DtcgShadowToken {
	const path = `shadow.${name}`;

	return {
		$type: 'shadow',
		$value: {
			color: colorValue(shadow.color),
			offsetX: dimensionValue(shadow.offsetX, `${path}.offsetX`),
			offsetY: dimensionValue(shadow.offsetY, `${path}.offsetY`),
			blur: dimensionValue(shadow.blur, `${path}.blur`),
			spread: dimensionValue(shadow.spread, `${path}.spread`),
		},
		$extensions: shadow.$extensions,
	};
}

function durationToken(duration: Duration): DtcgDurationToken {
	return {
		$type: 'duration',
		$value: { value: duration.value, unit: duration.unit },
		$extensions: duration.$extensions,
	};
}

function easingToken(easing: CubicBezier): DtcgCubicBezierToken {
	return { $type: 'cubicBezier', $value: easing.value, $extensions: easing.$extensions };
}

/**
 * The light scheme with the top-level mirror folded into it.
 *
 * A stored token set holds its light scheme twice, once unprefixed and once under `schemes.light`,
 * and `checkMirroredLayers` requires the two to agree about every value, except a foreign
 * `$extensions` namespace, which it exempts on purpose so a tool that walked the file and
 * annotated the copy it found is not rejected for doing the only thing available to it.
 *
 * That exemption hands this adapter a token annotated twice, and `core/token-set.ts` says whose
 * problem it is: the honest reading is the union, because the two copies are one token written
 * twice for consumers, and a genuine collision is the adapter's to report rather than the schema's
 * to prevent. So foreign namespaces union, and two different values under one namespace throw.
 * Picking a copy would be the one wrong answer: it looks like it worked, and the annotation it
 * dropped is data DTCG 5.2.3 requires a tool to preserve.
 *
 * Nothing produces a divergent mirror today: `buildTokenSet` writes both copies from one object.
 * This exists for the annotator the carve-out was written for.
 */
function mirroredLightScheme(set: TokenSet): Scheme {
	const light = set.schemes.light;

	return {
		primitives: Object.fromEntries(
			Object.entries(light.primitives).map(([name, ramp]) => [
				name,
				ramp.map((step, index) => ({
					...step,
					$extensions: unionExtensions(
						step.$extensions,
						set.primitives[name]?.[index]?.$extensions,
						`primitives.${name}.${step.step}`,
					),
				})),
			]),
		),
		semantic: Object.fromEntries(
			Object.entries(light.semantic).map(([name, entry]) => [
				name,
				{
					...entry,
					$extensions: unionExtensions(
						entry.$extensions,
						set.semantic[name]?.$extensions,
						`semantic.${name}`,
					),
				},
			]),
		),
		shadow: {
			...light.shadow,
			values: Object.fromEntries(
				Object.entries(light.shadow.values).map(([name, shadow]) => [
					name,
					{
						...shadow,
						$extensions: unionExtensions(
							shadow.$extensions,
							set.shadow.values[name]?.$extensions,
							`shadow.${name}`,
						),
					},
				]),
			),
		},
	};
}

/**
 * `com.cambium` is skipped rather than compared: the mirror check already proved both copies carry
 * the same payload, so the only thing a second comparison here could do is disagree with the
 * schema.
 */
function unionExtensions(
	own: TokenExtensions,
	mirror: TokenExtensions | undefined,
	path: string,
): TokenExtensions {
	if (!mirror) return own;

	const merged: Record<string, unknown> = { ...own };

	for (const [namespace, annotation] of Object.entries(mirror)) {
		if (namespace === CAMBIUM_NAMESPACE) continue;

		if (!Object.hasOwn(merged, namespace)) {
			merged[namespace] = annotation;
			continue;
		}

		if (!sameJson(merged[namespace], annotation)) {
			throw new Error(
				`the two copies of ${path} carry different "${namespace}" data, and this adapter will not pick one`,
			);
		}
	}

	return merged as TokenExtensions;
}

/**
 * Deep equality over the JSON a foreign namespace can hold. Key order is ignored, because a round
 * trip through any JSON tool reorders keys without changing an annotation, and reporting that as a
 * collision would fail a file no tool did anything wrong to.
 */
function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;

	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);

	return (
		keys.length === Object.keys(right).length &&
		keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
	);
}
