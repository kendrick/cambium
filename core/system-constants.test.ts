import { describe, expect, it } from 'vitest';

import { systemConstants } from './system-constants';

const CATEGORIES = ['spacing', 'opacity', 'motion', 'focusRing', 'zIndex'] as const;

describe('systemConstants', () => {
	/**
	 * "No system-constant category varies with the seed", stated as strongly as it can be: a
	 * function that takes no argument cannot vary with one. `core/derive-non-color.test.ts` asserts
	 * the same property from the other end, over two different seeds, because a later refactor
	 * could thread a seed in without anyone noticing this line.
	 */
	it('takes no input at all', () => {
		expect(systemConstants).toHaveLength(0);
	});

	it('emits the five categories the seed never informs, each flagged as a constant', () => {
		const constants = systemConstants();

		expect(Object.keys(constants)).toEqual([...CATEGORIES]);
		expect(CATEGORIES.every((name) => constants[name].source === 'system')).toBe(true);
	});

	it('returns the same values on every call', () => {
		expect(systemConstants()).toEqual(systemConstants());
	});

	it('spaces in rem, climbing from zero', () => {
		const values = Object.values(systemConstants().spacing.values);

		expect(values.every((d) => d.unit === 'rem')).toBe(true);
		expect(values.every((d, i) => i === 0 || d.value > values[i - 1]!.value)).toBe(true);
		expect(values[0]!.value).toBe(0);
	});

	// `disabled` is the one opacity with an authority behind it: `components/ui/button.tsx` paints a
	// disabled control with `disabled:opacity-50`, and a generated theme that disagreed with the
	// component it ships beside would be wrong rather than merely different.
	it('states opacities as ratios and keeps the disabled value the vendored button uses', () => {
		const { values } = systemConstants().opacity;

		expect(Object.values(values).every((n) => n >= 0 && n <= 1)).toBe(true);
		expect(values.disabled).toBe(0.5);
	});

	it('states durations in milliseconds and easings as cubic-bezier control points', () => {
		const { duration, easing } = systemConstants().motion.values;

		expect(Object.values(duration).every((d) => d.unit === 'ms' && d.value >= 0)).toBe(true);

		for (const curve of Object.values(easing)) {
			expect(curve).toHaveLength(4);
			// The two x coordinates are progress along the curve, so a value outside 0 to 1 makes the
			// easing non-monotonic in time and CSS rejects it.
			expect(curve[0] >= 0 && curve[0] <= 1 && curve[2] >= 0 && curve[2] <= 1).toBe(true);
		}
	});

	/**
	 * `focusRing` rather than `ring`. `SEMANTIC_MAP.ring` is already a colour, and a constant sharing
	 * that name flattens to `--ring` in an export and overwrites it. The width is the one the
	 * vendored button paints, through `focus-visible:ring-3`.
	 */
	it('sizes the focus ring the way the vendored button paints it', () => {
		const { width, offset } = systemConstants().focusRing.values;

		expect(width).toEqual({ value: 3, unit: 'px' });
		expect(offset).toEqual({ value: 0, unit: 'px' });
	});

	it('stacks z-indices as distinct integers in layer order', () => {
		const values = Object.values(systemConstants().zIndex.values);

		expect(values.every(Number.isInteger)).toBe(true);
		expect(values.every((n, i) => i === 0 || n > values[i - 1]!)).toBe(true);
	});
});
