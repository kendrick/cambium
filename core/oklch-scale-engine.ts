import type { BrandSeed, KeyColor, OklchTriple } from './brand-seed';
import {
	contrastFromOklch,
	fitToSrgbGamut,
	hueDistance,
	type Oklch,
	oklchDistance,
	quantizeToSrgb,
	renderedContrast,
	solveLightnessForContrast,
} from './oklch';
import { derived, invented, observed, type SeedField } from './provenance';
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
import { BRAND_STEP, STEP_ROLES, type StepRole } from './step-roles';
import type { Ramp, RampStep, TokenExtensions } from './token-set';

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

/**
 * Step 10 is step 9 nudged one notch further from the page, which is what a hover state is. The
 * sizes are the median gap between Radix's own steps 9 and 10, measured per scheme: its light
 * scales close by 0.027 and its dark ones open by 0.039.
 */
const STEP_10_OFFSET = { light: -0.027, dark: 0.039 } as const;

/**
 * Where the hover state sits, given where the brand already is.
 *
 * A brand at the end of the lightness range has nowhere further from the page to go. A black brand
 * cannot hover blacker, so it hovers lighter, which is what every real design system does with a
 * black button. Without the flip the offset walks lightness out of 0 through 1 and the ramp stops
 * parsing, and a black brand is an ordinary thing for a brand to be.
 */
function hoverLightness(anchorLightness: number, scheme: SchemeName): number {
	const away = anchorLightness + STEP_10_OFFSET[scheme];

	if (away >= 0 && away <= 1) return away;

	return anchorLightness - STEP_10_OFFSET[scheme];
}

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
 * The margin absorbs six-decimal rounding, and that is the whole of what it is for. A step solved
 * to exactly the floor can round back under it in the last decimal, and 0.0005 covers that. It does
 * not cover the byte grid. A colour reaches a screen as three 8-bit channels, and rounding into
 * those moves contrast by roughly fifty times as much. #72 found five ramp steps clearing the floor
 * in OKLCH and missing it as bytes, the worst by 0.0131, which is 5.8 margins.
 *
 * `meetRenderedFloor` below is what covers it. That function solves, quantizes, measures the pair a
 * browser would paint, and raises the exact-space target until the bytes clear. Two alternatives
 * keep getting re-proposed and #72 rejected both.
 *
 * Widening the margin was the first. It is the mistake already made once: 1.0005 was sized against
 * six-decimal rounding and then trusted against a quantizer nobody had measured it for, and picking
 * a bigger number from a bigger sample repeats the move. A margin sized from a sample cannot make
 * the rule true, only unlikely to be false, so it leaves no invariant to write down. It also moves
 * all 448 floor-carrying steps to fix 5.
 *
 * Leaving each export adapter to re-verify was the second. An adapter that catches the miss has no
 * move: changing the colour diverges from the token set it was handed, so it either ships the
 * violation or rejects a set the engine called valid. The obligation would also have to be
 * re-derived in every adapter, and silently skipped by any one of them.
 *
 * This is not #8. That one checks declared semantic pairs and emits a repair report rather than a
 * mutation; the steps failing here are primitive ramp steps, which its scope never reaches. #8
 * measures at full precision too, so solving it here is what makes #8's input honest.
 *
 * What the cushion still protects is `meetFloor`'s own guarantee, stated in exact space, and no
 * caller currently leans on it: `meetRenderedFloor` rounds to six decimals before it measures a
 * byte, so its check already contains whatever the cushion catches. #72's mutation run measured
 * exactly that — set this to 1 and the whole suite stays green. Removing it would be tuning against
 * a passing suite, so it stays, but nobody should read it as load-bearing.
 */
const FLOOR_MARGIN = 1.0005;

