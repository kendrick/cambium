import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isInSrgb, type Oklch } from './oklch';
import { shadowScale } from './shadow-scale';

const STEPS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

/**
 * Two synthetic surfaces rather than real ramp steps. `shadow-scale.ts` never learns what a ramp or
 * an alias is, so its seam is a plain OKLCH triple, and a fixture built from the scale engine would
 * couple this file to a module the one under test cannot reach.
 *
 * Both sit at the same hue, so a colour difference between them cannot come from hue alone.
 */
const PAGE_LIGHT: Oklch = { l: 0.99, c: 0.004, h: 259.8 };
const PAGE_DARK: Oklch = { l: 0.18, c: 0.012, h: 259.8 };

const tinted = { spread: 'diffuse', tintFromSurface: true } as const;

describe('shadowScale', () => {
	it('emits five elevation steps carrying a colour and four dimensions', () => {
		const { source, values } = shadowScale(PAGE_LIGHT, tinted);

		expect(Object.keys(values)).toEqual([...STEPS]);
		expect(source).toBe('derived');

		for (const step of STEPS) {
			const shadow = values[step]!;

			expect(
				[shadow.offsetX, shadow.offsetY, shadow.blur, shadow.spread].every((d) => d.unit === 'px'),
			).toBe(true);
			expect(shadow.color.alpha).toBeGreaterThan(0);
			expect(shadow.color.alpha).toBeLessThanOrEqual(1);
		}
	});

	it('climbs in offset, blur and opacity as the elevation rises', () => {
		const { values } = shadowScale(PAGE_LIGHT, tinted);
		const rising = (read: (step: (typeof STEPS)[number]) => number) =>
			STEPS.map(read).every((n, i, all) => i === 0 || n > all[i - 1]!);

		expect(rising((step) => values[step]!.offsetY.value)).toBe(true);
		expect(rising((step) => values[step]!.blur.value)).toBe(true);
		expect(rising((step) => values[step]!.color.alpha)).toBe(true);
	});

	// The acceptance criterion: a shadow tinted by the surface reads as part of the system, where
	// black at an opacity reads as a default nobody chose.
	it('takes its hue from the surface it sits on', () => {
		const warm = shadowScale({ l: 0.98, c: 0.01, h: 40 }, tinted).values.md!.color;
		const cool = shadowScale({ l: 0.98, c: 0.01, h: 240 }, tinted).values.md!.color;

		expect(warm.h).toBeCloseTo(40, 6);
		expect(cool.h).toBeCloseTo(240, 6);
	});

	/**
	 * The regression that matters, and the one a chroma read off the surface would pass while
	 * shipping black. `background` aliases `neutral.1`, which is near-achromatic by design: the
	 * page backgrounds this derivation actually receives measure 0.00012 to 0.00106. A shadow that
	 * carried that number forward would satisfy "derives from the surface" and be invisible.
	 *
	 * 0.01 is the floor for a tint anyone can see at a shadow's lightness. Asserting a floor rather
	 * than the constant keeps this a statement about what reaches a stylesheet.
	 */
	it('tints a near-achromatic page with a chroma that can actually be seen', () => {
		const { color } = shadowScale({ l: 0.994, c: 0.000223, h: 259.8 }, tinted).values.md!;

		expect(color.c).toBeGreaterThan(0.01);
		expect(color.h).toBeCloseTo(259.8, 6);
	});

	/**
	 * Hue is meaningless at zero chroma and `core/oklch.ts` canonicalises it to 0 there, so tinting
	 * from a genuinely achromatic page would paint every shadow red. An interpretation preset that
	 * leaves the neutral ramp untinted is what reaches this.
	 */
	it('leaves a shadow on an achromatic page untinted rather than painting it hue zero', () => {
		const { color } = shadowScale({ l: 0.99, c: 0, h: 0 }, tinted).values.md!;

		expect(color.c).toBe(0);
		expect(color.h).toBe(0);
	});

	/**
	 * A seed that reads `tintFromSurface: false` off the reference images gets an untinted shadow.
	 * Overriding an explicit reading would make the field decorative, and issue #7 records the
	 * departure from the criterion above.
	 */
	it('drops hue and chroma when the seed refuses the tint', () => {
		const { color } = shadowScale(PAGE_LIGHT, { spread: 'diffuse', tintFromSurface: false }).values
			.md!;

		expect(color.c).toBe(0);
		expect(color.h).toBe(0);
	});

	/**
	 * What separates a dark page's shadow from a light one's is mostly opacity, and the ratio is
	 * where the weight belongs. The colours differ too, but only a little: `SHADOW_MIN_LIGHTNESS` is
	 * a gamut floor and a dark page already sits close to it, so most of the lightness the surface
	 * would otherwise carry through is absorbed. Asserting the small difference and calling it the
	 * headline would pass while the large one regressed.
	 */
	it('gives a dark page a different shadow from a light one', () => {
		const light = shadowScale(PAGE_LIGHT, tinted).values.md!;
		const dark = shadowScale(PAGE_DARK, tinted).values.md!;

		expect(dark.color).not.toEqual(light.color);
		expect(dark.color.alpha / light.color.alpha).toBeGreaterThan(2);
	});

	it.each(STEPS)('raises opacity and blur at %s on a dark surface', (step) => {
		const light = shadowScale(PAGE_LIGHT, tinted).values[step]!;
		const dark = shadowScale(PAGE_DARK, tinted).values[step]!;

		expect(dark.color.alpha).toBeGreaterThan(light.color.alpha);
		expect(dark.blur.value).toBeGreaterThan(light.blur.value);
	});

	// `spread` on the character is the seed's word for how far the shadow diffuses, which is the
	// blur. It is not the CSS spread radius the same-named dimension carries.
	it('blurs a diffuse shadow further than a tight one at the same elevation', () => {
		const tight = shadowScale(PAGE_LIGHT, { spread: 'tight', tintFromSurface: true }).values.lg!;
		const diffuse = shadowScale(PAGE_LIGHT, tinted).values.lg!;

		expect(tight.blur.value).toBeLessThan(diffuse.blur.value);
		expect(tight.offsetY.value).toBeCloseTo(diffuse.offsetY.value, 10);
	});

	it('tints by default when the seed measured no shadow character', () => {
		expect(shadowScale(PAGE_LIGHT, null).values.md!.color.c).toBeGreaterThan(0);
	});

	/**
	 * The darkness gain multiplies every step's opacity, and the worst case is a page at lightness
	 * zero. Bounding the top step there is what would catch a raised gain: a shadow at 0.5 over a
	 * dark page reads as a black box rather than as depth, and the schema's own 0-to-1 bound is far
	 * too loose to notice.
	 */
	it('keeps the darkest page from stacking opacity into a black box', () => {
		const { values } = shadowScale({ l: 0, c: 0, h: 0 }, tinted);

		expect(values.xl!.color.alpha).toBeLessThan(0.5);
		expect(STEPS.every((step) => values[step]!.color.alpha > 0)).toBe(true);
	});

	/**
	 * A tint outside sRGB is the invisible-tint bug again: the token file reads 0.02 and the browser
	 * paints whatever it can reach, which on a dark page was 0.0048. Yellow and green bind here, so
	 * a hue sweep is what makes this catch a change to either constant rather than to one hue.
	 */
	it.each([PAGE_LIGHT, PAGE_DARK])('emits a colour a display can actually show', (surface) => {
		const offGamut = [27, 86, 162.5, 200, 259.8, 300, 340]
			.map((h) => shadowScale({ ...surface, h }, tinted).values.md!.color)
			.filter((color) => !isInSrgb(color));

		expect(offGamut).toEqual([]);
	});

	it('produces the same scale from the same surface', () => {
		expect(shadowScale(PAGE_LIGHT, tinted)).toEqual(shadowScale({ ...PAGE_LIGHT }, tinted));
	});

	/**
	 * Issue #7's out-of-scope line, which no behavioural assertion can reach: this module never
	 * touches the ramps or the semantic colour layer. The surface arrives already resolved, and
	 * `core/derive-non-color.ts` owns the single read-only lookup that resolves it. An import added
	 * here would compile, pass every test above, and quietly undo the split.
	 *
	 * Reads the module's import specifiers rather than its whole source, so the docblock stays free
	 * to name the modules it is explaining its distance from.
	 *
	 * An allowlist rather than a list of the three forbidden modules. Naming what is banned disarms
	 * itself the day one of those files is renamed, and it has to be kept in step with every module
	 * that ever learns about colour. Naming what is allowed fails on any new import at all, which
	 * is the moment worth stopping at.
	 */
	it('imports only what cannot reach a colour', () => {
		const source = readFileSync(new URL('./shadow-scale.ts', import.meta.url), 'utf8');
		const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]!);

		expect(specifiers).not.toHaveLength(0);
		expect(new Set(specifiers)).toEqual(new Set(['./brand-seed', './oklch', './token-set']));
	});
});
