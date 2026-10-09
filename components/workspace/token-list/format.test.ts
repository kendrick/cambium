import { describe, expect, it } from 'vitest';

import { formatLengthForDisplay, formatSignificant, swatchOf } from './format';

// Every expected string below is worked out by hand from #159's wording: three significant
// figures for a length, three decimals for an OKLCH channel, trailing zeros trimmed.
describe('formatSignificant', () => {
	it.each([
		// The issue's own examples.
		[2.099999, '2.1'],
		[4.208727, '4.21'],
		// A minor third below and above the base.
		[0.694444, '0.694'],
		[1.2, '1.2'],
		[1, '1'],
		[0.875, '0.875'],
		// Past 1000 `toPrecision` switches to exponent form, which nobody reads as a size.
		[1234.5, '1230'],
		[0, '0'],
		[-0, '0'],
		[-0.0254, '-0.0254'],
	])('%d prints as %s', (value, expected) => {
		expect(formatSignificant(value)).toBe(expected);
	});
});

describe('formatLengthForDisplay', () => {
	it.each([
		['2.099999rem', '2.1rem'],
		['4.208727rem', '4.21rem'],
		['1rem', '1rem'],
		['0px', '0px'],
		['calc(1rem + 2px)', 'calc(1rem + 2px)'],
	])('%s prints as %s', (css, expected) => {
		expect(formatLengthForDisplay(css)).toBe(expected);
	});
});

describe('swatchOf', () => {
	it('paints at full precision and prints every channel at three decimals', () => {
		expect(swatchOf({ l: 0.6231, c: 0.188456, h: 259.812345 })).toEqual({
			paint: 'oklch(0.6231 0.188456 259.812345)',
			text: 'oklch(0.623 0.188 259.812)',
		});
	});

	it('rounds chroma up when the fourth decimal says so', () => {
		expect(swatchOf({ l: 0.5, c: 0.1239, h: 30 }).text).toBe('oklch(0.5 0.124 30)');
	});

	it('prints a shadow alpha as a percentage at three decimals', () => {
		expect(swatchOf({ l: 0.2, c: 0.012345, h: 250, alpha: 0.123456 })).toEqual({
			paint: 'oklch(0.2 0.012345 250 / 12.3456%)',
			text: 'oklch(0.2 0.012 250 / 12.346%)',
		});
	});
});