/**
 * How far `meetRenderedFloor` raises its target on a first miss, before the doubling takes over.
 *
 * The same number as `FLOOR_MARGIN` and deliberately not the same constant. One cushions
 * six-decimal rounding inside a single solve, the other seeds a ladder across the byte grid, and
 * wiring them together means setting the cushion to 1 flattens the ladder and takes 128 tests with
 * it.
 *
 * Small on purpose. Most misses clear on the first escalation, and a larger opening step would walk
 * every one of them further from where the curve put them than it has to go.
 */
const RENDERED_LADDER_STEP = 1.0005;

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

/** The form every step is stored and serialized in, which is what a floor has to hold for. */
function toStoredPrecision(color: Oklch): Oklch {
	return quantizeToSrgb(color);
}

/**
 * A step that clears its floor against step 2 once both are 8-bit sRGB, which is the only place the
 * floor means anything. Returns the stored six-decimal colour rather than the exact-space solve,
 * because the stored value is the one that gets serialized and so the one the floor has to hold for.
 *
 * Same shape as `meetFloor` one layer out. `meetFloor` converges a solve against gamut mapping.
 * This function converges the same solve against the byte grid, by raising the exact-space floor
 * and re-solving until the stored pair clears as bytes.
 *
 * Each round escalates off the contrast the last solve actually reached, never off the floor it was
 * asked for. Those two differ whenever the curve already placed the step clear of its floor, which
 * is the common case. Ask again for a number the colour already beats and the solve hands back the
 * same colour, so the loop stands still while `required` climbs behind it. Escalating off the
 * achieved figure is what makes each round move the colour.
 *
 * The overshoot doubles each round, because contrast over the byte grid is a step function and the
 * plateaus are not one size. Most misses clear on the first escalation, on a lightness move of
 * 0.0002, which is where light/success 11 goes from 4.4997 to 4.5533. A cyan brand at hue 180 sits
 * on a plateau nine times wider, and a fixed step fine enough to keep the first case tight crawls
 * across the second. Doubling holds the common case to the smallest move that works and still
 * reaches the far plateaus in a handful of rounds.
 *
 * Eight rounds is the budget, which is a backstop rather than a number real input reaches. The
 * ladder was swept across 360 hues, nine anchors including pure black and pure white, both schemes
 * and all eight floor-carrying steps: 51,840 cases, every one solved, none past 5 rounds, worst
 * lightness shift 0.005. That sweep is too slow for every commit, so
 * `core/oklch-scale-engine.test.ts` runs a coarser one that fails the same way if this stops
 * converging.
 *
 * Exhausting the ladder returns null, which surfaces as `unreachable-floor` and a readable refusal
 * in `scripts/lib/cli.mjs`. Nothing in the sweep reached it, and shipping a byte under a floor the
 * token set declares is worse than refusing the seed.
 */
function meetRenderedFloor(
	color: Oklch,
	background: Oklch,
	floor: number,
	direction: -1 | 1,
): Oklch | null {
	let required = floor;
	let overshoot = RENDERED_LADDER_STEP;

	for (let attempt = 0; attempt < 8; attempt += 1) {
		const solved = meetFloor(color, background, required, direction);

		if (!solved) return null;

		const stored = toStoredPrecision(solved);

		if (renderedContrast(stored, background) >= floor) return stored;

		required = Math.max(required, contrastFromOklch(stored, background)) * overshoot;
		overshoot = 1 + (overshoot - 1) * 2;
	}

	return null;
}

/**
 * The provenance payload for one step, given its role in the table.
 *
 * Classification is a whole-ramp decision — what the seed said, or failed to say, about the colour
 * the ramp is built on — and only the wording moves per step. So a ramp is handed one of these and
 * applies it twelve times, rather than each step deciding for itself and risking twelve answers.
 */
type StepProvenance = (role: StepRole) => TokenExtensions;

/**
 * Step 9's entry in `STEP_ROLES` reads "solid fill, the brand colour itself", which is true of the
 * brand ramp and false of the other six. A rationale is read beside its own token, so the accent
 * ramp describes its own step 9 instead of borrowing the brand's description of one.
 */
