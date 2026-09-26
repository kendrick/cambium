import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema, type KeyColor } from './brand-seed';
import { defaultPins, type PinKey } from './contrast/repair';
import { BALANCED } from './interpretation';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { buildTokenSet } from './semantic-layer';
import { defaultSeedPins, repairPinsFor, SeedPinPathSchema } from './seed-pins';

type Triple = [number, number, number];

function keyColor(oklch: Triple, proposedRole: KeyColor['proposedRole']): KeyColor {
	return { oklch, proposedRole, sourceImageId: 'img-1', sourceRegion: null };
}

function seedWith(keyColors: KeyColor[]): BrandSeed {
	return BrandSeedSchema.parse({
		keyColors,
		neutralTemperature: null,
		radiusCharacter: null,
		shadowCharacter: null,
		trackingFeel: null,
		typeClassification: null,
		suggestedPairing: null,
		typeScaleRatio: null,
		imageClassifications: null,
		expressive: null,
	});
}

/**
 * What the engine itself marks as read from the image, which is what repair protects when no
 * caller names pins. `repairPinsFor` re-states the engine's key colour choice rather than importing
 * it, so this is the only thing keeping the two from drifting apart.
 */
function observedSteps(seed: BrandSeed): Set<PinKey> {
	const result = createOklchScaleEngine().generate(seed, BALANCED);

	if (!result.ok)
		throw new Error(`the scale engine rejected the fixture seed: ${result.error.kind}`);

	return defaultPins(buildTokenSet(result.schemes, seed));
}

/** The same ten hues `core/contrast/repair.test.ts` sweeps, dark navy through light yellow. */
const SWEEP: [string, Triple][] = [
	['dark-navy', [0.2, 0.1, 265]],
	['purple', [0.45, 0.2, 300]],
	['red', [0.58, 0.22, 27]],
	['magenta', [0.55, 0.25, 330]],
	['blue', [0.6231, 0.188, 259.8]],
	['green', [0.6959, 0.1491, 162.5]],
	['orange', [0.7, 0.17, 55]],
	['cyan', [0.72, 0.12, 200]],
	['yellow', [0.7952, 0.1617, 86.0]],
	['light-yellow', [0.9, 0.14, 95]],
];

const ACCENT: Triple = [0.7, 0.17, 55];

// Every key colour is pinned in the agreement check, so it catches a rule that places the wrong
// ramp, skips the accent, or misses the engine's fallback to the first entry when no brand role is
// proposed. It can't catch a last-wins rule, since both brand colours are pinned either way; the
// "does not place" case below does.
const SHAPES: [string, KeyColor[]][] = [
	...SWEEP.map(([name, oklch]): [string, KeyColor[]] => [name, [keyColor(oklch, 'brand')]]),
	...SWEEP.map(([name, oklch]): [string, KeyColor[]] => [
		`${name} with an accent`,
		[keyColor(oklch, 'brand'), keyColor(ACCENT, 'accent')],
	]),
	[
		'two brand colours, then an accent',
		[
			keyColor([0.6231, 0.188, 259.8], 'brand'),
			keyColor([0.58, 0.22, 27], 'brand'),
			keyColor(ACCENT, 'accent'),
		],
	],
	[
		'an accent listed before the brand',
		[keyColor(ACCENT, 'accent'), keyColor([0.6231, 0.188, 259.8], 'brand')],
	],
	[
		'no brand role, a status colour first',
		[keyColor([0.58, 0.22, 27], 'danger'), keyColor([0.6959, 0.1491, 162.5], 'success')],
	],
	['no brand role, an accent first', [keyColor(ACCENT, 'accent')]],
];

describe('repairPinsFor', () => {
	it.each(SHAPES)('%s: agrees with the steps the engine marks observed', (_name, keyColors) => {
		const seed = seedWith(keyColors);

		expect(repairPinsFor(seed, defaultSeedPins(seed))).toEqual(observedSteps(seed));
	});

	it('pins the accent step in both schemes when an accent key colour is pinned', () => {
		const seed = seedWith([keyColor([0.6231, 0.188, 259.8], 'brand'), keyColor(ACCENT, 'accent')]);

		expect(repairPinsFor(seed, ['keyColors.1'])).toEqual(
			new Set(['light:accent.9', 'dark:accent.9']),
		);
	});

	it('drops brand.9 once key colour 0 is unpinned', () => {
		const seed = seedWith([keyColor([0.6231, 0.188, 259.8], 'brand'), keyColor(ACCENT, 'accent')]);
		const withAll = repairPinsFor(seed, defaultSeedPins(seed));
		const withoutFirst = repairPinsFor(
			seed,
			defaultSeedPins(seed).filter((pin) => pin !== 'keyColors.0'),
		);

		expect(withAll).toContain('light:brand.9');
		expect(withoutFirst).not.toContain('light:brand.9');
		expect(withoutFirst).not.toContain('dark:brand.9');
		expect(withoutFirst).toEqual(new Set(['light:accent.9', 'dark:accent.9']));
	});

	// The second brand colour places no step, so pinning it protects nothing repair could move.
	it('yields nothing for a key colour the engine does not place', () => {
		const seed = seedWith([
			keyColor([0.6231, 0.188, 259.8], 'brand'),
			keyColor([0.58, 0.22, 27], 'brand'),
		]);

		expect(repairPinsFor(seed, ['keyColors.1'])).toEqual(new Set());
	});

	it('yields no PinKey for a pin on a non-colour field', () => {
		const seed = seedWith([keyColor([0.6231, 0.188, 259.8], 'brand')]);

		expect(repairPinsFor(seed, ['radiusCharacter', 'typeScaleRatio'])).toEqual(new Set());
	});

	it('yields nothing for a seed with no key colours', () => {
		const seed = seedWith([]);

		expect(repairPinsFor({ ...seed, keyColors: null }, ['keyColors.0'])).toEqual(new Set());
	});
});

describe('defaultSeedPins', () => {
	it('pins every key colour and nothing else', () => {
		const seed = seedWith([
			keyColor([0.6231, 0.188, 259.8], 'brand'),
			keyColor([0.58, 0.22, 27], 'brand'),
			keyColor(ACCENT, 'accent'),
		]);

		expect(defaultSeedPins(seed)).toEqual(['keyColors.0', 'keyColors.1', 'keyColors.2']);
	});

	it('pins nothing on a seed whose key colours are null', () => {
		expect(defaultSeedPins({ ...seedWith([]), keyColors: null })).toEqual([]);
	});
});

describe('SeedPinPathSchema', () => {
	const fields = Object.keys(BrandSeedSchema.shape).filter((field) => field !== 'keyColors');

	it.each(fields)('accepts the seed field %s', (field) => {
		expect(SeedPinPathSchema.safeParse(field).success).toBe(true);
	});

	it.each(['keyColors.0', 'keyColors.12'])('accepts %s', (path) => {
		expect(SeedPinPathSchema.parse(path)).toBe(path);
	});

	// `keyColors` alone would pin every entry at once, which no control offers. `-1`, `01` and
	// `1.5` name no array index, and `01` would also make two spellings of one pin.
	it.each([
		'keyColors',
		'keyColors.',
		'keyColors.-1',
		'keyColors.01',
		'keyColors.1.5',
		'keyColors.1e3',
		'surfacePolarity',
		'radiusCharacter.base',
	])('refuses %j', (path) => {
		expect(SeedPinPathSchema.safeParse(path).success).toBe(false);
	});
});
