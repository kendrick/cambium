import type { BrandSeed, KeyColor, OklchTriple } from './brand-seed';
import {
	contrastFromOklch,
	fitToSrgbGamut,
	hueDistance,
	type Oklch,
	oklchDistance,
	quantizeToSrgb,
	solveLightnessForContrast,
} from './oklch';
import {
	ANCHOR_TOLERANCE,
	type BrandAnchor,
	type InterpretationParams,
	RAMP_NAMES,
	type RampName,
	type RampSet,
	SCHEME_NAMES,
	type SchemeName,
	type ScaleEngine,
	type ScaleEngineError,
	type ScaleEngineResult,
} from './scale-engine';
import { BRAND_STEP, STEP_ROLES } from './step-roles';
import type { Ramp, RampStep } from './token-set';

/**
 * Persisted on every version as `scaleEngine`, because the same seed under a different engine
 * produces different ramps and a stored token set has to say which one made it.
 */
export const OKLCH_SCALE_ENGINE_ID = 'cambium-oklch-1';

/**
 * Lightness per step, measured as the median across the sixty-two solid Radix scales and rounded.
 * Steps 9 and 10 are absent because they carry the ramp's own anchor colour rather than a curve
 * value; see `anchoredToSeed` in `core/step-roles.ts` for why that carve-out exists.
 *
 * These are the numbers most worth arguing with. They are a starting point taken from a palette
 * that was hand-tuned by people with taste, not a derivation from first principles, and the swatch
 * grid in `scripts/swatches.mjs` is where an argument about them gets settled.
 */
const LIGHTNESS = {
	light: [0.994, 0.982, 0.959, 0.932, 0.9, 0.859, 0.806, 0.734, null, null, 0.544, 0.332],
	dark: [0.188, 0.211, 0.267, 0.309, 0.345, 0.389, 0.452, 0.537, null, null, 0.785, 0.911],
} as const;

/**
 * Chroma as a fraction of the anchor's own chroma rather than an absolute value, so a muted brand
 * gets a muted ramp. Taking Radix's absolute chroma would hand a brand at chroma 0.05 the same
 * step 8 as one at 0.21, which reads as the tool ignoring the colour it was given.
 */
const CHROMA_FRACTION = {
	light: [0.019, 0.052, 0.124, 0.22, 0.297, 0.381, 0.487, 0.633, 1, 0.991, 0.723, 0.32],
	dark: [0.077, 0.103, 0.263, 0.393, 0.437, 0.484, 0.528, 0.64, 1, 0.959, 0.732, 0.295],
} as const;

/** Step 10 is step 9 nudged one notch further from the page, which is what a hover state is. */
const STEP_10_OFFSET = { light: -0.027, dark: 0.039 } as const;

/**
 * Neutral is the one ramp with no anchor colour to place, because a seed states it as a temperature
 * rather than as a colour. It is also the only ramp Radix lets differ between schemes at step 9.
 */
const NEUTRAL_ANCHOR_LIGHTNESS = { light: 0.642, dark: 0.536 } as const;

/**
 * The chroma a fully tinted neutral would take, as a fraction of the brand's own. A neutral reads
 * as grey rather than as a weak version of the brand, so even at `neutralTinting` 1 it stays a
 * quarter. Radix's own tinted greys sit near chroma 0.011 at step 9, which a saturated seed lands
 * on at the Balanced tinting of 0.25.
 */
const NEUTRAL_CHROMA_CEILING = 0.25;

/**
 * Status hues, measured off Radix's own step 9 for red, amber, green and blue. Fixed rather than
 * harmonised toward the brand, because a danger colour that has drifted toward the brand hue stops
 * reading as danger. `harmonization` in the interpretation parameters is what moves them, and it
 * sits at 0 under Balanced.
 */
const STATUS_ANCHORS = {
	danger: { l: 0.6256, c: 0.1933, h: 23 },
	warning: { l: 0.8537, c: 0.1572, h: 84.1 },
	success: { l: 0.6406, c: 0.1329, h: 157.7 },
	info: { l: 0.6493, c: 0.193, h: 251.8 },
} as const satisfies Record<string, Oklch>;

function normalizeHue(hue: number): number {
	return ((hue % 360) + 360) % 360;
}

function toOklch(triple: OklchTriple): Oklch {
	return { l: triple[0], c: triple[1], h: triple[2] };
}

function toTriple(color: Oklch): OklchTriple {
	return [color.l, color.c, color.h];
}

/** Lightness moves away from the page to raise contrast, which is downward in the light scheme. */
const DIRECTION = { light: -1, dark: 1 } as const;

