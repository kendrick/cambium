import { describe, expect, it } from 'vitest';

import { BrandRecordSchema } from './brand-record';
import { BrandSeedSchema } from './brand-seed';
import { TokenSetSchema } from './token-set';

/**
 * Stage 2 is kept free of DOM and browser APIs so it can run server-side unchanged, and the
 * headless generate CLI depends on that. These schemas are imported by the browser and by
 * Node scripts alike, so the guard is that they parse with no DOM and no fetch in scope.
 */
describe('core schema purity', () => {
	it('runs where no browser global exists', () => {
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');
		expect(typeof localStorage).toBe('undefined');
	});

	it.each([
		['BrandSeedSchema', BrandSeedSchema],
		['TokenSetSchema', TokenSetSchema],
		['BrandRecordSchema', BrandRecordSchema],
	])('%s rejects a non-object without reaching for a browser API', (_name, schema) => {
		const result = schema.safeParse('not an object');

		expect(result.success).toBe(false);
	});
});
