import { describe, expect, it } from 'vitest';

import { BrandSeedSchema } from './brand-seed';
import { hueDistance, isInSrgb } from './oklch';
import { CAMBIUM_NAMESPACE } from './provenance';
import { type Ramp, RampSchema, type RampStep } from './token-set';
import {
	createOklchScaleEngine,
	MIN_ACCENT_SEPARATION,
	OKLCH_SCALE_ENGINE_ID,
} from './oklch-scale-engine';
import { RAMP_NAMES, type RampName, SCHEME_NAMES } from './scale-engine';
import { BALANCED } from './interpretation';
import { STEP_ROLES } from './step-roles';
import { paintedContrast, testScaleEngineContract } from './scale-engine-contract';

describe('createOklchScaleEngine', () => {
	testScaleEngineContract(() => createOklchScaleEngine());
});

/**
 * What the shared contract cannot say. It is written to hold for any engine, so it never names a
 * curve value, a canonical status hue, or the engine's own identifier. Those are this engine's
 * choices, and a change to one of them should fail here rather than pass silently because the
 * contract was too polite to ask.
 */
const seed = (overrides = {}) =>
	BrandSeedSchema.parse({
		keyColors: [
			{
				oklch: [0.6231, 0.188, 259.8],
				proposedRole: 'brand',
				sourceImageId: 'img-1',
				sourceRegion: null,
			},
		],
		neutralTemperature: null,
		surfacePolarity: null,
		radiusCharacter: null,
		shadowCharacter: null,
		trackingFeel: null,
		typeClassification: null,
		suggestedPairing: null,
		typeScaleRatio: null,
		imageClassifications: null,
		expressive: null,
		...overrides,
	});

const generate = (overrides = {}, params = BALANCED) => {
	const result = createOklchScaleEngine().generate(seed(overrides), params);

	if (!result.ok) throw new Error(result.error.kind);

	return result;
};

describe('createOklchScaleEngine specifics', () => {
	it('carries the identifier every stored version records as its scale engine', () => {
		expect(createOklchScaleEngine().id).toBe(OKLCH_SCALE_ENGINE_ID);
		expect(OKLCH_SCALE_ENGINE_ID).toBe('cambium-oklch-1');
	});

	it('places the canonical status hues rather than hues near the brand', () => {
		const { schemes } = generate();

		expect(schemes.light.danger[8]!.h).toBeCloseTo(23, 0);
		expect(schemes.light.warning[8]!.h).toBeCloseTo(84.1, 0);
		expect(schemes.light.success[8]!.h).toBeCloseTo(157.7, 0);
		expect(schemes.light.info[8]!.h).toBeCloseTo(251.8, 0);
	});

	// Harmonisation is the knob #37 turns for the Expressive preset. Nothing exercises it yet, so
	// without this the parameter could stop working and every Balanced test would stay green.
	it('rotates status hues toward the brand as harmonisation rises', () => {
		const neutral = generate({}, { ...BALANCED, harmonization: 0 });
		const pulled = generate({}, { ...BALANCED, harmonization: 0.5 });

		expect(pulled.schemes.light.danger[8]!.h).not.toBeCloseTo(
			neutral.schemes.light.danger[8]!.h,
			1,
		);
		expect(pulled.schemes.light.danger[8]!.h).toBeGreaterThan(neutral.schemes.light.danger[8]!.h);
	});

	// The curve alone lands a saturated green just under 4.5 at step 11, which is why the solve
	// exists. A regression that dropped it would still leave the ramp looking plausible.
	it('solves step 11 onto the floor rather than leaving it where the curve put it', () => {
		const green = createOklchScaleEngine().generate(
			seed({
				keyColors: [
					{
						oklch: [0.6959, 0.1491, 162.5],
						proposedRole: 'brand',
						sourceImageId: 'img-1',
						sourceRegion: null,
					},
				],
			}),
			BALANCED,
		);

		expect(green.ok).toBe(true);
		if (!green.ok) return;

		const ramp = green.schemes.light.brand;
		const measured = paintedContrast(ramp[10]!, ramp[1]!);

		// Only the floor is asserted. Pinning how close the solver lands would fail a legitimate
		// retune of the curve, which is the kind of test `docs/agents/testing.md` warns against.
		expect(measured).toBeGreaterThanOrEqual(4.5);
	});

	it('scales every chroma with the seed rather than holding an absolute curve', () => {
		const vivid = generate();
		const muted = generate({
			keyColors: [
				{
					oklch: [0.6231, 0.04, 259.8],
					proposedRole: 'brand',
					sourceImageId: 'img-1',
					sourceRegion: null,
				},
			],
		});

		expect(muted.schemes.light.brand[7]!.c).toBeLessThan(vivid.schemes.light.brand[7]!.c);
	});
});

/**
 * A sweep, because four fixture seeds are not a sample.
 *
 * The contract runs the four hues the research prototype was measured against, and every one of
 * them sat clear of the two bands where this engine actually broke. A saturated blue near
 * lightness 0.4 escaped the sRGB gamut at step 10, and roughly a quarter of all hues put the
 * derived accent inside the separation the engine claims to keep. Both held every fixture.
 *
 * Coarse on purpose. This runs on every `pnpm test`, so it sweeps hues at five degrees rather than
 * one, which is still four hundred times the coverage the fixtures give.
 */