/**
 * Solving and gamut mapping pull against each other: moving lightness to hit a contrast floor can
 * push a colour out of sRGB, and mapping it back reduces chroma, which changes the luminance the
 * solve was aiming at. One pass of each lands just under the floor for a saturated hue. Alternating
 * them converges in two or three rounds because every mapping step only ever reduces chroma.
 *
 * The margin absorbs quantization. Rounding to six decimal places moves contrast in the last
 * decimal, and a step solved to exactly the floor can round back under it.
 */
const FLOOR_MARGIN = 1.0005;

function meetFloor(
	color: Oklch,
	background: Oklch,
	floor: number,
	direction: -1 | 1,
): Oklch | null {
	const target = floor * FLOOR_MARGIN;
	let candidate = color;

	// Six rounds is generous. Each one only ever reduces chroma, and at zero chroma contrast is
	// decided by lightness alone, so the pair converges. Returning null rather than the last
	// candidate is what keeps a ramp from claiming a floor it missed.
	for (let attempt = 0; attempt < 6; attempt += 1) {
		if (contrastFromOklch(candidate, background) >= target) return candidate;

		const l = solveLightnessForContrast(candidate, background, target, direction);

		candidate = fitToSrgbGamut({ ...candidate, l });
	}

	return contrastFromOklch(candidate, background) >= floor ? candidate : null;
}

/**
 * One ramp, twelve steps, in three passes.
 *
 * The curve places every step first. Then each step carrying a floor in the table is solved onto
 * it, because a fixed lightness per step does not give a fixed contrast: luminance depends on
 * chroma and hue as well, so a saturated green at the step 11 lightness lands near 4.49 against
 * step 2 where blue lands at 4.53. Radix absorbed that by hand-tuning thirty-one scales. Solving
 * for the target is how one curve covers every hue instead.
 *
 * Quantizing last keeps the rounding out of the arithmetic that fed it.
 */
function buildRamp(
	anchor: Oklch,
	scheme: SchemeName,
	spread: number,
): { ok: true; ramp: Ramp } | { ok: false; step: number } {
	const lightness = LIGHTNESS[scheme];
	const fractions = CHROMA_FRACTION[scheme];
	const direction = DIRECTION[scheme];

	const placed = STEP_ROLES.map((role, index) => {
		const chroma = anchor.c * fractions[index]! * spread;

		if (role.step === BRAND_STEP) return fitToSrgbGamut(anchor);
		if (role.anchoredToSeed) {
			return fitToSrgbGamut({ l: anchor.l + STEP_10_OFFSET[scheme], c: chroma, h: anchor.h });
		}

		return fitToSrgbGamut({ l: lightness[index]!, c: chroma, h: anchor.h });
	});

	const background = placed[1]!;
	const steps: RampStep[] = [];

	for (const [index, color] of placed.entries()) {
		const role = STEP_ROLES[index]!;
		const solved =
			role.minWcagVsStep2 === null
				? color
				: meetFloor(color, background, role.minWcagVsStep2, direction);

		if (!solved) return { ok: false, step: role.step };

		const { l, c, h } = quantizeToSrgb({ ...solved, h: normalizeHue(solved.h) });

		steps.push({ step: role.step, l, c, h });
	}

	return { ok: true, ramp: steps as Ramp };
}

function rotateToward(hue: number, target: number, amount: number): number {
	const arc = ((target - hue + 540) % 360) - 180;

	return normalizeHue(hue + arc * amount);
}

function pickKeyColor(keyColors: readonly KeyColor[], role: KeyColor['proposedRole']) {
	return keyColors.find((candidate) => candidate.proposedRole === role);
}

/**
 * How far a derived accent has to stay from the brand and from every status hue. Below about this,
 * two ramps stop reading as two ramps.
 */
const MIN_ACCENT_SEPARATION = 25;

/**
 * The nearest hue to `preferred` that is not crowding a hue already spoken for.
 *
 * A fixed rotation cannot work on its own. At the Balanced 120 degrees a blue brand lands its
 * accent 3.2 degrees off danger and a crimson brand lands 20 degrees off success, so the palette
 * ships two ramps that look like the same colour and mean different things. Searching outward one
 * degree at a time keeps the result deterministic and keeps the rotation a preference rather than
 * an instruction that cannot be honoured.
 */
function clearOfReservedHues(preferred: number, reserved: readonly number[]): number {
	const crowded = (hue: number) =>
		reserved.some((taken) => hueDistance(hue, taken) < MIN_ACCENT_SEPARATION);

	if (!crowded(preferred)) return preferred;

	for (let delta = 1; delta <= 180; delta += 1) {
		for (const candidate of [preferred + delta, preferred - delta]) {
			const hue = normalizeHue(candidate);

			if (!crowded(hue)) return hue;
		}
	}

	return preferred;
}

/**
 * Accent comes from an observed second colour when the image offered one, and from a hue rotation
 * when it did not. The rotated accent keeps the brand's lightness and chroma so the two read as the
 * same family at different angles rather than as two unrelated colours.
 *
 * An observed accent is never moved. It is a colour that exists in the brand, and nudging it away
 * from a status hue Cambium chose would be the tool overruling the evidence.
 */
