import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from './brand-seed';
import { deriveNonColor } from './derive-non-color';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { BALANCED, type SchemeName } from './scale-engine';
import { resolveScheme } from './semantic-layer';
import type { ColorScheme } from './token-set';

const BLANK = {
	keyColors: null,
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
};

function seedWith(overrides: Partial<BrandSeed>, oklch: [number, number, number]): BrandSeed {
	return BrandSeedSchema.parse({
		...BLANK,
		keyColors: [{ oklch, proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null }],
		...overrides,
	});
}

/**
 * Real engine ramps under a hand-written semantic layer. The ramps have to be real, because the
 * whole claim about shadows is that `neutral.1` resolves to a different colour in each scheme. The
 * semantic layer is hand-written and minimal, because `background` is the only token this module
 * reads and `SEMANTIC_MAP` would drag the rest of the colour layer into a fixture that does not
 * need it.
 */
function colorSchemesFor(seed: BrandSeed): Record<SchemeName, ColorScheme> {
	const result = createOklchScaleEngine().generate(seed, BALANCED);

	if (!result.ok)
		throw new Error(`the scale engine rejected the fixture seed: ${result.error.kind}`);

	const semantic = { background: 'neutral.1', foreground: 'neutral.12' };

	return {
		light: { primitives: result.schemes.light, semantic },
		dark: { primitives: result.schemes.dark, semantic },
	};
}

const crisp = seedWith(
	{
		radiusCharacter: { base: 2, progression: 'sharp' },
		shadowCharacter: { spread: 'tight', tintFromSurface: true },
		trackingFeel: 'tight',
		typeScaleRatio: 1.125,
	},
	[0.6231, 0.188, 259.8],
);

const lush = seedWith(
	{
		radiusCharacter: { base: 24, progression: 'pill' },
		shadowCharacter: { spread: 'diffuse', tintFromSurface: true },
		trackingFeel: 'wide',
		typeScaleRatio: 1.5,
	},
	[0.7, 0.17, 55],
);

const DERIVED = ['radius', 'typography', 'tracking'] as const;
const SYSTEM = ['spacing', 'opacity', 'motion', 'focusRing', 'zIndex'] as const;

function derive(seed: BrandSeed) {
	return deriveNonColor(seed, colorSchemesFor(seed));
}

describe('deriveNonColor', () => {
	it('emits four derived categories and five constants', () => {
		const tokens = derive(crisp);

		expect(new Set(Object.keys(tokens))).toEqual(
			new Set(['radius', 'typography', 'tracking', 'shadow', ...SYSTEM]),
		);
	});

	/**
	 * The discriminator is what makes the criterion below checkable on the value rather than against
	 * a list someone has to keep in sync. This assertion is the other half: a category that carries
	 * no `source` at all would slip past that check silently, and nothing discovers a new category.
	 */
	it('flags every category it returns, including both shadow schemes', () => {
		const tokens = derive(crisp);
		const { shadow, ...flat } = tokens;

		for (const [name, category] of Object.entries(flat)) {
			expect(category.source).toBe(
				(SYSTEM as readonly string[]).includes(name) ? 'system' : 'derived',
			);
		}
		expect(shadow.light.source).toBe('derived');
		expect(shadow.dark.source).toBe('derived');
	});

	// The acceptance criterion, read off the values. Two seeds that disagree about every
	// characteristic the seed carries still have to agree about every constant.
	it('gives two unrelated seeds identical system constants', () => {
		const a = derive(crisp);
		const b = derive(lush);

		for (const name of SYSTEM) {
			expect(a[name]).toEqual(b[name]);
		}
	});

	it.each(DERIVED)('moves %s when the seed moves', (name) => {
		expect(derive(crisp)[name]).not.toEqual(derive(lush)[name]);
	});

	/**
	 * The one read into the colour layer, and what it buys. `SEMANTIC_MAP` aliases `background` to
	 * `neutral.1`, the token that means "the page", so the shadow is tinted by the surface it falls
	 * on rather than by black.
	 */
	it.each(['light', 'dark'] as const)(
		'tints the %s shadow with that scheme’s background',
		(scheme) => {
			const schemes = colorSchemesFor(crisp);
			const background = resolveScheme(schemes[scheme]).background!;
			const { color } = deriveNonColor(crisp, schemes).shadow[scheme].values.md!;

			expect(color.h).toBeCloseTo(background.h, 6);
			expect(color.l).toBeLessThan(background.l);
		},
	);

	/**
	 * Two independent reasons, which is why both are asserted. `neutral.1` resolves to a different
	 * colour per scheme, and the derivation separately raises opacity on a dark surface because a
	 * shadow tuned for a white page is invisible on a near-black one. Either alone would let the
	 * other regress while this still passed.
	 */
	it('gives light and dark different shadows for both of the reasons it should', () => {
		const { shadow } = derive(crisp);
		const light = shadow.light.values.md!;
		const dark = shadow.dark.values.md!;

		expect(dark.color.l).not.toBeCloseTo(light.color.l, 3);
		expect(dark.color.alpha).toBeGreaterThan(light.color.alpha);
		expect(dark.blur.value).toBeGreaterThan(light.blur.value);
	});

	it('produces the same tokens from the same seed', () => {
		expect(derive(crisp)).toEqual(derive(crisp));
	});

	/**
	 * Only reachable by hand-building a scheme, because `SEMANTIC_MAP` declares `background` and
	 * `TokenSetSchema` rejects a dangling alias. Kept anyway: a shadow silently tinted by
	 * `undefined` reaches an export looking like a colour somebody chose.
	 */
	it('throws rather than tinting from nothing when a scheme declares no background', () => {
		const schemes = colorSchemesFor(crisp);
		const withoutBackground = {
			light: { ...schemes.light, semantic: { foreground: 'neutral.12' } },
			dark: schemes.dark,
		};

		expect(() => deriveNonColor(crisp, withoutBackground)).toThrow(/background/);
	});
});
