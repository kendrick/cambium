import { describe, expect, it } from 'vitest';

import { typeScale } from './type-scale';

/** Tailwind's own names, because the vendored theme resolves `--text-lg` and an invented name reaches nothing. */
const STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;

/** A minor third. Tailwind's own base-to-4xl spread is 2.25x over five steps, an effective 1.176. */
const DEFAULT_RATIO = 1.2;

/** Below the floor the scale stops climbing; above the ceiling the top step leaves any interface. */
const FLOOR = 1.05;
const CEILING = 1.618;

function sizesOf(ratio: number | null) {
	const { values } = typeScale(ratio);

	return STEPS.map((step) => values.size[step]!.value);
}

describe('typeScale', () => {
	it('emits the eight steps the vendored theme names, in rem, anchored at base', () => {
		const { source, values } = typeScale(1.25);

		expect(Object.keys(values.size)).toEqual([...STEPS]);
		expect(source).toBe('derived');
		expect(STEPS.every((step) => values.size[step]!.unit === 'rem')).toBe(true);
		expect(values.size.base!.value).toBe(1);
	});

	/**
	 * The acceptance criterion, asserted at full precision rather than within a tolerance. Nothing
	 * rounds, so the ratio between adjacent steps is the ratio the seed measured and not an
	 * approximation of it. Rounding here is what would make this assertion flaky.
	 */
	it.each([1.067, 1.125, 1.2, 1.25, 1.333, 1.5])(
		'follows a ratio of %f across every step',
		(ratio) => {
			const sizes = sizesOf(ratio);

			sizes.forEach((size, i) => {
				if (i === 0) return;

				expect(size / sizes[i - 1]!).toBeCloseTo(ratio, 10);
			});
		},
	);

	it('falls back to a minor third when the seed measured no ratio', () => {
		expect(sizesOf(null)).toEqual(sizesOf(DEFAULT_RATIO));
	});

	/**
	 * A ratio of 1 gives eight identical sizes and anything under it runs the scale backwards, so
	 * the floor is what keeps the output a scale at all. This is the one place the module departs
	 * from the ratio the seed measured, and issue #7 records the departure.
	 */
	it.each([0.8, 1, 1.04])('clamps a ratio of %f up to the floor', (ratio) => {
		expect(sizesOf(ratio)).toEqual(sizesOf(FLOOR));
	});

	it.each([1.8, 2, 8])('clamps a ratio of %f down to the ceiling', (ratio) => {
		expect(sizesOf(ratio)).toEqual(sizesOf(CEILING));
	});

	/**
	 * A Brand Seed measures a scale ratio and a type classification. It measures no weight axis and
	 * no leading, so these two are stated rather than derived, and the way to prove that is to move
	 * the one thing the seed does measure and watch them hold still.
	 */
	it('holds weights and line heights still while the ratio moves', () => {
		const narrow = typeScale(1.1).values;
		const wide = typeScale(1.6).values;

		expect(narrow.weight).toEqual(wide.weight);
		expect(narrow.lineHeight).toEqual(wide.lineHeight);
		expect(Object.keys(narrow.weight).length).toBeGreaterThan(0);
		expect(Object.keys(narrow.lineHeight).length).toBeGreaterThan(0);
	});

	it('states weights as CSS numeric weights and line heights as unitless multipliers', () => {
		const { weight, lineHeight } = typeScale(1.25).values;

		expect(Object.values(weight).every((w) => Number.isInteger(w) && w >= 1 && w <= 1000)).toBe(
			true,
		);
		expect(Object.values(lineHeight).every((h) => h >= 1 && h <= 2)).toBe(true);
	});

	it('produces the same scale from the same ratio', () => {
		expect(typeScale(1.25)).toEqual(typeScale(1.25));
	});
});
