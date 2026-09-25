import { describe, expect, it } from 'vitest';

import { DARK_SCHEME, deepFreeze, LIGHT_SCHEME, SEMANTIC } from './css/css.fixture';
import { resolveScheme } from './resolve-scheme';
import { type TokenSet, TokenSetSchema } from './token-set';
import { NON_COLOR_FIXTURE } from './token-set.fixture';
import {
	applyOverrides,
	overrideKey,
	type TokenOverride,
	TokenOverrideSchema,
	VALUE_CATEGORIES,
} from './token-overrides';

/**
 * `PINNED_SET`'s two schemes already differ in every primitive and in their shadows, but they share
 * one semantic layer, so an alias override written to the wrong scheme could land on a value the
 * other scheme already held. Dark `primary` is moved to `brand.10` here so no semantic entry reads
 * the same in both schemes by accident of the fixture.
 *
 * `BASE` is deep-frozen, so any write through to the input throws rather than passing quietly.
 */
const DARK_SEMANTIC = {
	...SEMANTIC,
	primary: { ...SEMANTIC.primary!, alias: 'brand.10' },
};

const BASE: TokenSet = deepFreeze(
	TokenSetSchema.parse({
		...LIGHT_SCHEME,
		schemes: { light: LIGHT_SCHEME, dark: { ...DARK_SCHEME, semantic: DARK_SEMANTIC } },
		...NON_COLOR_FIXTURE,
	}),
);

const SNAPSHOT = structuredClone(BASE);

function applied(overrides: readonly TokenOverride[]): TokenSet {
	const result = applyOverrides(BASE, overrides);

	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

	return result.tokenSet;
}

function aliasedTo(semantic: TokenSet['semantic'], alias: string): string[] {
	return Object.entries(semantic)
		.filter(([, entry]) => entry.alias === alias)
		.map(([token]) => token);
}

