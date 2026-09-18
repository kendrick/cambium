import { describe, expect, it } from 'vitest';

import { CAMBIUM_NAMESPACE } from './provenance';
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

		expect(
			Object.values(weight).every(
				(w) => Number.isInteger(w.value) && w.value >= 1 && w.value <= 1000,
			),
		).toBe(true);
		expect(Object.values(lineHeight).every((h) => h.value >= 1 && h.value <= 2)).toBe(true);
	});

	it('produces the same scale from the same ratio', () => {
		expect(typeScale(1.25)).toEqual(typeScale(1.25));
	});

	/**
	 * `ratio` is the module's only argument, so seeing whether it was stated costs nothing extra.
	 * `source` on the category stays `derived` regardless, so the split lives on each size's own
	 * payload rather than on the discriminator a category-level read would reach for.
	 */
	it('tags every scaled size derived on typeScaleRatio when the seed stated one', () => {
		const { size } = typeScale(1.25).values;

		STEPS.filter((step) => step !== 'base').forEach((step) => {
			expect(size[step]!.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
				provenance: 'derived',
				seedField: 'typeScaleRatio',
			});
		});
	});

	/**
	 * `base` is exempt because the ratio cannot move it: its exponent is zero, so it is 1rem at
	 * every stated ratio and at the fallback. Asserted by measuring rather than by reading the
	 * exponent, so the claim survives a change to how the scale is computed.
	 */
	it('tags the base size invented, because no ratio moves it', () => {
		const stated = typeScale(1.25).values.size.base!;
		const wider = typeScale(1.6).values.size.base!;

		expect(stated.value).toBe(wider.value);
		expect(stated.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
			provenance: 'invented',
			seedField: null,
		});
	});

	it('tags every size invented with a null seed field when the seed measured no ratio', () => {
		const { size } = typeScale(null).values;

		STEPS.forEach((step) => {
			expect(size[step]!.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
				provenance: 'invented',
				seedField: null,
			});
		});
	});

	/**
	 * Weight and line height never track the ratio, so this holds regardless of whether the ratio
	 * itself was stated — the two fixtures below are a stated ratio and a null one, and both come
	 * back invented.
	 */
	it.each([1.25, null])(
		'tags weight and line height invented regardless of the ratio (%s)',
		(ratio) => {
			const { weight, lineHeight } = typeScale(ratio).values;

			Object.values(weight).forEach((w) => {
				expect(w.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
					provenance: 'invented',
					seedField: null,
				});
			});
			Object.values(lineHeight).forEach((h) => {
				expect(h.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
					provenance: 'invented',
					seedField: null,
				});
			});
		},
	);
});
