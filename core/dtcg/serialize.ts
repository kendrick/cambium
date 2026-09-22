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
	DTCG_SEGMENT_PATTERN,
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
 * here reads the DOM, the network, storage, or module state. Purity has two halves and both are
 * held: serializing does not touch the token set, and the returned documents share no object with
 * it, so a caller that annotates a document afterwards cannot reach back into the set through it.
 * `detach` below carries the second half and says why it cannot be left to the builders.
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

	rejectReservedNamespace(set, '');

	return {
		light: detach(documentFor(set, mirroredLightScheme(set))),
		dark: detach(documentFor(set, set.schemes.dark)),
	};
}

/**
 * Cuts every reference the document still holds into the parsed token set, and into the caller's.
 *
 * `TokenSetSchema.parse` rebuilds the structure it knows about, so a ramp, a record and a tuple
 * all come back as fresh objects. It cannot rebuild what it does not know: `TokenExtensionsSchema`
 * is a `looseObject`, and Zod passes an unrecognised key through by reference. A foreign
 * namespace's payload is therefore one object shared by the caller's token set and the parse, and
 * the builders hand that same object on to the document. A caller who annotates a serialized
 * document before writing it then edits the token set as a side effect, with nothing to say so.
 *
 * The data that leaks is exactly the data `TokenExtensionsSchema` is loose in order to preserve,
 * per DTCG 5.2.3, so the leak scales with how well another tool's annotations survive the pipeline.
 *
 * Cloning the whole document rather than deep-copying each foreign payload is a deliberate trade.
 * Copying payloads is cheaper on a set that has none, which is every set the pipeline builds
 * today, but it has to be remembered at each of the nine token builders and at every builder
 * anyone adds later, and the failure is silent. One sweep at the exit cannot be forgotten. It
 * costs about 0.37ms against serialization's 0.44ms for a 172-token document, which is the wrong
 * order of magnitude to trade correctness for at export time.
 *
 * It also buys light and dark independence, which the builders do not give on their own: both
 * documents read the same parsed non-colour families, so before this they shared every non-colour
 * `$extensions` object and every easing tuple, and editing one scheme's easing edited the other's.
 */
function detach(document: DtcgDocument): DtcgDocument {
	return structuredClone(document);
}

/**
 * The dotted group paths this file builds token paths from. Assembled out of `DTCG_GROUP` rather
 * than typed as strings, for the reason `dtcg-types.ts` gives: a path a consumer joins from those
 * constants and a path this file writes have to be the same path, and a literal in the middle of a
 * function is the one spelling nothing checks.
 */
const GROUP_PATH = {
	colorPrimitive: `${DTCG_GROUP.color}.${DTCG_GROUP.primitive}`,
	colorSemantic: `${DTCG_GROUP.color}.${DTCG_GROUP.semantic}`,
	typographySize: `${DTCG_GROUP.typography}.${DTCG_GROUP.size}`,
	typographyWeight: `${DTCG_GROUP.typography}.${DTCG_GROUP.weight}`,
	typographyLineHeight: `${DTCG_GROUP.typography}.${DTCG_GROUP.lineHeight}`,
	motionDuration: `${DTCG_GROUP.motion}.${DTCG_GROUP.duration}`,
	motionEasing: `${DTCG_GROUP.motion}.${DTCG_GROUP.easing}`,
} as const;

/**
 * DTCG forbids a dot, a brace, and a leading `$` in a name, and the internal model allows all
 * three: every family keys its tokens by `z.record(z.string().min(1), ...)`, so `radius.values`
 * may legally hold `"compact.md"` and a semantic layer may legally hold `"$primary"`. Those parse,
 * they persist, and they serialize into a document the published schema then rejects, which is the
 * consumer boundary `AGENTS.md` names: right in our representation, wrong the moment the schema
 * evaluates it.
 *
 * Nothing the pipeline builds today has such a key, because every family's names come from a fixed
 * list. This guards the other door: `serializeDtcg` parses whatever it is handed, and #20 hands it
 * archive JSON that no Cambium run necessarily produced.
 *
 * Throwing here rather than widening `TokenSetSchema` is deliberate. The restriction is DTCG's,
 * not the model's, so it belongs on the edge that talks to DTCG; putting it in the schema would
 * reach persistence and reject archives that are valid everywhere except on the way out.
 *
 * Every name this file emits goes through here except the group names themselves, which are
 * `DTCG_GROUP` constants, and `focusRing`'s `width` and `offset`, which `FocusRingSchema` fixes as
 * the only two keys it accepts. All of those are literals in this file rather than data.
 */
function checkSegment(name: string, group: string): void {
	if (!DTCG_SEGMENT_PATTERN.test(name)) {
		throw new Error(`"${name}" is not a legal DTCG name (key of ${group})`);
	}
}

