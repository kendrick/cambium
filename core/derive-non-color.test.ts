import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from './brand-seed';
import { deriveNonColor } from './derive-non-color';
import { compositeOver, isInSrgb } from './oklch';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { CAMBIUM_NAMESPACE, invented } from './provenance';
import { resolveScheme } from './resolve-scheme';
import { type SchemeName } from './scale-engine';
import { BALANCED } from './interpretation';
import { MIN_RENDERED_DARKENING, MIN_VISIBLE_SURFACE_LIGHTNESS } from './shadow-scale';
import type { ColorScheme, SemanticEntry, TokenExtensions } from './token-set';

const BLANK = {
	keyColors: null,
	neutralTemperature: null,
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

	const semantic = {
		background: fixtureAlias('neutral.1'),
		foreground: fixtureAlias('neutral.12'),
	};

	return {
		light: { primitives: result.schemes.light, semantic },
		dark: { primitives: result.schemes.dark, semantic },
	};
}

/**
 * `SemanticEntrySchema` requires `$extensions` now, same as every other token. This module reads
 * only `background`'s colour, so the fixture's own provenance is unexamined and `invented` says
 * that plainly rather than dressing up a rationale nothing here checks.
 */
function fixtureAlias(alias: string): SemanticEntry {
	return { alias, $extensions: invented('Fixture alias, chosen for the test rather than a seed') };
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
	return deriveNonColor(seed, colorSchemesFor(seed), BALANCED);
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

	/**
	 * The classification rule from #9's decision 4: `source: 'system'` already means no seed field
	 * reached the category, so every leaf in the five system categories comes back `invented` with
	 * a null `seedField`, and the rationale is per category rather than per leaf. This checks only
	 * the five system categories' own leaves; radius, typography and tracking tag themselves and are
	 * a peer module's assertions to make.
	 */
	it('tags every system leaf invented, with no seed field, one rationale per category', () => {
		const { spacing, opacity, motion, focusRing, zIndex } = derive(crisp);

		const leavesByCategory: Record<(typeof SYSTEM)[number], { $extensions: TokenExtensions }[]> = {
			spacing: Object.values(spacing.values),
			opacity: Object.values(opacity.values),
			motion: [...Object.values(motion.values.duration), ...Object.values(motion.values.easing)],
			focusRing: [focusRing.values.width, focusRing.values.offset],
			zIndex: Object.values(zIndex.values),
		};

		for (const leaves of Object.values(leavesByCategory)) {
			expect(leaves.length).toBeGreaterThan(0);

			const payloads = leaves.map((leaf) => leaf.$extensions[CAMBIUM_NAMESPACE]);

			expect(payloads.every((p) => p.provenance === 'invented' && p.seedField === null)).toBe(true);
			// One rationale per category, not one per leaf: every leaf in a category shares it.
			expect(new Set(payloads.map((p) => p.rationale)).size).toBe(1);
		}
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
	 *
	 * The hue match alone would not prove that. A shadow copies the surface hue whether or not any
	 * chroma survives, so the chroma is the half worth asserting: `neutral.1` is near-achromatic by
	 * design, and a derivation that passed its own chroma through would ship black while every hue
	 * assertion here still passed.
	 */
	it.each(['light', 'dark'] as const)(
		"tints the %s shadow with that scheme's background",
		(scheme) => {
			const schemes = colorSchemesFor(crisp);
			const background = resolveScheme(schemes[scheme]).background!;
			const { color } = deriveNonColor(crisp, schemes, BALANCED).shadow[scheme].values.md!;

			expect(color.h).toBeCloseTo(background.h, 6);
			expect(color.c).toBeGreaterThan(0);
			expect(color.l).toBeLessThan(background.l);
		},
	);

	/**
	 * The chroma floor belongs to the light scheme alone, and stating it per scheme is what keeps
	 * this honest. A shadow on a light page sits near lightness 0.15, where sRGB has room for the
	 * full tint. A dark page puts it near 0.028, where the most any hue can hold is about 0.011 and
	 * hue 200 reaches only 0.0048 against hue 265's 0.0194. Asserting one floor across both schemes
	 * passes or fails on which hue the fixture seed happens to carry.
	 */
	it('carries a tint anyone can see in the light scheme', () => {
		expect(derive(crisp).shadow.light.values.md!.color.c).toBeGreaterThan(0.01);
	});

	/**
	 * What makes a shadow a shadow, measured on the assembled set rather than on a synthetic
	 * surface. Two earlier versions of this derivation shipped a shadow nobody could see: one
	 * declared a chroma no display could show, and the next fixed that by lifting the shadow until
	 * it was barely darker than the page. Every assertion was about the declared colour, so neither
	 * failed anything.
	 */
	it.each(['light', 'dark'] as const)(
		'renders every step visibly darker than the %s page',
		(scheme) => {
			const schemes = colorSchemesFor(crisp);
			const background = resolveScheme(schemes[scheme]).background!;
			const { values } = deriveNonColor(crisp, schemes, BALANCED).shadow[scheme];

			// Composited the way a browser does, per channel in sRGB. Mixing the two OKLCH lightnesses
			// instead reads about 1.8x high on a dark page, which is the measurement error that let
			// four rounds of fixing this pass while the pixels stayed the same.
			const faint = Object.entries(values).filter(
				([, { color }]) =>
					background.l - compositeOver(background, color, color.alpha).l <= MIN_RENDERED_DARKENING,
			);

			expect(faint.map(([step]) => step)).toEqual([]);
		},
	);

	/**
	 * The other half of the shadow-visibility pin. `core/shadow-scale.test.ts` holds the opacity
	 * ramps to `MIN_VISIBLE_SURFACE_LIGHTNESS`; this holds the page the scale engine actually emits
	 * above it. Neither alone is worth much: the ramps cleared 0.02 down to 0.177 against a page at
	 * 0.188 purely by luck, and nothing would have caught either number moving.
	 */
	it.each(['light', 'dark'] as const)('emits a %s page a shadow can be seen on', (scheme) => {
		const background = resolveScheme(colorSchemesFor(crisp)[scheme]).background!;

		expect(background.l).toBeGreaterThan(MIN_VISIBLE_SURFACE_LIGHTNESS);
	});

	/**
	 * The gamut check at the assembled seam as well as inside the module. A shadow colour no display
	 * can show is invisible in exactly the way a shadow with no chroma is, and nothing between here
	 * and an export adapter has an opinion about gamut: `ShadowColorSchema` bounds each channel and
	 * knows nothing about whether the three together land inside sRGB.
	 */
	it.each(['light', 'dark'] as const)('emits a %s shadow a display can show', (scheme) => {
		const offGamut = [crisp, lush]
			.flatMap((seed) => Object.values(derive(seed).shadow[scheme].values))
			.filter(({ color }) => !isInSrgb(color));

		expect(offGamut).toEqual([]);
	});

	/**
	 * The hue half, proved by moving it. Two seeds a long way apart on the circle have to produce
	 * shadows a reader could tell apart, which is what tinting by the surface is for and what a
	 * hardcoded tint would fail.
	 */
	it('moves the shadow hue when the seed hue moves', () => {
		const cool = derive(crisp).shadow.light.values.md!.color;
		const warm = derive(lush).shadow.light.values.md!.color;

		expect(Math.abs(cool.h - warm.h)).toBeGreaterThan(90);
	});

	/**
	 * Two reasons, which is why both are asserted: `neutral.1` resolves to a different colour per
	 * scheme, and the derivation separately raises opacity and blur on a dark surface because a
	 * shadow tuned for a white page is invisible on a near-black one.
	 *
	 * They are not equal partners. `neutral.1` carries the same hue in both schemes, and the gamut
	 * floor under a shadow's lightness absorbs most of what is left, so the colour difference is
	 * small and the opacity difference is the one a reader would notice. #7 records that.
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
			light: { ...schemes.light, semantic: { foreground: fixtureAlias('neutral.12') } },
			dark: schemes.dark,
		};

		expect(() => deriveNonColor(crisp, withoutBackground, BALANCED)).toThrow(/background/);
	});
});
