import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema, type OklchTriple } from './brand-seed';
import { withContrastRepairs } from './contrast/repair';
import { BALANCED, EXPRESSIVE, FAITHFUL, type InterpretationParams } from './interpretation';
import { type Oklch, oklchDistance } from './oklch';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { ANCHOR_TOLERANCE } from './scale-engine';
import { buildTokenSet } from './semantic-layer';

/**
 * `core/scale-engine-contract.ts` states no `SEEDS` or `generate` outside the closure that runs the
 * shared engine suite, by wave rule: lane E (#99) owns that file for the duration, and this lane's
 * job is the two constants, not a change to the seam they get judged against. The four hues below
 * are the same ones that file measures against, copied rather than imported, so a figure here stays
 * comparable to what that suite reports without this file reaching into it.
 */
const SEEDS: ReadonlyArray<readonly [string, OklchTriple]> = [
	['blue at 259.8', [0.6231, 0.188, 259.8]],
	['yellow at 86.0', [0.7952, 0.1617, 86.0]],
	['crimson at 17.6', [0.5858, 0.222, 17.6]],
	['green at 162.5', [0.6959, 0.1491, 162.5]],
];

/** One brand key color and nothing else stated, the hardest honest input to interpret. */
function seedWith(brand: OklchTriple, overrides: Partial<BrandSeed> = {}): BrandSeed {
	return BrandSeedSchema.parse({
		keyColors: [
			{ oklch: brand, proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null },
		],
		neutralTemperature: null,
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
}

function generate(seed: BrandSeed, params: InterpretationParams) {
	const result = createOklchScaleEngine().generate(seed, params);

	if (!result.ok) throw new Error(`generation failed: ${result.error.kind}`);

	return result;
}

describe('the three presets', () => {
	it('are pairwise distinct objects', () => {
		expect(BALANCED).not.toEqual(FAITHFUL);
		expect(BALANCED).not.toEqual(EXPRESSIVE);
		expect(FAITHFUL).not.toEqual(EXPRESSIVE);
	});

	it.each(SEEDS)('produce three different token sets from one seed, %s', (_label, brand) => {
		const seed = seedWith(brand);
		const balanced = JSON.stringify(generate(seed, BALANCED).schemes);
		const faithful = JSON.stringify(generate(seed, FAITHFUL).schemes);
		const expressive = JSON.stringify(generate(seed, EXPRESSIVE).schemes);

		expect(balanced).not.toBe(faithful);
		expect(balanced).not.toBe(expressive);
		expect(faithful).not.toBe(expressive);
	});
});

describe('faithful reproduces the seed key color', () => {
	it.each(SEEDS)('keeps step 9 within ANCHOR_TOLERANCE in both schemes for %s', (_label, brand) => {
		const result = generate(seedWith(brand), FAITHFUL);
		const target: Oklch = { l: brand[0], c: brand[1], h: brand[2] };
		const light = result.schemes.light.brand[8]!;
		const dark = result.schemes.dark.brand[8]!;

		expect(oklchDistance(light, target)).toBeLessThanOrEqual(ANCHOR_TOLERANCE);
		expect(oklchDistance(dark, target)).toBeLessThanOrEqual(ANCHOR_TOLERANCE);
		// The engine's own account of the same measurement, checked against what was just measured
		// independently rather than trusted on its own — an engine that reported success while
		// missing the tolerance would fail on this disagreement.
		expect(result.anchor.withinTolerance).toBe(true);
		expect(result.anchor.deviation).toBeLessThanOrEqual(ANCHOR_TOLERANCE);
	});
});

describe('expressive widens neutral chroma over faithful', () => {
	it.each(SEEDS)(
		'exceeds faithful at step 9 where the seed states no neutral temperature, %s',
		(_label, brand) => {
			const seed = seedWith(brand);
			const faithful = generate(seed, FAITHFUL);
			const expressive = generate(seed, EXPRESSIVE);

			expect(expressive.schemes.light.neutral[8]!.c).toBeGreaterThan(
				faithful.schemes.light.neutral[8]!.c,
			);
			expect(expressive.schemes.dark.neutral[8]!.c).toBeGreaterThan(
				faithful.schemes.dark.neutral[8]!.c,
			);
		},
	);

	// `neutralAnchor` in `core/oklch-scale-engine.ts` has a stated `neutralTemperature` set the tint
	// outright rather than scale it: "the seed observed that temperature in the image, and a preset
	// knob has no business overruling evidence." So where the seed states one, `neutralTinting`
	// never reaches the chroma at all, and Faithful and Expressive land on the same value by
	// construction rather than by coincidence — asserting equality here is asserting that
	// invariant, not merely a fact this pair of presets happens to share.
	it.each(SEEDS)(
		'matches faithful at step 9 where the seed states a neutral temperature, %s',
		(_label, brand) => {
			const seed = seedWith(brand, { neutralTemperature: { hue: 40, chroma: 0.02 } });
			const faithful = generate(seed, FAITHFUL);
			const expressive = generate(seed, EXPRESSIVE);

			expect(expressive.schemes.light.neutral[8]!.c).toBe(faithful.schemes.light.neutral[8]!.c);
			expect(expressive.schemes.dark.neutral[8]!.c).toBe(faithful.schemes.dark.neutral[8]!.c);
		},
	);
});

describe('every preset clears AA after repair', () => {
	const PRESETS: ReadonlyArray<readonly [string, InterpretationParams]> = [
		['balanced', BALANCED],
		['faithful', FAITHFUL],
		['expressive', EXPRESSIVE],
	];

	// Flattened rather than nested, so a failure names the exact preset/seed pair rather than
	// forcing a reader back into a loop body to work out which iteration failed.
	const cases = PRESETS.flatMap(([presetName, params]) =>
		SEEDS.map(([seedLabel, brand]) => [presetName, params, seedLabel, brand] as const),
	);

	it.each(cases)(
		'leaves nothing unrepaired for %s under %s',
		(_presetName, params, _seedLabel, brand) => {
			const seed = seedWith(brand);
			const result = generate(seed, params);
			const base = buildTokenSet(result.schemes, seed, params);
			const { unrepaired } = withContrastRepairs(base);

			expect(unrepaired).toEqual([]);
		},
	);
});