/**
 * `com.cambium.dtcg` is this serializer's to write and nobody else's, so a `TokenSet` carrying one
 * is malformed by our own rule even though `TokenExtensionsSchema` is loose enough to hold it.
 *
 * The damage is quiet without this. `trackingToken` spreads the payload it is given and then
 * writes `{ unit: 'em' }` over any `com.cambium.dtcg` already there, and the deserializer strips
 * the namespace on the way back because it knows serialization invented it, so the original
 * annotation is gone and the round trip comes back deep-unequal with nothing to show which token
 * lost what.
 *
 * Foreign `$extensions` payloads are not walked into. A namespace belonging to another tool may
 * hold whatever keys it likes, including one spelled `$extensions` holding one spelled
 * `com.cambium.dtcg`, and that is its data rather than a claim about one of our tokens.
 */
function rejectReservedNamespace(node: unknown, path: string): void {
	if (typeof node !== 'object' || node === null) return;

	for (const [key, value] of Object.entries(node)) {
		if (key === '$extensions') {
			if (
				typeof value === 'object' &&
				value !== null &&
				Object.hasOwn(value, CAMBIUM_DTCG_NAMESPACE)
			) {
				throw new Error(
					`${path} carries ${CAMBIUM_DTCG_NAMESPACE}, which only serialization may write`,
				);
			}

			continue;
		}

		rejectReservedNamespace(value, path === '' ? key : `${path}.${key}`);
	}
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
			[DTCG_GROUP.primitive]: mapGroup(scheme.primitives, GROUP_PATH.colorPrimitive, rampGroup),
			[DTCG_GROUP.semantic]: mapGroup(scheme.semantic, GROUP_PATH.colorSemantic, aliasToken),
		},
		[DTCG_GROUP.radius]: mapGroup(set.radius.values, DTCG_GROUP.radius, dimensionToken),
		[DTCG_GROUP.spacing]: mapGroup(set.spacing.values, DTCG_GROUP.spacing, dimensionToken),
		[DTCG_GROUP.typography]: {
			[DTCG_GROUP.size]: mapGroup(typography.size, GROUP_PATH.typographySize, dimensionToken),
			[DTCG_GROUP.weight]: mapGroup(typography.weight, GROUP_PATH.typographyWeight, weightToken),
			[DTCG_GROUP.lineHeight]: mapGroup(
				typography.lineHeight,
				GROUP_PATH.typographyLineHeight,
				numberToken,
			),
		},
		[DTCG_GROUP.tracking]: mapGroup(set.tracking.values, DTCG_GROUP.tracking, trackingToken),
		[DTCG_GROUP.shadow]: mapGroup(scheme.shadow.values, DTCG_GROUP.shadow, shadowToken),
		[DTCG_GROUP.motion]: {
			[DTCG_GROUP.duration]: mapGroup(motion.duration, GROUP_PATH.motionDuration, durationToken),
			[DTCG_GROUP.easing]: mapGroup(motion.easing, GROUP_PATH.motionEasing, easingToken),
		},
		[DTCG_GROUP.opacity]: mapGroup(set.opacity.values, DTCG_GROUP.opacity, numberToken),
		[DTCG_GROUP.zIndex]: mapGroup(set.zIndex.values, DTCG_GROUP.zIndex, numberToken),
		[DTCG_GROUP.focusRing]: {
			width: dimensionToken(focusRing.width, `${DTCG_GROUP.focusRing}.width`),
			offset: dimensionToken(focusRing.offset, `${DTCG_GROUP.focusRing}.offset`),
		},
	};
}

/**
 * The one place a token's name becomes a document key, which is why the DTCG name check lives here
 * rather than at each family. Each builder is handed the finished dotted path instead of the bare
 * name, so an error downstream (an `em` radius, a rem tracking value) locates the token the same
 * way this one does.
 */
function mapGroup<T>(
	values: Record<string, T>,
	group: string,
	node: (value: T, path: string) => DtcgGroup | DtcgToken,
): DtcgGroup {
	return Object.fromEntries(
		Object.entries(values).map(([name, value]) => {
			checkSegment(name, group);

			return [name, node(value, `${group}.${name}`)];
		}),
	);
}

/** A scalar family wraps its payload under `value` so it has somewhere to hang `$extensions`. */
type ScalarToken<T> = { value: T; $extensions: TokenExtensions };

/**
 * A step name cannot fail `checkSegment` today: `RampStepSchema` bounds `step` to an integer 1
 * through 12. It is checked anyway so that "every name this document holds went through the DTCG
 * pattern" is true by reading this file, rather than true only for a reader who also goes and
 * re-derives what `RampStepSchema` allows.
 */
function rampGroup(ramp: Ramp, path: string): DtcgGroup {
	return Object.fromEntries(
		ramp.map((step): [string, DtcgColorToken] => {
			const name = String(step.step);

			checkSegment(name, path);

			return [name, { $type: 'color', $value: colorValue(step), $extensions: step.$extensions }];
		}),
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
function trackingToken(tracking: SignedDimension, path: string): DtcgNumberToken {
	if (tracking.unit !== 'em') {
		throw new Error(`${path} is in ${tracking.unit}, and only em rides ${CAMBIUM_DTCG_NAMESPACE}`);
	}

	return {
		$type: 'number',
		$value: tracking.value,
		$extensions: { ...tracking.$extensions, [CAMBIUM_DTCG_NAMESPACE]: { unit: 'em' } },
	};
}

function shadowToken(shadow: Shadow, path: string): DtcgShadowToken {
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