const keyColorAt = (l: number, c: number, h: number) => [
	{ oklch: [l, c, h], proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null },
];

describe('createOklchScaleEngine across the hue circle', () => {
	// The last two are the ends of the range, and they are here because leaving them out is how the
	// step 10 offset walked lightness out of bounds unnoticed. A brand can legitimately be black.
	const PROBES = [
		[0.5, 0.15],
		[0.62, 0.19],
		[0.75, 0.14],
		[0.4, 0.25],
		[0.02, 0.1],
		[0.98, 0.05],
	] as const;

	const sweep = () => {
		const results = [];

		for (let hue = 0; hue < 360; hue += 5) {
			for (const [l, c] of PROBES) {
				results.push({ hue, l, c, generated: generate({ keyColors: keyColorAt(l, c, hue) }) });
			}
		}

		return results;
	};

	it('keeps every step of every ramp inside sRGB', () => {
		const escaped = sweep().flatMap(({ hue, l, c, generated }) =>
			SCHEME_NAMES.flatMap((scheme) =>
				RAMP_NAMES.flatMap((name) =>
					generated.schemes[scheme][name]
						.filter((step) => !isInSrgb(step))
						.map((step) => `seed ${l}/${c}/${hue} ${scheme} ${name} step ${step.step}`),
				),
			),
		);

		expect(escaped).toEqual([]);
	});

	// The sweep above steps five degrees at a time and walks straight over this one. The band where
	// the engine escaped the gamut was about three degrees wide, which is a reminder that a sweep
	// coarse enough to run on every commit is not a proof.
	it('keeps a saturated blue near lightness 0.4 inside the gamut', () => {
		const { schemes } = generate({ keyColors: keyColorAt(0.4, 0.25, 261.5) });

		const escaped = SCHEME_NAMES.flatMap((scheme) =>
			RAMP_NAMES.flatMap((name) =>
				schemes[scheme][name]
					.filter((step) => !isInSrgb(step))
					.map((step) => `${scheme} ${name} step ${step.step}`),
			),
		);

		expect(escaped).toEqual([]);
	});

	// A brand at the very end of the lightness range has nowhere further from the page to put its
	// hover state. Getting this wrong produced a ramp with a negative lightness that the engine
	// still reported as a success, so both halves are asserted: the schema and the gamut.
	it.each([
		['pure black', [0, 0, 0]],
		['pure white', [1, 0, 0]],
	] as const)('produces a valid ramp for a %s brand', (_label, brand) => {
		const { schemes } = generate({ keyColors: keyColorAt(brand[0], brand[1], brand[2]) });

		for (const scheme of SCHEME_NAMES) {
			for (const name of RAMP_NAMES) {
				const ramp = schemes[scheme][name];
				const parsed = RampSchema.safeParse(ramp);

				expect(parsed.success, `${scheme} ${name}: ${parsed.error?.message}`).toBe(true);
				expect(ramp.filter((step) => !isInSrgb(step))).toEqual([]);
			}
		}
	});

	// The contract asserts this on four seeds. Four seeds are not the circle, and the byte grid is
	// what makes the difference: its plateaus move with hue, so the steps that miss are nowhere near
	// the hues anyone picked by hand. #72 shipped because the only check ran in the producer's units;
	// running the consumer's units on four hues would have been the next way to miss it.
	it('clears every declared floor in rendered 8-bit sRGB across the circle', () => {
		const missed = sweep().flatMap(({ hue, l, c, generated }) =>
			SCHEME_NAMES.flatMap((scheme) =>
				RAMP_NAMES.flatMap((name) => {
					const ramp = generated.schemes[scheme][name];

					return STEP_ROLES.filter((role) => role.minWcagVsStep2 !== null)
						.map((role) => ({
							role,
							measured: paintedContrast(ramp[role.step - 1]!, ramp[1]!),
						}))
						.filter(({ role, measured }) => measured < role.minWcagVsStep2!)
						.map(
							({ role, measured }) =>
								`seed ${l}/${c}/${hue} ${scheme} ${name} step ${role.step}: ${measured.toFixed(4)} under ${role.minWcagVsStep2}`,
						);
				}),
			),
		);

		expect(missed).toEqual([]);
	});

	it('keeps every derived accent clear of every status hue', () => {
		const crowded = sweep().flatMap(({ hue, l, c, generated }) => {
			const light = generated.schemes.light;
			const accent = light.accent[8]!.h;

			return (['danger', 'warning', 'success', 'info'] as const)
				.map((name) => ({ name, gap: hueDistance(accent, light[name][8]!.h) }))
				.filter(({ gap }) => gap < MIN_ACCENT_SEPARATION)
				.map(({ name, gap }) => `seed ${l}/${c}/${hue}: ${gap.toFixed(1)} from ${name}`);
		});

		expect(crowded).toEqual([]);
	});
});

const payload = (step: RampStep) => step.$extensions[CAMBIUM_NAMESPACE];

