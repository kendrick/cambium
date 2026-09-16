import { describe, expect, it } from 'vitest';

import { TokenSetSchema } from './token-set';

const ramp = Array.from({ length: 12 }, (_, i) => ({
	step: i + 1,
	l: 0.05 + i * 0.08,
	c: 0.05,
	h: 259.8,
}));

const validTokenSet = {
	primitives: { brand: ramp, neutral: ramp },
	semantic: { border: 'brand.6', primary: 'brand.9', foreground: 'neutral.12' },
	schemes: {
		light: { primitives: { brand: ramp, neutral: ramp }, semantic: { border: 'brand.6' } },
		dark: { primitives: { brand: ramp, neutral: ramp }, semantic: { border: 'brand.6' } },
	},
};

describe('TokenSetSchema', () => {
	it('parses a set carrying primitives, a semantic layer, and both schemes', () => {
		const parsed = TokenSetSchema.parse(validTokenSet);

		expect(parsed.primitives.brand).toHaveLength(12);
		expect(Object.keys(parsed.schemes)).toEqual(['light', 'dark']);
	});

	// Step roles are positional: border is step 6, primary is step 9, foreground is step 12.
	// A ramp of any other length silently breaks every semantic alias downstream of it.
	it('rejects a ramp that is not twelve steps and names the offending path', () => {
		const shortRamp = { ...validTokenSet, primitives: { brand: ramp.slice(0, 9), neutral: ramp } };

		const result = TokenSetSchema.safeParse(shortRamp);

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path.slice(0, 2)).toEqual(['primitives', 'brand']);
	});

	it('requires both schemes rather than deriving one from the other', () => {
		const { dark: _dropped, ...lightOnly } = validTokenSet.schemes;

		const result = TokenSetSchema.safeParse({ ...validTokenSet, schemes: lightOnly });

		expect(result.success).toBe(false);
	});
});
