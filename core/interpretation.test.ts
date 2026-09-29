import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema, type OklchTriple } from './brand-seed';
import { withContrastRepairs } from './contrast/repair';
import { BALANCED, EXPRESSIVE, FAITHFUL, type InterpretationParams } from './interpretation';
import { type Oklch, oklchDistance } from './oklch';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { ANCHOR_TOLERANCE } from './scale-engine';
import { buildTokenSet } from './semantic-layer';

/**
 * The same four hues `core/scale-engine-contract.ts` measures against. That file's own `SEEDS` is
 * module-scope but unexported, so nothing outside it can import the array; copying the values here
 * keeps a figure in this file comparable to what that suite reports, without reaching into a module
 * this one has no import path to.
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
		expect(BALANCED).not.toBe(FAITHFUL);
		expect(BALANCED).not.toBe(EXPRESSIVE);
		expect(FAITHFUL).not.toBe(EXPRESSIVE);

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

describe('faithful reproduces every seed key colour', () => {
	// Step 9 of any placed ramp is `fitToSrgbGamut(anchor)` outright, in `buildRamp`
	// (`core/oklch-scale-engine.ts`), before any `InterpretationParams` field is read. That holds for
	// Balanced and Expressive exactly as it holds for Faithful, so checking only the brand colour
	// here would not be a claim that sets Faithful apart—the contract suite already covers it.
	// What this test is actually for is the seed's *accent* key colour: an observed second colour
	// the seed places independently of the brand, reproduced at its own step 9 within
	// `ANCHOR_TOLERANCE`. The value is the accent and the tolerance, not the preset.
	const ACCENT: OklchTriple = [0.65, 0.19, 50];

	it.each(SEEDS)('keeps step 9 within ANCHOR_TOLERANCE in both schemes for %s', (_label, brand) => {
		const seed = seedWith(brand, {
			keyColors: [
				{ oklch: brand, proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null },
				{ oklch: ACCENT, proposedRole: 'accent', sourceImageId: 'img-1', sourceRegion: null },
			],
		});
		const result = generate(seed, FAITHFUL);
		const brandTarget: Oklch = { l: brand[0], c: brand[1], h: brand[2] };
		const accentTarget: Oklch = { l: ACCENT[0], c: ACCENT[1], h: ACCENT[2] };

		expect(oklchDistance(result.schemes.light.brand[8]!, brandTarget)).toBeLessThanOrEqual(
			ANCHOR_TOLERANCE,
		);
		expect(oklchDistance(result.schemes.dark.brand[8]!, brandTarget)).toBeLessThanOrEqual(
			ANCHOR_TOLERANCE,
		);
		expect(oklchDistance(result.schemes.light.accent[8]!, accentTarget)).toBeLessThanOrEqual(
			ANCHOR_TOLERANCE,
		);
		expect(oklchDistance(result.schemes.dark.accent[8]!, accentTarget)).toBeLessThanOrEqual(
			ANCHOR_TOLERANCE,
		);
		// The engine's own account of the brand anchor, checked against what was just measured
		// independently rather than trusted on its own — an engine that reported success while
		// missing the tolerance would fail on this disagreement. `result.anchor` only ever reports
		// the brand ramp (`anchorReport` in `core/oklch-scale-engine.ts`), so the accent assertions
		// above have no engine self-report to cross-check against; they stand on the independent
		// measurement alone.
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
	// forcing a reader back into a loop body to work out which iteration failed. `seedLabel` sits
	// second in the tuple, ahead of `params`, because `it.each`'s `%s` placeholders fill from the
	// title template in argument order: a title with `params` in that slot would print the object
	// instead of the seed, and the four titles per preset would come out identical.
	const cases = PRESETS.flatMap(([presetName, params]) =>
		SEEDS.map(([seedLabel, brand]) => [presetName, seedLabel, params, brand] as const),
	);

	it.each(cases)(
		'leaves nothing unrepaired for %s under %s',
		(_presetName, _seedLabel, params, brand) => {
			const seed = seedWith(brand);
			const result = generate(seed, params);
			const base = buildTokenSet(result.schemes, seed, params);
			const { unrepaired } = withContrastRepairs(base);

			expect(unrepaired).toEqual([]);
		},
	);
});