/** `provenance:seedField` per step, so a payload landing on the wrong step fails on position. */
const trace = (ramp: Ramp) =>
	ramp.map((step) => `${payload(step).provenance}:${payload(step).seedField}`);

const everyStep = (label: string) => Array.from({ length: 12 }, () => label);

const anchoredTrace = everyStep('derived:keyColors').map((label, index) =>
	index === 8 ? 'observed:keyColors' : label,
);

const STATUS_RAMPS = ['danger', 'warning', 'success', 'info'] as const;

const ACCENT_IN_SEED = {
	keyColors: [
		{
			oklch: [0.6231, 0.188, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
		{ oklch: [0.62, 0.19, 30], proposedRole: 'accent', sourceImageId: 'img-1', sourceRegion: null },
	],
};

/**
 * Provenance per ramp, because the classification is not a property of the ramp's name.
 *
 * Six of the seven ramps swing between classifications on what the seed stated, and the fixture
 * seed above states one key colour and nothing else. So every ramp that swings is run from both
 * sides here: the seed that informs it and the seed that leaves it to the engine. Run from one side
 * only, a rule keyed on the ramp's name passes and ships a keyless read whose invented colours
 * claim a seed field.
 */
describe('createOklchScaleEngine provenance', () => {
	// Both schemes, every time. Dark is generated on its own pass through the same builder, so a
	// payload threaded into one and dropped from the other is a live failure mode rather than a
	// theoretical one.
	const tracesOf = (name: RampName, overrides = {}, params = BALANCED) =>
		SCHEME_NAMES.map((scheme) => trace(generate(overrides, params).schemes[scheme][name]));

	it('observes the brand key colour at step 9 and derives the other eleven from it', () => {
		expect(tracesOf('brand')).toEqual([anchoredTrace, anchoredTrace]);
	});

	it('observes an accent the seed placed, exactly as it does the brand colour', () => {
		expect(tracesOf('accent', ACCENT_IN_SEED)).toEqual([anchoredTrace, anchoredTrace]);
	});

	// A rotated accent copies the brand key colour's lightness and chroma outright and moves only
	// its hue, so the whole ramp swings when `keyColors` swings. The absent field is `keyColors`
	// naming no accent; the field the value traces to is `keyColors` all the same. This is the
	// common case, because a keyless read proposes a brand colour and nothing else.
	it('derives a rotated accent from the brand key colour it was rotated off', () => {
		const derived = everyStep('derived:keyColors');

		expect(tracesOf('accent')).toEqual([derived, derived]);
	});

	// Derived across all twelve, never observed. The stated temperature sets hue and chroma; step
	// 9's lightness still comes from the engine's own anchor, so no step is a colour the seed placed.
	it('derives every neutral step from a stated temperature without observing one', () => {
		const derived = everyStep('derived:neutralTemperature');

		expect(tracesOf('neutral', { neutralTemperature: { hue: 40, chroma: 0.02 } })).toEqual([
			derived,
			derived,
		]);
	});

	// `neutralAnchor` with no stated temperature takes both its chroma and its hue from the brand,
	// so the ramp moves with `keyColors`. It holds even at `neutralTinting` 0, where chroma lands at
	// 0 and the brand hue is still what the step stores.
	it.each([
		['under Balanced', BALANCED],
		['with no tinting at all', { ...BALANCED, neutralTinting: 0 }],
	])(
		'derives the neutral ramp from the brand key colour %s when no temperature is stated',
		(_name, params) => {
			const derived = everyStep('derived:keyColors');

			expect(tracesOf('neutral', {}, params)).toEqual([derived, derived]);
		},
	);

	// Under Balanced `harmonization` is 0 and the status hues are Cambium's constants, untouched by
	// the seed. Claiming `keyColors` there would be pointing at evidence that never reached the value.
	it.each(STATUS_RAMPS)('invents %s while harmonisation leaves its hue alone', (name) => {
		const invented = everyStep('invented:null');

		expect(tracesOf(name, {}, { ...BALANCED, harmonization: 0 })).toEqual([invented, invented]);
	});

	it.each(STATUS_RAMPS)('derives %s once harmonisation pulls its hue toward the brand', (name) => {
		const derived = everyStep('derived:keyColors');

		expect(tracesOf(name, {}, { ...BALANCED, harmonization: 0.5 })).toEqual([derived, derived]);
	});

	// The wording is per step and the classification is per ramp, which is exactly the seam an
	// off-by-one slips through: a rationale describing step 8 sitting on step 9 reads as provenance
	// and traces to the wrong value.
	it('gives every step a rationale naming the step it sits on', () => {
		const { schemes } = generate(ACCENT_IN_SEED, { ...BALANCED, harmonization: 0.5 });

		const mislabelled = SCHEME_NAMES.flatMap((scheme) =>
			RAMP_NAMES.flatMap((name) =>
				schemes[scheme][name]
					.filter((step) => !new RegExp(`^Step ${step.step}\\b`).test(payload(step).rationale))
					.map((step) => `${scheme} ${name} step ${step.step}: ${payload(step).rationale}`),
			),
		);

		expect(mislabelled).toEqual([]);
	});
});