describe('applyOverrides', () => {
	it('returns an equal set when there is nothing to apply', () => {
		expect(applied([])).toEqual(BASE);
	});

	it('leaves the token set it was given untouched', () => {
		applied([
			{ kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand.4' },
			{ kind: 'primitive', scheme: 'dark', ramp: 'brand', step: 9, l: 0.7, c: 0.1, h: 30 },
			{ kind: 'value', category: 'radius', path: ['lg', 'value'], value: 1 },
			{
				kind: 'value',
				category: 'shadow',
				scheme: 'light',
				path: ['md', 'blur', 'value'],
				value: 9,
			},
		]);

		expect(BASE).toEqual(SNAPSHOT);
	});

	describe('alias overrides', () => {
		it('re-aliases a light token in the light scheme and its top-level mirror', () => {
			const set = applied([{ kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand.4' }]);

			expect(set.schemes.light.semantic.primary!.alias).toBe('brand.4');
			expect(set.semantic.primary!.alias).toBe('brand.4');
			expect(set.schemes.dark).toEqual(BASE.schemes.dark);
			expect(set.semantic.primary!.$extensions).toEqual(BASE.semantic.primary!.$extensions);

			const step4 = BASE.schemes.light.primitives.brand![3]!;
			expect(resolveScheme(set.schemes.light).primary).toEqual({
				l: step4.l,
				c: step4.c,
				h: step4.h,
			});
		});

		it('re-aliases a dark token without touching light or the mirror', () => {
			const set = applied([{ kind: 'alias', scheme: 'dark', token: 'primary', alias: 'brand.3' }]);

			expect(set.schemes.dark.semantic.primary!.alias).toBe('brand.3');
			expect(set.schemes.light).toEqual(BASE.schemes.light);
			expect(set.semantic).toEqual(BASE.semantic);
			expect(set.semantic.primary!.alias).toBe('brand.9');
		});
	});

	describe('primitive overrides', () => {
		const moved = { l: 0.7, c: 0.15, h: 30 };

		it('moves every light token aliased to the step, in the scheme and the mirror', () => {
			const tokens = aliasedTo(BASE.schemes.light.semantic, 'brand.9');
			expect(tokens.length).toBeGreaterThan(1);

			const set = applied([
				{ kind: 'primitive', scheme: 'light', ramp: 'brand', step: 9, ...moved },
			]);
			const light = resolveScheme(set.schemes.light);
			const mirror = resolveScheme(set);
			const before = resolveScheme(BASE.schemes.light);

			for (const token of Object.keys(light)) {
				const expected = { token, value: tokens.includes(token) ? moved : before[token] };
				expect({ token, value: light[token] }).toEqual(expected);
				expect({ token, value: mirror[token] }).toEqual(expected);
			}

			expect(set.schemes.light.primitives.brand![8]!.$extensions).toEqual(
				BASE.schemes.light.primitives.brand![8]!.$extensions,
			);
			expect(set.schemes.dark).toEqual(BASE.schemes.dark);
		});

		it('moves every dark token aliased to the step, leaving light and the mirror alone', () => {
			const tokens = aliasedTo(BASE.schemes.dark.semantic, 'brand.10');
			expect(tokens).toContain('primary');

			const set = applied([
				{ kind: 'primitive', scheme: 'dark', ramp: 'brand', step: 10, ...moved },
			]);
			const dark = resolveScheme(set.schemes.dark);
			const before = resolveScheme(BASE.schemes.dark);

			for (const token of Object.keys(dark)) {
				expect({ token, value: dark[token] }).toEqual({
					token,
					value: tokens.includes(token) ? moved : before[token],
				});
			}

			expect(set.schemes.light).toEqual(BASE.schemes.light);
			expect(set.primitives).toEqual(BASE.primitives);
		});
	});

	describe('value overrides', () => {
		it('replaces one leaf of a top-level category and keeps its unit and provenance', () => {
			const set = applied([{ kind: 'value', category: 'radius', path: ['lg', 'value'], value: 1 }]);

			expect(set.radius.values.lg).toEqual({ ...BASE.radius.values.lg, value: 1 });
		});

		it('addresses a nested group and a tuple slot', () => {
			const set = applied([
				{ kind: 'value', category: 'typography', path: ['weight', 'regular', 'value'], value: 600 },
				{ kind: 'value', category: 'motion', path: ['easing', 'standard', 'value', 1], value: 0.5 },
			]);

			expect(set.typography.values.weight.regular!.value).toBe(600);
			expect(set.motion.values.easing.standard!.value).toEqual([0.2, 0.5, 0, 1]);
		});

		it('writes a light shadow leaf to the light scheme and the mirror', () => {
			const set = applied([
				{
					kind: 'value',
					category: 'shadow',
					scheme: 'light',
					path: ['md', 'offsetY', 'value'],
					value: 10,
				},
			]);

			expect(set.schemes.light.shadow.values.md!.offsetY.value).toBe(10);
			expect(set.shadow.values.md!.offsetY.value).toBe(10);
			expect(set.schemes.dark).toEqual(BASE.schemes.dark);
		});

		it('writes a dark shadow leaf to the dark scheme only', () => {
			const set = applied([
				{
					kind: 'value',
					category: 'shadow',
					scheme: 'dark',
					path: ['md', 'color', 'alpha'],
					value: 0.9,
				},
			]);

			expect(set.schemes.dark.shadow.values.md!.color.alpha).toBe(0.9);
			expect(set.schemes.light).toEqual(BASE.schemes.light);
			expect(set.shadow).toEqual(BASE.shadow);
		});
	});

	describe('rejections name the offending override', () => {
		const rejected: [string, TokenOverride][] = [
			['a dangling alias', { kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand.13' }],
			[
				'an alias to an unknown ramp',
				{ kind: 'alias', scheme: 'dark', token: 'primary', alias: 'nope.3' },
			],
			['a malformed alias', { kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand' }],
			[
				'an alias for a token the set lacks',
				{ kind: 'alias', scheme: 'light', token: 'nope', alias: 'brand.3' },
			],
			[
				'a negative radius',
				{ kind: 'value', category: 'radius', path: ['lg', 'value'], value: -1 },
			],
			[
				'a lightness above 1',
				{ kind: 'primitive', scheme: 'light', ramp: 'brand', step: 9, l: 1.5, c: 0.1, h: 30 },
			],
			[
				'a step the ramp lacks',
				{ kind: 'primitive', scheme: 'dark', ramp: 'brand', step: 13, l: 0.5, c: 0.1, h: 30 },
			],
			[
				'a ramp the scheme lacks',
				{ kind: 'primitive', scheme: 'dark', ramp: 'constructor', step: 1, l: 0.5, c: 0.1, h: 30 },
			],
			['a path to nothing', { kind: 'value', category: 'radius', path: ['xl', 'value'], value: 1 }],
			[
				'a path to a non-numeric leaf',
				{ kind: 'value', category: 'radius', path: ['lg', 'unit'], value: 1 },
			],
			['a path to a whole token', { kind: 'value', category: 'radius', path: ['lg'], value: 1 }],
			[
				'a path into provenance',
				{ kind: 'value', category: 'radius', path: ['lg', '$extensions', 'com.cambium'], value: 1 },
			],
			[
				'a blur the dark shadow cannot take',
				{
					kind: 'value',
					category: 'shadow',
					scheme: 'dark',
					path: ['md', 'blur', 'value'],
					value: -2,
				},
			],
			[
				// The schema puts no ceiling on chroma, so only `toOklchCss`'s overflow guard would catch
				// this, and only mid-render, after the override already sat in the store.
				'a chroma too large for toOklchCss to print',
				{ kind: 'primitive', scheme: 'light', ramp: 'brand', step: 9, l: 0.5, c: 1e303, h: 30 },
			],
			[
				'a shadow colour chroma too large for toOklchCss to print',
				{
					kind: 'value',
					category: 'shadow',
					scheme: 'dark',
					path: ['md', 'color', 'c'],
					value: 1e303,
				},
			],
		];

		it.each(rejected)('rejects %s', (_label, override) => {
			const result = applyOverrides(BASE, [override]);

			expect(result).toMatchObject({ ok: false, key: overrideKey(override) });

			const issues = result.ok ? [] : result.issues;
			expect(issues).not.toHaveLength(0);
			expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
		});

		// The 'a path into provenance' case above can't catch a missing `$extensions` guard: its target
		// is an object, so the walk refuses it as not a numeric leaf either way. A foreign namespace
		// carrying a number is the one shape where only the guard stands between the override and the
		// payload, since `TokenExtensionsSchema` is loose and would happily re-parse the rewrite.
		it('refuses a numeric leaf inside $extensions, not just an object there', () => {
			const withForeign = TokenSetSchema.parse({
				...BASE,
				radius: {
					...BASE.radius,
					values: {
						lg: {
							...BASE.radius.values.lg,
							$extensions: { ...BASE.radius.values.lg!.$extensions, 'org.other': { rank: 3 } },
						},
					},
				},
			});
			const override: TokenOverride = {
				kind: 'value',
				category: 'radius',
				path: ['lg', '$extensions', 'org.other', 'rank'],
				value: 99,
			};

			const result = applyOverrides(withForeign, [override]);

			expect(result).toMatchObject({ ok: false, key: overrideKey(override) });
			expect(result.ok ? [] : result.issues.map((issue) => issue.message)).toEqual([
				expect.stringContaining('$extensions'),
			]);
		});

		it('refuses a chroma toOklchCss cannot print, naming the field, before anything is stored', () => {
			const override: TokenOverride = {
				kind: 'primitive',
				scheme: 'light',
				ramp: 'brand',
				step: 9,
				l: 0.5,
				c: 1e303,
				h: 30,
			};

			const result = applyOverrides(BASE, [override]);

			expect(result).toMatchObject({ ok: false, key: overrideKey(override) });
			expect(result.ok ? [] : result.issues.map((issue) => issue.message)).toEqual([
				expect.stringContaining('c 1e+303'),
			]);
		});

		it('names the invalid override rather than a valid one applied beside it', () => {
			const valid: TokenOverride = {
				kind: 'alias',
				scheme: 'light',
				token: 'primary',
				alias: 'brand.4',
			};
			const invalid: TokenOverride = {
				kind: 'value',
				category: 'radius',
				path: ['lg', 'value'],
				value: -1,
			};

			for (const order of [
				[valid, invalid],
				[invalid, valid],
			]) {
				expect(applyOverrides(BASE, order)).toMatchObject({ ok: false, key: overrideKey(invalid) });
			}
		});
	});
});

describe('overrideKey', () => {
	it('identifies the target, not the value written to it', () => {
		expect(
			overrideKey({ kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand.4' }),
		).toBe(overrideKey({ kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand.5' }));
		expect(
			overrideKey({
				kind: 'primitive',
				scheme: 'dark',
				ramp: 'brand',
				step: 9,
				l: 0.1,
				c: 0,
				h: 0,
			}),
		).toBe(
			overrideKey({
				kind: 'primitive',
				scheme: 'dark',
				ramp: 'brand',
				step: 9,
				l: 0.9,
				c: 0.2,
				h: 90,
			}),
		);
		expect(
			overrideKey({ kind: 'value', category: 'radius', path: ['lg', 'value'], value: 1 }),
		).toBe(overrideKey({ kind: 'value', category: 'radius', path: ['lg', 'value'], value: 2 }));
	});

	it('tells targets apart, including the same token in two schemes', () => {
		const keys = [
			overrideKey({ kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand.4' }),
			overrideKey({ kind: 'alias', scheme: 'dark', token: 'primary', alias: 'brand.4' }),
			overrideKey({ kind: 'primitive', scheme: 'light', ramp: 'brand', step: 9, l: 0, c: 0, h: 0 }),
			overrideKey({
				kind: 'primitive',
				scheme: 'light',
				ramp: 'brand',
				step: 10,
				l: 0,
				c: 0,
				h: 0,
			}),
			overrideKey({
				kind: 'value',
				category: 'shadow',
				scheme: 'light',
				path: ['md', 'blur', 'value'],
				value: 1,
			}),
			overrideKey({
				kind: 'value',
				category: 'shadow',
				scheme: 'dark',
				path: ['md', 'blur', 'value'],
				value: 1,
			}),
			// A dot inside a name must not let two different paths collide on one key.
			overrideKey({ kind: 'value', category: 'radius', path: ['a.b', 'value'], value: 1 }),
			overrideKey({ kind: 'value', category: 'radius', path: ['a', 'b.value'], value: 1 }),
		];

		expect(new Set(keys).size).toBe(keys.length);
	});

	// `applyOverrides` walks the path with property access, which reads `1` and `'1'` as the same
	// key, so a key that kept the segment's JS type would let two edits to one leaf sit side by side
	// in the store map and past the duplicate check in `BrandRecordSchema`.
	it('gives an index one key whether it is spelled as a number or a string', () => {
		const asNumber: TokenOverride = {
			kind: 'value',
			category: 'motion',
			path: ['easing', 'standard', 'value', 1],
			value: 0.3,
		};
		const asString: TokenOverride = { ...asNumber, path: ['easing', 'standard', 'value', '1'] };

		expect(applied([asString])).toEqual(applied([asNumber]));
		expect(overrideKey(asString)).toBe(overrideKey(asNumber));
		expect(
			overrideKey({ ...asNumber, category: 'shadow', scheme: 'dark', path: ['md', 'x', 0] }),
		).toBe(
			overrideKey({ ...asNumber, category: 'shadow', scheme: 'dark', path: ['md', 'x', '0'] }),
		);
	});
});

describe('TokenOverrideSchema', () => {
	const everyKind: TokenOverride[] = [
		{ kind: 'alias', scheme: 'dark', token: 'primary', alias: 'brand.3' },
		{ kind: 'primitive', scheme: 'light', ramp: 'brand', step: 9, l: 0.7, c: 0.1, h: 30 },
		{ kind: 'value', category: 'radius', path: ['lg', 'value'], value: 1 },
		{ kind: 'value', category: 'shadow', scheme: 'dark', path: ['md', 'blur', 'value'], value: 9 },
	];

	// The consumer of a parsed override is `applyOverrides`, so each kind the schema takes has to
	// land on `BASE` as the same edit the unparsed override makes.
	it.each(everyKind)(
		'parses a $kind override into one applyOverrides takes unchanged',
		(override) => {
			const parsed = TokenOverrideSchema.parse(override);

			expect(parsed).toEqual(override);
			expect(applied([parsed])).toEqual(applied([override]));
		},
	);

	// `write` reads a value override's target as `draft[category]`, so a category the schema takes
	// and the token set doesn't hold at the top level is an override that can never land. Shadow
	// is the ninth, carried by its own branch because it needs a scheme.
	it('takes exactly the non-colour categories a token set holds', () => {
		const colourLayers = new Set(['primitives', 'semantic', 'schemes']);
		const nonColour = Object.keys(TokenSetSchema.shape).filter((key) => !colourLayers.has(key));

		expect(new Set([...VALUE_CATEGORIES, 'shadow'])).toEqual(new Set(nonColour));
	});

	it.each([
		['a shadow leaf with no scheme', { kind: 'value', category: 'shadow', path: ['md'], value: 1 }],
		[
			'a colour layer used as a value category',
			{ kind: 'value', category: 'schemes', path: [], value: 1 },
		],
		['a category no token set holds', { kind: 'value', category: 'border', path: [], value: 1 }],
		['a scheme nobody derives', { kind: 'alias', scheme: 'sepia', token: 'primary', alias: 'b.1' }],
		[
			'a path segment that is neither a key nor an index',
			{ kind: 'value', category: 'radius', path: [true], value: 1 },
		],
		[
			'a value that is not a number',
			{ kind: 'value', category: 'radius', path: ['lg'], value: '1' },
		],
	])('refuses %s', (_name, override) => {
		expect(TokenOverrideSchema.safeParse(override).success).toBe(false);
	});
});
