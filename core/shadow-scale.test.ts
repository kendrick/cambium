import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Oklch } from './oklch';
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
		expect(warm.c).toBeGreaterThan(0);
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
	 * Two independent reasons, asserted separately, because either one alone would let the other
	 * regress silently. The colour moves because the surface moves. The alpha and blur move because
	 * a shadow is light the surface is not receiving, and a near-black page has very little to take
	 * away: the alpha that reads as depth on white reads as nothing over a dark page.
	 */
	it('tints the shadow differently on a light and a dark surface', () => {
		const light = shadowScale(PAGE_LIGHT, tinted).values.md!.color;
		const dark = shadowScale(PAGE_DARK, tinted).values.md!.color;

		expect(dark).not.toEqual(light);
		expect(dark.l).not.toBeCloseTo(light.l, 3);
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

	it('never lets a stacked opacity leave the 0 to 1 range', () => {
		const { values } = shadowScale({ l: 0, c: 0, h: 0 }, tinted);

		expect(STEPS.every((step) => values[step]!.color.alpha <= 1)).toBe(true);
	});

	it('produces the same scale from the same surface', () => {
		expect(shadowScale(PAGE_LIGHT, tinted)).toEqual(shadowScale({ ...PAGE_LIGHT }, tinted));
	});

	/**
	 * Issue #7's out-of-scope line, which no behavioural assertion can reach: this module never
	 * touches the ramps or the semantic colour layer. The surface arrives already resolved, and
	 * `core/derive-non-color.ts` owns the single read-only lookup that resolves it. An import added
	 * here would compile, pass every test above, and quietly undo the split.
	 */
	it('imports nothing from the colour layer', () => {
		const source = readFileSync(new URL('./shadow-scale.ts', import.meta.url), 'utf8');

		for (const forbidden of ['semantic-map', 'semantic-layer', 'scale-engine']) {
			expect(source).not.toContain(forbidden);
		}
	});
});
