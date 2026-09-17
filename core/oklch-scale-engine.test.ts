import { describe, expect, it } from 'vitest';

import { BrandSeedSchema } from './brand-seed';
import { contrastFromOklch, hueDistance, isInSrgb } from './oklch';
import { RampSchema } from './token-set';
import {
	createOklchScaleEngine,
	MIN_ACCENT_SEPARATION,
	OKLCH_SCALE_ENGINE_ID,
} from './oklch-scale-engine';
import { BALANCED, RAMP_NAMES, SCHEME_NAMES } from './scale-engine';
import { testScaleEngineContract } from './scale-engine-contract';

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
		const measured = contrastFromOklch(ramp[10]!, ramp[1]!);

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
