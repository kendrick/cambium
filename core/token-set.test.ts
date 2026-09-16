import { describe, expect, it } from 'vitest';

import { TokenSetSchema } from './token-set';

const ramp = Array.from({ length: 12 }, (_, i) => ({
	step: i + 1,
	l: 0.05 + i * 0.08,
	c: 0.05,
	h: 259.8,
}));

const layer = { primitives: { brand: ramp, neutral: ramp }, semantic: { border: 'brand.6' } };

const validTokenSet = {
	primitives: { brand: ramp, neutral: ramp },
	semantic: { border: 'brand.6', primary: 'brand.9', foreground: 'neutral.12' },
	schemes: { light: layer, dark: layer },
};

describe('TokenSetSchema', () => {
	it('parses a set carrying primitives, a semantic layer, and both schemes', () => {
		const parsed = TokenSetSchema.parse(validTokenSet);

		expect(parsed.primitives.brand).toHaveLength(12);
		expect(Object.keys(parsed.schemes)).toEqual(['light', 'dark']);
	});

	it('rejects a ramp that is not twelve steps', () => {
		const short = { ...validTokenSet, primitives: { brand: ramp.slice(0, 9), neutral: ramp } };

		expect(TokenSetSchema.safeParse(short).success).toBe(false);
	});

	// Twelve entries all labelled step 1 satisfied the length check and the per-entry bounds,
	// which defeats the whole point of fixing the length: semantic roles address steps by
	// number, so a ramp can otherwise lack the very steps its aliases target.
	it('rejects twelve entries that are not steps 1 through 12 in order', () => {
		const duplicated = ramp.map((s) => ({ ...s, step: 1 }));

		const result = TokenSetSchema.safeParse({
			...validTokenSet,
			primitives: { brand: duplicated, neutral: ramp },
		});

		expect(result.success).toBe(false);
	});

	it('rejects an alias pointing at a ramp that does not exist', () => {
		const dangling = { ...validTokenSet, semantic: { border: 'missing.6' } };

		expect(TokenSetSchema.safeParse(dangling).success).toBe(false);
	});

	it('rejects an alias pointing at a step outside the ramp', () => {
		const offRamp = { ...validTokenSet, semantic: { border: 'brand.99' } };

		expect(TokenSetSchema.safeParse(offRamp).success).toBe(false);
	});

	it('rejects an alias that is not in ramp.step form', () => {
		const malformed = { ...validTokenSet, semantic: { border: '#0f172a' } };

		expect(TokenSetSchema.safeParse(malformed).success).toBe(false);
	});

	// A blank token set parsed clean and reached generation and export carrying nothing.
	it.each(['primitives', 'semantic'])('rejects an empty %s layer', (key) => {
		expect(TokenSetSchema.safeParse({ ...validTokenSet, [key]: {} }).success).toBe(false);
	});

	it('requires both schemes rather than deriving one from the other', () => {
		const { dark: _dropped, ...lightOnly } = validTokenSet.schemes;

		expect(TokenSetSchema.safeParse({ ...validTokenSet, schemes: lightOnly }).success).toBe(false);
	});

	it('cross-checks aliases inside each scheme, not just at the top level', () => {
		const badScheme = { ...layer, semantic: { border: 'missing.6' } };

		const result = TokenSetSchema.safeParse({
			...validTokenSet,
			schemes: { light: badScheme, dark: layer },
		});

		expect(result.success).toBe(false);
	});
});

describe('TokenSetSchema alias lookups', () => {
	// `primitives` is a plain object, so `primitives['constructor']` walks the prototype chain
	// and returns a truthy function whose `length` is 1. Both the existence check and the step
	// bound passed on inherited properties rather than on a ramp anyone declared.
	it.each(['constructor.1', 'toString.1', 'valueOf.1'])(
		'rejects %j, which resolves only through the prototype chain',
		(alias) => {
			const result = TokenSetSchema.safeParse({ ...validTokenSet, semantic: { border: alias } });

			expect(result.success).toBe(false);
		},
	);
});
