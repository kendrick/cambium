import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema, type OklchTriple } from './brand-seed';
import { contrastFromOklch, hueDistance, isInP3, isInSrgb, oklchDistance } from './oklch';
import {
	ANCHOR_TOLERANCE,
	BALANCED,
	type InterpretationParams,
	RAMP_NAMES,
	type RampName,
	SCHEME_NAMES,
	type SchemeName,
	type ScaleEngine,
} from './scale-engine';
import { STEP_ROLES } from './step-roles';
import { type Ramp, RampSchema } from './token-set';

/**
 * Runs against any `ScaleEngine`. This file imports nothing but the seam, the schemas it moves, the
 * target table, and the colour maths it needs to grade with, so a second engine passes it unchanged;
 * if it does not, the seam promised something this contract never actually specified.
 *
 * Contrast is measured here rather than read from the engine's own report, because a contract that
 * asks an implementation to grade itself tests nothing.
 *
 * The table is the authority on what a ramp owes. Assertions read it rather than restating its
 * numbers, so retuning a target is one edit to data instead of an edit to data plus a hunt through
 * expectations still holding the old value.
 */

const STATUS_RAMPS = ['danger', 'warning', 'success', 'info'] as const;

/** One brand key colour and nothing else stated, which is the hardest honest input. */
function seedWith(brand: OklchTriple, overrides: Partial<BrandSeed> = {}): BrandSeed {
	return BrandSeedSchema.parse({
		keyColors: [
			{ oklch: brand, proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null },
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
}

/**
 * The same four hues the prototype in `docs/research/oss-landscape.md` was measured against, so a
 * figure here is comparable to the ones recorded there rather than to a fresh set nobody has
 * numbers for. They span the circle and, more usefully, they span lightness: yellow sits at 0.795
 * and crimson at 0.586, and that spread is what makes anchoring step 9 hard.
 */
const SEEDS: ReadonlyArray<readonly [string, OklchTriple]> = [
	['blue at 259.8', [0.6231, 0.188, 259.8]],
	['yellow at 86.0', [0.7952, 0.1617, 86.0]],
	['crimson at 17.6', [0.5858, 0.222, 17.6]],
	['green at 162.5', [0.6959, 0.1491, 162.5]],
];

type Schemes = Record<SchemeName, Record<RampName, Ramp>>;

/** Every ramp in both schemes, flattened so one case can sweep all fourteen. */
function eachRamp(schemes: Schemes) {
	return SCHEME_NAMES.flatMap((scheme) =>
		RAMP_NAMES.map((name) => ({ scheme, name, ramp: schemes[scheme][name] })),
	);
}

export function testScaleEngineContract(createEngine: () => ScaleEngine) {
	const generate = (brand: OklchTriple, params: InterpretationParams = BALANCED) => {
		const result = createEngine().generate(seedWith(brand), params);

		if (!result.ok) throw new Error(`generation failed: ${result.error.kind}`);

		return result;
	};

	describe('ramp shape', () => {
		it.each(SEEDS)('produces all seven ramps in both schemes for %s', (_label, brand) => {
			const { schemes } = generate(brand);

			for (const scheme of SCHEME_NAMES) {
				expect(new Set(Object.keys(schemes[scheme]))).toEqual(new Set(RAMP_NAMES));
			}
		});

		it.each(SEEDS)('produces twelve ordered steps in every ramp for %s', (_label, brand) => {
			for (const { scheme, name, ramp } of eachRamp(generate(brand).schemes)) {
				const parsed = RampSchema.safeParse(ramp);

				expect(parsed.success, `${scheme} ${name}: ${parsed.error?.message}`).toBe(true);
			}
		});
	});

	describe('lightness', () => {
		// One loop covers direction and distance, because the table already says which step each
		// step is measured against. Step 1 and step 9 declare no predecessor: step 1 has none, and
		// step 9 carries the seed's own lightness, so measuring it against a curve value would
		// assert something the engine was never free to choose.
		//
		// Step 11 reaches back to step 8 rather than to step 10. Steps 9 and 10 float with the
		// seed, and a separation measured against a floating step says nothing.
		it.each(SEEDS)('moves the right way by a visible amount for %s', (_label, brand) => {
			const violations: string[] = [];

			for (const { scheme, name, ramp } of eachRamp(generate(brand).schemes)) {
				const direction = scheme === 'light' ? -1 : 1;

				for (const role of STEP_ROLES) {
					if (role.separationFrom === null) continue;

					const delta = ramp[role.step - 1]!.l - ramp[role.separationFrom - 1]!.l;
					const where = `${scheme} ${name} step ${role.step} vs ${role.separationFrom}`;

					// An anchored step is told which way to move by the seed, not by the curve, so only
					// the distance is asked of it. A black brand cannot hover blacker, and a hover that
					// turns back toward the page is the right answer there rather than a ramp that walks
					// its lightness out of range trying to obey a direction.
					if (!role.anchoredToSeed && Math.sign(delta) !== direction) {
						violations.push(`${where}: moved ${delta.toFixed(4)}, wanted sign ${direction}`);
					}

					if (Math.abs(delta) < role.minLightnessSeparation) {
						violations.push(`${where}: separated by only ${Math.abs(delta).toFixed(4)}`);
					}
				}
			}

			expect(violations).toEqual([]);
		});

		// The carve-out above is only safe if the anchored pair really is the sole exception. If an
		// engine broke the chain somewhere else it would still pass every per-step check, because
		// each one only ever looks at its own declared predecessor.
		it.each(SEEDS)('runs steps 1 through 8 as one unbroken chain for %s', (_l, brand) => {
			for (const { scheme, name, ramp } of eachRamp(generate(brand).schemes)) {
				const direction = scheme === 'light' ? -1 : 1;
				const head = ramp.slice(0, 8).map((step) => step.l);
				const unbroken = head.every((l, i) => i === 0 || Math.sign(l - head[i - 1]!) === direction);

				expect(unbroken, `${scheme} ${name}: ${head.map((l) => l.toFixed(3)).join(' ')}`).toBe(
					true,
				);
			}
		});
	});

	describe('the step-role target table', () => {
		it.each(SEEDS)('meets every declared WCAG floor against step 2 for %s', (_label, brand) => {
			for (const { scheme, name, ramp } of eachRamp(generate(brand).schemes)) {
				for (const role of STEP_ROLES) {
					if (role.minWcagVsStep2 === null) continue;

					const measured = contrastFromOklch(ramp[role.step - 1]!, ramp[1]!);

					expect(
						measured,
						`${scheme} ${name} step ${role.step} (${role.role}): ${measured.toFixed(3)}`,
					).toBeGreaterThanOrEqual(role.minWcagVsStep2);
				}
			}
		});
	});

	describe('the brand anchor', () => {
		// Radix holds step 9 identical in light and dark for every chromatic scale, and only its
		// neutrals differ. A brand colour that changed between themes would not be the brand colour.
		it.each(SEEDS)('places the seed colour at step 9 of both schemes for %s', (_l, brand) => {
			const { schemes, anchor } = generate(brand);
			const light = schemes.light.brand[8]!;
			const dark = schemes.dark.brand[8]!;
			// Measured here rather than read off `anchor`, which is the engine's own account of how
			// well it did. The flag is then checked against that measurement, so an engine that
			// reports success while missing the tolerance fails on the disagreement.
			const measured = oklchDistance(light, { l: brand[0], c: brand[1], h: brand[2] });

			expect(measured).toBeLessThanOrEqual(ANCHOR_TOLERANCE);
			expect(anchor.withinTolerance, `reported ${anchor.deviation}, measured ${measured}`).toBe(
				measured <= ANCHOR_TOLERANCE,
			);
			expect(oklchDistance(light, dark)).toBeLessThan(1e-9);
		});
	});

	describe('gamut', () => {
		it.each(SEEDS)('leaves every step inside sRGB after mapping for %s', (_label, brand) => {
			for (const { scheme, name, ramp } of eachRamp(generate(brand).schemes)) {
				for (const step of ramp) {
					expect(isInSrgb(step), `${scheme} ${name} step ${step.step}`).toBe(true);
				}
			}
		});

		// A seed can carry a colour no sRGB display shows, because a P3 photograph is a legitimate
		// reference image. Mapping has to pull it in rather than emit a colour that renders as a
		// clipped surprise, and the anchor has to admit that step 9 is not what it was handed.
		it('pulls a P3 seed into sRGB and reports the deviation', () => {
			const p3Only: OklchTriple = [0.6, 0.245, 0];

			// Proving the fixture before trusting the test. Raising chroma until a colour leaves sRGB
			// usually takes it out of P3 too, so an eyeballed seed exercises clamping and says nothing
			// about the P3 path this case is named for.
			expect(isInP3({ l: p3Only[0], c: p3Only[1], h: p3Only[2] })).toBe(true);
			expect(isInSrgb({ l: p3Only[0], c: p3Only[1], h: p3Only[2] })).toBe(false);

			const result = createEngine().generate(seedWith(p3Only), BALANCED);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			for (const { ramp } of eachRamp(result.schemes)) {
				for (const step of ramp) {
					expect(isInSrgb(step)).toBe(true);
				}
			}

			expect(result.anchor.deviation).toBeGreaterThan(0);
		});
	});

	describe('determinism', () => {
		// Serialized rather than `toEqual`, because the criterion is byte-identical output and a
		// structural compare passes over negative zero and over two objects built key by key in a
		// different order.
		it.each(SEEDS)('produces byte-identical ramps on a repeated run for %s', (_l, brand) => {
			expect(JSON.stringify(generate(brand).schemes)).toBe(JSON.stringify(generate(brand).schemes));
		});

		// The paired negative. Without it the case above passes just as well against an engine that
		// ignores its seed and returns a constant.
		it('produces different ramps for two seeds a hue apart', () => {
			expect(JSON.stringify(generate(SEEDS[0]![1]).schemes)).not.toBe(
				JSON.stringify(generate(SEEDS[3]![1]).schemes),
			);
		});

		it('produces different ramps for one seed under two parameter sets', () => {
			const balanced = generate(SEEDS[0]![1], BALANCED);
			const spread = generate(SEEDS[0]![1], { ...BALANCED, chromaSpread: 1.6 });

			expect(JSON.stringify(balanced.schemes)).not.toBe(JSON.stringify(spread.schemes));
		});
	});

	describe('derivation from an underspecified seed', () => {
		it('fails rather than inventing a brand when the seed carries no key colour', () => {
			const result = createEngine().generate(
				seedWith([0.6, 0.15, 200], { keyColors: null }),
				BALANCED,
			);

			expect(result.ok).toBe(false);
			expect(result.error?.kind).toBe('no-key-colors');
		});

		it('seeds the accent from a second key colour when the seed offers one', () => {
			const brand: OklchTriple = [0.6231, 0.188, 259.8];
			const observed = seedWith(brand, {
				keyColors: [
					{ oklch: brand, proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null },
					{
						oklch: [0.62, 0.19, 30],
						proposedRole: 'accent',
						sourceImageId: 'img-1',
						sourceRegion: null,
					},
				],
			});
			const result = createEngine().generate(observed, BALANCED);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(hueDistance(result.schemes.light.accent[8]!.h, 30)).toBeLessThan(2);
		});

		// Near the requested rotation rather than exactly on it. A fixed rotation lands some brands'
		// accents on top of a status hue, so the engine is free to move off the preference to stay
		// clear. Asserting the exact angle here would forbid the only reasonable fix for that.
		it.each(SEEDS)('derives the accent near the requested rotation for %s', (_l, brand) => {
			const { schemes } = generate(brand);
			const preferred = (brand[2] + BALANCED.accentRotation) % 360;
			const accent = schemes.light.accent[8]!.h;

			expect(hueDistance(accent, preferred)).toBeLessThan(60);
			expect(hueDistance(accent, brand[2])).toBeGreaterThan(20);
		});

		// The defect this exists to prevent was visible only in the swatch grid: a blue brand took a
		// 120 degree rotation onto 19.8 degrees, and danger sits at 23, so the palette shipped an
		// accent and a danger ramp that were the same red. Both parse, both hit every contrast
		// target, and a token set carrying them is unusable.
		it.each(SEEDS)('keeps a derived accent clear of every status hue for %s', (_l, brand) => {
			const { schemes } = generate(brand);
			const accent = schemes.light.accent[8]!.h;

			for (const name of STATUS_RAMPS) {
				const separation = hueDistance(accent, schemes.light[name][8]!.h);

				expect(
					separation,
					`accent sits ${separation.toFixed(1)} degrees from ${name}`,
				).toBeGreaterThanOrEqual(20);
			}
		});

		// Neutral is the one ramp a seed states as a temperature rather than as a colour, so a null
		// temperature is the common case rather than the degraded one.
		it('derives a near-neutral ramp when the seed states no temperature', () => {
			const { schemes } = generate([0.6231, 0.188, 259.8]);

			expect(RampSchema.safeParse(schemes.light.neutral).success).toBe(true);
			expect(schemes.light.neutral[8]!.c).toBeLessThan(0.05);
		});

		it('honours a stated neutral temperature', () => {
			const tinted = seedWith([0.6231, 0.188, 259.8], {
				neutralTemperature: { hue: 40, chroma: 0.02 },
			});
			const result = createEngine().generate(tinted, BALANCED);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(hueDistance(result.schemes.light.neutral[8]!.h, 40)).toBeLessThan(2);
		});
	});

	describe('status ramps', () => {
		// Implementation-blind on purpose: the contract states that under Balanced a status hue does
		// not depend on the brand, without naming what the hue is. Harmonisation toward the brand is
		// an Expressive-preset behaviour, and a danger ramp that drifted there stops reading as
		// danger, which is the only job it has. Naming the canonical angles here instead would move
		// a tuning decision out of the engine and into the contract.
		it('holds status hues independent of the brand hue under Balanced', () => {
			const first = generate(SEEDS[0]![1]).schemes.light;
			const second = generate(SEEDS[3]![1]).schemes.light;

			for (const name of STATUS_RAMPS) {
				const drift = hueDistance(first[name][8]!.h, second[name][8]!.h);

				expect(drift, `${name} drifted ${drift.toFixed(2)} degrees`).toBeLessThan(1);
			}
		});

		it.each(SEEDS)('keeps the four status hues distinct from each other for %s', (_l, brand) => {
			const { schemes } = generate(brand);
			const hues = STATUS_RAMPS.map((name) => schemes.light[name][8]!.h);

			for (let i = 0; i < hues.length; i += 1) {
				for (let j = i + 1; j < hues.length; j += 1) {
					expect(
						hueDistance(hues[i]!, hues[j]!),
						`${STATUS_RAMPS[i]} vs ${STATUS_RAMPS[j]}`,
					).toBeGreaterThan(20);
				}
			}
		});
	});
}
