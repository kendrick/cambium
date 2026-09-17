import { describe, expect, it } from 'vitest';

import { BrandSeedSchema } from './brand-seed';
import { contrastFromOklch } from './oklch';
import { createOklchScaleEngine, OKLCH_SCALE_ENGINE_ID } from './oklch-scale-engine';
import { BALANCED } from './scale-engine';
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
