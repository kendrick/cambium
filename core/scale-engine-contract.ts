import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema, type OklchTriple } from './brand-seed';
import { converter } from 'culori/fn';
import { hueDistance, isInP3, isInSrgb, type Oklch, oklchDistance } from './oklch';
import { ENGINE_DIGESTS } from './scale-engine-digest.fixture';
import {
	ANCHOR_TOLERANCE,
	RAMP_NAMES,
	type RampName,
	SCHEME_NAMES,
	type SchemeName,
	type ScaleEngine,
	type ScaleEngineResult,
} from './scale-engine';
import { BALANCED, type InterpretationParams } from './interpretation';
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
 * `renderedContrast` stays out of this file for the same reason. The engine stops solving once that
 * function reports a pair clear of its floor, so the two would always agree. `paintedContrast`
 * below rounds to bytes and works the WCAG formula itself, a second implementation that can
 * disagree with the first.
 *
 * The table is the authority on what a ramp owes. Assertions read it rather than restating its
 * numbers, so retuning a target is one edit to data instead of an edit to data plus a hunt through
 * expectations still holding the old value.
 */

const toSrgb = converter('rgb');

/** One sRGB channel rounded to a byte, then linearised the way WCAG relative luminance wants it. */
function linearChannel(raw: number | undefined): number {
	const byte = Math.round(Math.max(0, Math.min(1, raw ?? 0)) * 255) / 255;

	// 0.04045 is what WCAG 2.2 states. An older 0.03928 still circulates from an earlier draft of
	// the same curve, and no 8-bit channel lands between the two, so both pick the same branch for
	// every value this function ever sees. Matching the spec is what keeps this a transcription.
	return byte <= 0.04045 ? byte / 12.92 : ((byte + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: Oklch): number {
	const rgb = toSrgb({ mode: 'oklch', ...color })!;

	return (
		0.2126 * linearChannel(rgb.r) + 0.7152 * linearChannel(rgb.g) + 0.0722 * linearChannel(rgb.b)
	);
}

/**
 * WCAG contrast between two colours once both are rounded to 8-bit sRGB.
 *
 * Exported for the engine-specific sweeps in `core/oklch-scale-engine.test.ts`, which grade the
 * same floors over hues this contract does not reach and owe their readers the same independence.
 */
export function paintedContrast(color: Oklch, background: Oklch): number {
	const one = relativeLuminance(color);
	const other = relativeLuminance(background);

	return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
}

const STATUS_RAMPS = ['danger', 'warning', 'success', 'info'] as const;

/** One brand key colour and nothing else stated, which is the hardest honest input. */
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

/**
 * The one serialization the determinism cases below share, so two byte-identity checks can never
 * quietly drift onto two different notions of "the same output".
 */
function serializeSchemes(schemes: Schemes): string {
	return JSON.stringify(schemes);
}

/**
 * The whole `ScaleEngineResult`, not just `schemes`. `anchorReport` rounds `anchor` independently
 * of the ramps it describes, and a params combination this contract doesn't reach can land on the
 * failure shape instead of the success one—a schemes-only digest saw neither: it hashed the one
 * field two different results could share. PR #162 caught it live, over a change that touched only
 * `anchor`.
 *
 * It hashes the result's JSON form, so `-0` reads as `0` and an `undefined` field vanishes. The token
 * set's own outputs, CSS and DTCG, are text as well, where `-0` also prints as `0`. A change visible
 * only to `Object.is` still obliges a new id under `ScaleEngine.id`'s rule; this pin can't see it.
 */
function serializeResult(result: ScaleEngineResult): string {
	return JSON.stringify(result);
}

/**
 * Balanced plus one set that moves chromaSpread, harmonization, accentRotation, neutralTinting and
 * surfaceTinting all well away from it at once, so the digest pin below samples more than the single
 * params set every other case in this file runs under. chromaSpread 1.6 is the same figure the
 * determinism block above already uses; harmonization 0.5 is the value `core/oklch-scale-engine.test.ts`
 * already exercises. #37's Faithful and Expressive presets would be the more natural second and
 * third entries here, but they aren't on this branch, so this stays a local literal rather than an
 * import.
 */
const PARAM_SETS: ReadonlyArray<readonly [string, InterpretationParams]> = [
	['balanced', BALANCED],
	[
		'stress',
		{
			...BALANCED,
			chromaSpread: 1.6,
			harmonization: 0.5,
			accentRotation: 200,
			neutralTinting: 1,
			surfaceTinting: 0.08,
		},
	],
];

/**
 * Two fixed points the digest pin adds beside `SEEDS × PARAM_SETS`, because every one of those
 * combinations lands on a brand seed already inside sRGB and a `keyColors` array that always
 * resolves—so `serializeResult`'s two reasons for existing over `serializeSchemes`, `anchor` moving
 * independently and the failure shape, never actually varied the hash. `P3_ONLY_SEED` is the same
 * triple "pulls a P3 seed into sRGB" below proves sits outside sRGB, which is what pushes
 * `anchor.deviation` off zero. `NO_KEY_COLORS_SEED` is the same seed "fails rather than inventing a
 * brand" below already uses, which is what gives `serializeResult` an `ok: false` shape to hash.
 */
const P3_ONLY_SEED: OklchTriple = [0.6, 0.245, 0];
const NO_KEY_COLORS_SEED: BrandSeed = seedWith([0.6, 0.15, 200], { keyColors: null });

/**
 * A literal copy of every digest that has ever shipped, kept apart from `ENGINE_DIGESTS` so that
 * editing the fixture cannot carry this pin along with it. Append only: a shipped id's entry never
 * changes here, so the only way to ship changed output is a new id with a new fixture entry, pinned
 * here in its own turn once it ships.
 */
const PINNED_DIGESTS: Readonly<Record<string, string>> = {
	'cambium-oklch-2': '5c33f508696b0466ada2a2eefa6d7134a7053cfb9d1f429a43bcefef27833711',
	'cambium-oklch-3': '5c33f508696b0466ada2a2eefa6d7134a7053cfb9d1f429a43bcefef27833711',
};

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
		// Measured over the 8-bit pair a browser paints, on both ends, and nowhere over the
		// full-precision OKLCH the engine solved in. Those two answers disagree by roughly fifty
		// times what six-decimal rounding moves, and #72 is what that gap cost: five steps clearing
		// their floor in our units and missing it in the consumer's. A full-precision assertion
		// alongside this one would pin the producer's number as a requirement it is not.
		it.each(SEEDS)('meets every declared WCAG floor against step 2 for %s', (_label, brand) => {
			for (const { scheme, name, ramp } of eachRamp(generate(brand).schemes)) {
				for (const role of STEP_ROLES) {
					if (role.minWcagVsStep2 === null) continue;

					const measured = paintedContrast(ramp[role.step - 1]!, ramp[1]!);

					expect(
						measured,
						`${scheme} ${name} step ${role.step} (${role.role}): ${measured.toFixed(3)} rendered`,
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
			// Proving the fixture before trusting the test. Raising chroma until a colour leaves sRGB
			// usually takes it out of P3 too, so an eyeballed seed exercises clamping and says nothing
			// about the P3 path this case is named for.
			expect(isInP3({ l: P3_ONLY_SEED[0], c: P3_ONLY_SEED[1], h: P3_ONLY_SEED[2] })).toBe(true);
			expect(isInSrgb({ l: P3_ONLY_SEED[0], c: P3_ONLY_SEED[1], h: P3_ONLY_SEED[2] })).toBe(false);

			const result = createEngine().generate(seedWith(P3_ONLY_SEED), BALANCED);

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
			expect(serializeSchemes(generate(brand).schemes)).toBe(
				serializeSchemes(generate(brand).schemes),
			);
		});

		// The paired negative. Without it the case above passes just as well against an engine that
		// ignores its seed and returns a constant.
		it('produces different ramps for two seeds a hue apart', () => {
			expect(serializeSchemes(generate(SEEDS[0]![1]).schemes)).not.toBe(
				serializeSchemes(generate(SEEDS[3]![1]).schemes),
			);
		});

		it('produces different ramps for one seed under two parameter sets', () => {
			const balanced = generate(SEEDS[0]![1], BALANCED);
			const spread = generate(SEEDS[0]![1], { ...BALANCED, chromaSpread: 1.6 });

			expect(serializeSchemes(balanced.schemes)).not.toBe(serializeSchemes(spread.schemes));
		});
	});

	describe('digest pin', () => {
		// The rule this guards lives on `ScaleEngine.id` in `core/scale-engine.ts`: any change to
		// what `generate` produces, for any seed or params, obliges a new id. This pin samples that
		// rule rather than proving it—it covers the four seeds across PARAM_SETS (Balanced plus one
		// set that moves every other field away from it), plus P3_ONLY_SEED and NO_KEY_COLORS_SEED,
		// so a change reachable only through some seed, params, or edge case outside that sample can
		// still slip past. Hashing the whole result rather than `schemes` alone is what makes this a
		// sample of the rule as written: the rule covers everything `generate` returns, and
		// P3_ONLY_SEED and NO_KEY_COLORS_SEED are what make `anchor` and the failure shape actually
		// move the hash, rather than sitting in the sample unexercised.
		it("pins the engine id to a digest of its own output, so an id survives only beside output that hasn't moved", () => {
			const engine = createEngine();
			const bytes = [
				...SEEDS.flatMap(([, brand]) =>
					PARAM_SETS.map(([, params]) => serializeResult(engine.generate(seedWith(brand), params))),
				),
				serializeResult(engine.generate(seedWith(P3_ONLY_SEED), BALANCED)),
				serializeResult(engine.generate(NO_KEY_COLORS_SEED, BALANCED)),
			].join('\n');
			const digest = createHash('sha256').update(bytes).digest('hex');
			const pinned = ENGINE_DIGESTS[engine.id];

			expect(
				pinned,
				`no digest for engine id ${engine.id}: this id is new, so add its digest beside the old ones`,
			).toBeDefined();
			expect(
				digest,
				`output changed under engine id ${engine.id}. Either the change is unintended (revert it), or it is intended: move the engine id, add a new digest entry beside the existing one (leaving the old entry in place), pin it in PINNED_DIGESTS once it ships, and update the id literal asserted in core/oklch-scale-engine.test.ts.`,
			).toBe(pinned);
		});

		// The paired negative for the case above: editing `ENGINE_DIGESTS` in place to match changed
		// output would satisfy that first case on its own. This one holds every shipped entry to a
		// copy the contract carries independently, so re-blessing an id in place now takes editing
		// two literals in two files, which a reviewer sees.
		//
		// No cross-id uniqueness check here on purpose. An intentional change reachable only through
		// something this sample never varies is invisible to the digest, so the required id bump
		// still produces the same sampled digest under the new id—appending it beside the old one is
		// the compliant update, not a collision to reject. Widening what PARAM_SETS or SEEDS samples
		// is the other legitimate way every entry's digest moves at once: that's a single deliberate
		// re-pin, visible in review as both literal copies—this file's and `ENGINE_DIGESTS`'s—changing
		// together, rather than one id drifting out of step with the other.
		//
		// The second loop closes the gap the first one leaves open: it only ever walks
		// `PINNED_DIGESTS`, so an id that landed in `ENGINE_DIGESTS` and was never mirrored here would
		// pass both cases forever, with nothing left to fail once that mirroring step gets skipped.
		// Shipping an id is two edits, not one, and this is what holds the second edit to happening at
		// all.
		it('keeps every pinned digest exactly as it shipped', () => {
			for (const [id, digest] of Object.entries(PINNED_DIGESTS)) {
				expect(
					ENGINE_DIGESTS[id],
					`pinned digest for ${id} no longer matches ENGINE_DIGESTS. Editing a shipped digest in place is not allowed: ship changed output under a new engine id and a new digest entry, then pin it here once it ships.`,
				).toBe(digest);
			}

			for (const id of Object.keys(ENGINE_DIGESTS)) {
				expect(
					PINNED_DIGESTS[id],
					`${id} is in ENGINE_DIGESTS but missing from PINNED_DIGESTS. Shipping an id isn't done at the ENGINE_DIGESTS edit: mirror its digest into PINNED_DIGESTS in the same change, or this id's entry stays editable in place forever.`,
				).toBeDefined();
			}
		});
	});

	describe('derivation from an underspecified seed', () => {
		it('fails rather than inventing a brand when the seed carries no key colour', () => {
			const result = createEngine().generate(NO_KEY_COLORS_SEED, BALANCED);

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