function accentAnchor(
	keyColors: readonly KeyColor[],
	brand: Oklch,
	params: InterpretationParams,
	statusHues: readonly number[],
): Oklch {
	const observed = pickKeyColor(keyColors, 'accent');

	if (observed) return toOklch(observed.oklch);

	const preferred = normalizeHue(brand.h + params.accentRotation);

	return { ...brand, h: clearOfReservedHues(preferred, [brand.h, ...statusHues]) };
}

function neutralAnchor(seed: BrandSeed, brand: Oklch, params: InterpretationParams) {
	const stated = seed.neutralTemperature;

	return (scheme: SchemeName): Oklch => ({
		l: NEUTRAL_ANCHOR_LIGHTNESS[scheme],
		// A neutral carries a trace of the brand rather than none at all, which is what stops a warm
		// brand sitting on a page of dead grey.
		c: stated ? stated.chroma : brand.c * params.neutralTinting * NEUTRAL_CHROMA_CEILING,
		h: stated ? stated.hue : brand.h,
	});
}

function statusAnchor(
	name: keyof typeof STATUS_ANCHORS,
	brand: Oklch,
	params: InterpretationParams,
) {
	const canonical = STATUS_ANCHORS[name];

	return { ...canonical, h: rotateToward(canonical.h, brand.h, params.harmonization) };
}

function anchorsFor(seed: BrandSeed, brand: Oklch, params: InterpretationParams) {
	const keyColors = seed.keyColors ?? [];
	const neutral = neutralAnchor(seed, brand, params);
	const status = {
		danger: statusAnchor('danger', brand, params),
		warning: statusAnchor('warning', brand, params),
		success: statusAnchor('success', brand, params),
		info: statusAnchor('info', brand, params),
	};
	const fixed: Record<Exclude<RampName, 'neutral'>, Oklch> = {
		brand,
		accent: accentAnchor(
			keyColors,
			brand,
			params,
			Object.values(status).map((anchor) => anchor.h),
		),
		...status,
	};

	// Every ramp but neutral holds one anchor across both schemes, which is what keeps a brand the
	// same colour in dark mode. Radix does the same for all thirty-one of its chromatic scales and
	// lets only its greys move.
	return (scheme: SchemeName): Record<RampName, Oklch> => ({ ...fixed, neutral: neutral(scheme) });
}

function buildSchemes(
	seed: BrandSeed,
	brand: Oklch,
	params: InterpretationParams,
): { ok: true; schemes: Record<SchemeName, RampSet> } | { ok: false; error: ScaleEngineError } {
	const anchorsIn = anchorsFor(seed, brand, params);
	const schemes = {} as Record<SchemeName, RampSet>;

	for (const scheme of SCHEME_NAMES) {
		const anchors = anchorsIn(scheme);
		const ramps = {} as RampSet;

		for (const name of RAMP_NAMES) {
			const built = buildRamp(anchors[name], scheme, params.chromaSpread);

			if (!built.ok) {
				return { ok: false, error: { kind: 'unreachable-floor', ramp: name, step: built.step } };
			}

			ramps[name] = built.ramp;
		}

		schemes[scheme] = ramps;
	}

	return { ok: true, schemes };
}

function anchorReport(requested: Oklch, achieved: RampStep): BrandAnchor {
	const deviation = oklchDistance(requested, achieved);

	return {
		requested: toTriple(requested),
		achieved: [achieved.l, achieved.c, achieved.h],
		deviation: Math.round(deviation * 1e6) / 1e6,
		withinTolerance: deviation <= ANCHOR_TOLERANCE,
	};
}

/**
 * Deterministic arithmetic over culori, and nothing else. No clock, no network, no DOM, no random
 * source, which is what `core/purity.test.ts` guards and what the headless CLI in #5 depends on.
 */
export function createOklchScaleEngine(): ScaleEngine {
	return {
		id: OKLCH_SCALE_ENGINE_ID,

		generate(seed: BrandSeed, params: InterpretationParams): ScaleEngineResult {
			const keyColors = seed.keyColors ?? [];
			// A seed with no colour at all has no brand to build from, and inventing one would make
			// the output a palette Cambium chose rather than an interpretation of the image.
			const source = pickKeyColor(keyColors, 'brand') ?? keyColors[0];

			if (!source) return { ok: false, error: { kind: 'no-key-colors' } };

			const requested = toOklch(source.oklch);
			const built = buildSchemes(seed, requested, params);

			if (!built.ok) return built;

			return {
				ok: true,
				schemes: built.schemes,
				anchor: anchorReport(requested, built.schemes.light.brand[BRAND_STEP - 1]!),
			};
		},
	};
}
