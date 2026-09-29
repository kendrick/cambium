import { describe, expect, it } from 'vitest';

import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
	it('counts bytes below a kilobyte', () => {
		expect(formatBytes(0)).toBe('0 bytes');
		expect(formatBytes(1)).toBe('1 byte');
		expect(formatBytes(999)).toBe('999 bytes');
	});

	// Decimal units, the ones a browser's own site-data settings and `lib/bundle-budget.ts` use.
	it('switches to decimal units at each thousand', () => {
		expect(formatBytes(1000)).toBe('1 kB');
		expect(formatBytes(3_400_000)).toBe('3.4 MB');
		expect(formatBytes(1_250_000_000)).toBe('1.3 GB');
	});

	it('keeps one fractional digit at most', () => {
		expect(formatBytes(1_234_567)).toBe('1.2 MB');
	});
});
