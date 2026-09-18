import { describe, expect, it } from 'vitest';

import { SchemeSchema, TokenSetSchema } from './token-set';

const ramp = Array.from({ length: 12 }, (_, i) => ({
	step: i + 1,
	l: 0.05 + i * 0.08,
	c: 0.05,
	h: 259.8,
}));

const shadow = {
	source: 'derived',
	values: {
		md: {
			color: { l: 0.15, c: 0.01, h: 259.8, alpha: 0.1 },
			offsetX: { value: 0, unit: 'px' },
			offsetY: { value: 4, unit: 'px' },
			blur: { value: 6, unit: 'px' },
			spread: { value: -1, unit: 'px' },
		},
	},
};

/** Shadow is the one non-colour category that differs per scheme, so it is the one a scheme carries. */
const layer = {
	primitives: { brand: ramp, neutral: ramp },
	semantic: { border: 'brand.6' },
	shadow,
};

const nonColor = {
	radius: { source: 'derived', values: { lg: { value: 0.625, unit: 'rem' } } },
	typography: {
		source: 'derived',
		values: {
			size: { base: { value: 1, unit: 'rem' } },
			weight: { regular: 400 },
			lineHeight: { normal: 1.5 },
		},
	},
	tracking: { source: 'derived', values: { normal: { value: 0, unit: 'em' } } },
	spacing: { source: 'system', values: { md: { value: 1, unit: 'rem' } } },
	opacity: { source: 'system', values: { disabled: 0.5 } },
	motion: {
		source: 'system',
		values: {
			duration: { fast: { value: 150, unit: 'ms' } },
			easing: { standard: [0.2, 0, 0, 1] },
		},
	},
	focusRing: {
		source: 'system',
		values: { width: { value: 3, unit: 'px' }, offset: { value: 0, unit: 'px' } },
	},
	zIndex: { source: 'system', values: { modal: 1300 } },
};

const validTokenSet = {
	...layer,
	semantic: { border: 'brand.6', primary: 'brand.9', foreground: 'neutral.12' },
	schemes: { light: layer, dark: layer },
	...nonColor,
};

describe('TokenSetSchema', () => {
	it('parses a set carrying primitives, a semantic layer, both schemes, and every category', () => {
		const parsed = TokenSetSchema.parse(validTokenSet);

		expect(parsed.primitives.brand).toHaveLength(12);
		expect(Object.keys(parsed.schemes)).toEqual(['light', 'dark']);
		expect(parsed.radius.values.lg).toEqual({ value: 0.625, unit: 'rem' });
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

/**
 * The nine categories are persisted alongside the ramps, and four other tickets read them back. A
 * category the schema accepts in a shape nobody agreed on is a shape those tickets then have to
 * support, so the checks below are about the contract rather than about any one derivation.
 */
describe('TokenSetSchema non-colour categories', () => {
	const CATEGORIES = [
		'radius',
		'typography',
		'tracking',
		'shadow',
		'spacing',
		'opacity',
		'motion',
		'focusRing',
		'zIndex',
	] as const;

	it.each(CATEGORIES)('requires %s rather than treating it as optional', (name) => {
		const without: Record<string, unknown> = { ...validTokenSet };
		delete without[name];

		expect(TokenSetSchema.safeParse(without).success).toBe(false);
	});

	/**
	 * The discriminator is what makes "no system-constant category varies with the seed" a property
	 * of the value. A category that could claim either source, or none, would put that question back
	 * on a list somebody has to maintain.
	 */
	it.each([
		['radius', 'system'],
		['tracking', 'system'],
		['spacing', 'derived'],
		['zIndex', 'derived'],
	])('rejects %s claiming to be %s', (name, source) => {
		const swapped = {
			...validTokenSet,
			[name]: { ...(validTokenSet[name as keyof typeof validTokenSet] as object), source },
		};

		expect(TokenSetSchema.safeParse(swapped).success).toBe(false);
	});

	it('rejects a category carrying no source at all', () => {
		const { source: _dropped, ...unflagged } = nonColor.radius;

		expect(TokenSetSchema.safeParse({ ...validTokenSet, radius: unflagged }).success).toBe(false);
	});

	// Strict here for the same reason the outer shape is strict: a dimension written to disk with a
	// unit nobody declared is data lost on the way back out.
	it.each([
		['a unit outside px, rem and em', { value: 1, unit: 'pt' }],
		['a bare number where a dimension goes', 1],
		['a value that is not a number', { value: '1rem', unit: 'rem' }],
	])('rejects %s', (_name, value) => {
		const broken = { ...validTokenSet, radius: { source: 'derived', values: { lg: value } } };

		expect(TokenSetSchema.safeParse(broken).success).toBe(false);
	});

	it('rejects an opacity outside the 0 to 1 range', () => {
		const broken = { ...validTokenSet, opacity: { source: 'system', values: { disabled: 50 } } };

		expect(TokenSetSchema.safeParse(broken).success).toBe(false);
	});

	it('rejects an easing that is not four control points', () => {
		const broken = {
			...validTokenSet,
			motion: {
				source: 'system',
				values: { ...nonColor.motion.values, easing: { standard: [0.2, 0, 0] } },
			},
		};

		expect(TokenSetSchema.safeParse(broken).success).toBe(false);
	});

	it('rejects a shadow colour with no alpha, which is a shadow nobody can see through', () => {
		const { alpha: _dropped, ...opaque } = shadow.values.md.color;
		const broken = {
			...validTokenSet,
			shadow: { source: 'derived', values: { md: { ...shadow.values.md, color: opaque } } },
		};

		expect(TokenSetSchema.safeParse(broken).success).toBe(false);
	});

	it.each(CATEGORIES)('rejects an empty %s category', (name) => {
		const declared = { ...nonColor, shadow } as Record<string, { source: string }>;
		const emptied = { source: declared[name]!.source, values: {} };

		expect(TokenSetSchema.safeParse({ ...validTokenSet, [name]: emptied }).success).toBe(false);
	});
});

/**
 * Shadows differ between light and dark, so a single top-level value cannot serve both schemes. The
 * top level still carries the light shadow beside the light `primitives` and `semantic`, matching
 * `:root` in `app/globals.css`.
 */
describe('SchemeSchema', () => {
	it('requires a shadow scale alongside the colour layers', () => {
		const { shadow: _dropped, ...colourOnly } = layer;

		expect(SchemeSchema.safeParse(colourOnly).success).toBe(false);
		expect(SchemeSchema.safeParse(layer).success).toBe(true);
	});

	it('takes no category that does not vary by scheme', () => {
		const withRadius = { ...layer, radius: nonColor.radius };

		expect(SchemeSchema.safeParse(withRadius).success).toBe(false);
	});
});