function roleText(role: StepRole, ramp: RampName): string {
	return role.step === BRAND_STEP && ramp !== 'brand' ? 'solid fill' : role.role;
}

/**
 * A ramp anchored on a colour the seed actually placed. Step 9 is that colour and nothing else,
 * which is the one thing in a token set a consumer can point at the reference image for; the other
 * eleven are the curve applied to it.
 */
function placedKeyColor(ramp: 'brand' | 'accent'): StepProvenance {
	return (role) =>
		role.step === BRAND_STEP
			? observed(
					'keyColors',
					`Step 9 is the ${ramp} key colour the seed placed, carried through only sRGB gamut mapping`,
				)
			: derived(
					'keyColors',
					`Step ${role.step}, the ${roleText(role, ramp)}, curved from the ${ramp} key colour's hue and chroma`,
				);
}

function derivedRamp(ramp: RampName, seedField: SeedField, reason: string): StepProvenance {
	return (role) => derived(seedField, `Step ${role.step}, the ${roleText(role, ramp)}, ${reason}`);
}

function inventedRamp(ramp: RampName, reason: string): StepProvenance {
	return (role) => invented(`Step ${role.step}, the ${roleText(role, ramp)}, ${reason}`);
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
 * Quantizing last keeps the rounding out of the arithmetic that fed it, which on its own leaves
 * nothing downstream checking what the rounding did. So step 2 is quantized once up front and every
 * floor is settled against that stored pair, and the value the solve aims at is the value a browser
 * paints.
 */
function buildRamp(
	anchor: Oklch,
	scheme: SchemeName,
	spread: number,
	provenance: StepProvenance,
): { ok: true; ramp: Ramp } | { ok: false; step: number } {
	const lightness = LIGHTNESS[scheme];
	const fractions = CHROMA_FRACTION[scheme];
	const direction = DIRECTION[scheme];

	const placed = STEP_ROLES.map((role, index) => {
		const chroma = anchor.c * fractions[index]! * spread;

		if (role.step === BRAND_STEP) return fitToSrgbGamut(anchor);
		if (role.anchoredToSeed) {
			return fitToSrgbGamut({ l: hoverLightness(anchor.l, scheme), c: chroma, h: anchor.h });
		}

		return fitToSrgbGamut({ l: lightness[index]!, c: chroma, h: anchor.h });
	});

	const background = toStoredPrecision(placed[1]!);
	const steps: RampStep[] = [];

	for (const [index, color] of placed.entries()) {
		const role = STEP_ROLES[index]!;
		const solved =
			role.minWcagVsStep2 === null
				? toStoredPrecision(color)
				: meetRenderedFloor(color, background, role.minWcagVsStep2, direction);

		if (!solved) return { ok: false, step: role.step };

		steps.push({
			step: role.step,
			l: solved.l,
			c: solved.c,
			h: solved.h,
			$extensions: provenance(role),
		});
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
export const MIN_ACCENT_SEPARATION = 25;

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
	accentKey: KeyColor | undefined,
	brand: Oklch,
	params: InterpretationParams,
	statusHues: readonly number[],
): Oklch {
	if (accentKey) return toOklch(accentKey.oklch);

	const preferred = normalizeHue(brand.h + params.accentRotation);

	return { ...brand, h: clearOfReservedHues(preferred, [brand.h, ...statusHues]) };
}

function neutralAnchor(seed: BrandSeed, brand: Oklch, params: InterpretationParams) {
	const stated = seed.neutralTemperature;

	return (scheme: SchemeName): Oklch => ({
		l: NEUTRAL_ANCHOR_LIGHTNESS[scheme],
		// A neutral carries a trace of the brand rather than none at all, which is what stops a warm
		// brand sitting on a page of dead grey. A stated temperature overrides the tinting parameter
		// outright rather than scaling it: the seed observed that temperature in the image, and a
		// preset knob has no business overruling evidence.
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

function anchorsFor(
	seed: BrandSeed,
	brand: Oklch,
	params: InterpretationParams,
	accentKey: KeyColor | undefined,
) {
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
			accentKey,
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

/**
 * What informed each ramp, read off the seed and the parameters rather than off the ramp's name.
 *
 * The name is the wrong key for six of the seven. Accent is either a colour the seed placed or a
 * hue rotated off the brand, neutral is either a stated temperature or a tint taken from the brand,
 * and the status four are canonical hues until `harmonization` pulls them toward the brand. So a
 * table keyed on the name alone is frozen to whichever seed it was written against, and the one it
 * would be written against is the fixture — leaving the keyless read `createLocalBrandReader`
 * produces claiming evidence that never reached the value.
 *
 * A token names the field its value traces to, which is not the same as the field that was absent.
 * `accentAnchor` copies the brand key colour's lightness and chroma outright and rotates only its
 * hue, and `neutralAnchor` with no stated temperature takes its chroma and its hue from the brand
 * too. Both move when `keyColors` moves, so both are derived from `keyColors` rather than invented:
 * calling them invented would tell a consumer no seed field reached the value, which is false, and
 * `keyColors` is the one field a keyless read does populate. Marking them invented misreports the
 * keyless gap rather than showing it.
 *
 * The status four are the contrast and the reason a rule keyed on absence is wrong. They carry
 * their own canonical anchors and borrow the brand hue only when `harmonization` is above zero, so
 * they alone fall back to something no seed informs.
 *
 * Neutral has no observed step even with a temperature stated, because step 9's lightness comes
 * from `NEUTRAL_ANCHOR_LIGHTNESS`: the seed named a tint, not a colour, so nothing in the ramp is a
 * value it placed.
 */
function rampProvenance(
	seed: BrandSeed,
	params: InterpretationParams,
	accentKey: KeyColor | undefined,
): Record<RampName, StepProvenance> {
	const statusProvenance = (name: RampName): StepProvenance =>
		params.harmonization > 0
			? derivedRamp(
					name,
					'keyColors',
					`built on the canonical ${name} hue rotated toward the brand key colour`,
				)
			: inventedRamp(
					name,
					`built on the canonical ${name} hue, which no field of the seed informs`,
				);

	return {
		brand: placedKeyColor('brand'),
		accent: accentKey
			? placedKeyColor('accent')
			: derivedRamp(
					'accent',
					'keyColors',
					"taking the brand key colour's lightness and chroma at a rotated hue, the seed having proposed no accent",
				),
		neutral: seed.neutralTemperature
			? derivedRamp(
					'neutral',
					'neutralTemperature',
					'tinted by the neutral temperature the seed stated',
				)
			: derivedRamp(
					'neutral',
					'keyColors',
					'tinted from the brand key colour, the seed having stated no neutral temperature',
				),
		danger: statusProvenance('danger'),
		warning: statusProvenance('warning'),
		success: statusProvenance('success'),
		info: statusProvenance('info'),
	};
}

function buildSchemes(
	seed: BrandSeed,
	brand: Oklch,
	params: InterpretationParams,
): { ok: true; schemes: Record<SchemeName, RampSet> } | { ok: false; error: ScaleEngineError } {
	// One read of the seed decides both the anchor and the provenance that describes it. The accent
	// is invented exactly when no key colour named one, and answering that question in two places is
	// how a ramp comes to claim a seed field its anchor never used.
	const accentKey = pickKeyColor(seed.keyColors ?? [], 'accent');
	const anchorsIn = anchorsFor(seed, brand, params, accentKey);
	const provenance = rampProvenance(seed, params, accentKey);
	const schemes = {} as Record<SchemeName, RampSet>;

	for (const scheme of SCHEME_NAMES) {
		const anchors = anchorsIn(scheme);
		const ramps = {} as RampSet;

		for (const name of RAMP_NAMES) {
			const built = buildRamp(anchors[name], scheme, params.chromaSpread, provenance[name]);

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
