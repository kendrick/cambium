/**
 * Same reasoning as `globals-css.test.ts`: nothing here string-matches the emitted block. Every
 * assertion runs the output through postcss and reads the parsed declarations back off the tree,
 * because a string comparison passes on `@theme inline` text no browser would accept as well as it
 * does on text a browser would.
 *
 * The one check that is specific to this file is the cross-adapter one: every `var()` this module
 * writes has to name a property `toGlobalsCss` actually declares. `globals-css.test.ts` already
 * proved that file's own alias/var criterion is vacuous — it emits no `var()` at all — so that half
 * of criterion 5 has to be proved here, against the sibling adapter's real output, or it is never
 * proved anywhere.
 */
import { type Declaration, parse } from 'postcss';
import { describe, expect, it } from 'vitest';

import { derived } from '../provenance';
import { SEMANTIC_MAP } from '../semantic-map';
import { type Ramp, type SemanticEntry, type TokenSet, TokenSetSchema } from '../token-set';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from '../token-set.fixture';
import { toGlobalsCss } from './globals-css';
import { toThemeBlock } from './theme-block';

const EXTENSIONS = derived('keyColors', 'exercises a schema bound rather than a real derivation');

/** Same construction `globals-css.test.ts` uses: step n sits at lightness n/100. */
function ramp(hue: number, chroma: number, offset: number): Ramp {
	return Array.from({ length: 12 }, (_, index) => ({
		step: index + 1,
		l: (index + 1 + offset) / 100,
		c: chroma,
		h: hue,
		$extensions: EXTENSIONS,
	}));
}

function shadcnSemanticLayer(): Record<string, SemanticEntry> {
	return Object.fromEntries(
		Object.entries(SEMANTIC_MAP).map(([token, assignment]) => [
			token,
			{
				alias: typeof assignment === 'string' ? assignment : assignment.candidates[0],
				$extensions: EXTENSIONS,
			},
		]),
	);
}

const SEMANTIC = shadcnSemanticLayer();

const LIGHT_SCHEME = {
	primitives: { brand: ramp(260, 0.02, 0), neutral: ramp(250, 0.02, 0), danger: ramp(25, 0.02, 0) },
	semantic: SEMANTIC,
	shadow: SHADOW_FIXTURE,
};

const DARK_SCHEME = {
	primitives: {
		brand: ramp(260, 0.03, 50),
		neutral: ramp(250, 0.03, 50),
		danger: ramp(25, 0.03, 50),
	},
	semantic: SEMANTIC,
	shadow: SHADOW_FIXTURE,
};

/** Parsed rather than cast, for the reason `globals-css.test.ts` gives. */
const PINNED_SET: TokenSet = TokenSetSchema.parse({
	...LIGHT_SCHEME,
	schemes: { light: LIGHT_SCHEME, dark: DARK_SCHEME },
	...NON_COLOR_FIXTURE,
});

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const held of Object.values(value)) deepFreeze(held);
		Object.freeze(value);
	}
	return value;
}

/** Every declaration in an `@theme` at-rule, wherever postcss nested it. */
function themeDeclarations(css: string): Declaration[] {
	const root = parse(css);
	const declarations: Declaration[] = [];
	root.walkDecls((declaration) => {
		declarations.push(declaration);
	});
	return declarations;
}

function propertyNames(declarations: Declaration[]): string[] {
	// oxlint-disable-next-line unicorn/no-array-sort
	return declarations.map((declaration) => declaration.prop).sort();
}

/** Every `var(--x)` reference a declaration value makes. */
const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g;

function valueOf(declarations: Declaration[], property: string): string {
	const found = declarations.find((declaration) => declaration.prop === property);
	if (!found) throw new Error(`no ${property} declaration`);
	return found.value;
}

/**
 * Every property `toGlobalsCss` declares, under either selector.
 *
 * The union, not the intersection, is the right comparison: `:root`-only scalars like
 * `--cmb-radius-lg` are absent from `.dark`'s declarations because `.dark` inherits from `:root`,
 * not because the property does not exist. A theme entry naming one of those is correct, so
 * checking against light alone (or against an intersection) would fail entries this adapter is
 * right to emit.
 */
function declaredByGlobalsCss(tokenSet: TokenSet, options?: { prefix?: string }): Set<string> {
	const declared = new Set<string>();
	parse(toGlobalsCss(tokenSet, options)).walkDecls((declaration) => {
		declared.add(declaration.prop);
	});
	return declared;
}

const CONVENTIONAL_NUMBERS = [
	'25',
	'50',
	'100',
	'200',
	'300',
	'400',
	'500',
	'600',
	'700',
	'800',
	'900',
	'950',
];

const FIXTURE_RAMPS = ['brand', 'neutral', 'danger'];

describe('toThemeBlock', () => {
	it('parses as valid CSS holding one @theme inline at-rule', () => {
		const root = parse(toThemeBlock(PINNED_SET));

		expect(root.nodes).toHaveLength(1);
		const [atRule] = root.nodes;
		expect(atRule?.type).toBe('atrule');
		if (atRule?.type !== 'atrule') throw new Error('expected an at-rule');
		expect(atRule.name).toBe('theme');
		expect(atRule.params).toBe('inline');
	});

	it('registers the colour, radius, typography, tracking and shadow namespaces', () => {
		const names = propertyNames(themeDeclarations(toThemeBlock(PINNED_SET)));

		// Typography has no single Tailwind root: it fans out across sizes, weights and line
		// heights, so all three roots stand in for the one namespace criterion 3 names.
		expect(names.some((name) => name.startsWith('--color-'))).toBe(true);
		expect(names.some((name) => name.startsWith('--radius-'))).toBe(true);
		expect(names.some((name) => name.startsWith('--text-'))).toBe(true);
		expect(names.some((name) => name.startsWith('--font-weight-'))).toBe(true);
		expect(names.some((name) => name.startsWith('--leading-'))).toBe(true);
		expect(names.some((name) => name.startsWith('--tracking-'))).toBe(true);
		expect(names.some((name) => name.startsWith('--shadow-'))).toBe(true);
	});

	it('registers every semantic colour, bare, pointing at the bare property globals-css declares', () => {
		const declarations = themeDeclarations(toThemeBlock(PINNED_SET));

		for (const token of Object.keys(SEMANTIC_MAP)) {
			expect(valueOf(declarations, `--color-${token}`)).toBe(`var(--${token})`);
		}
	});

	it('numbers each ramp step by the conventional name, declared as data rather than computed inline', () => {
		const declarations = themeDeclarations(toThemeBlock(PINNED_SET));

		// Written as literals rather than imported from `step-numbers.ts`, the way
		// `globals-css.test.ts` treats the same table: importing the table under test would let a
		// wrong mapping pass on both sides at once.
		for (const rampName of FIXTURE_RAMPS) {
			for (const number of CONVENTIONAL_NUMBERS) {
				expect(valueOf(declarations, `--color-${rampName}-${number}`)).toBe(
					`var(--cmb-color-${rampName}-${number})`,
				);
			}
		}
	});

	it('gives the brand ramp its unnumbered alias, and gives no other ramp one', () => {
		const names = propertyNames(themeDeclarations(toThemeBlock(PINNED_SET)));

		expect(names).toContain('--color-brand');
		expect(valueOf(themeDeclarations(toThemeBlock(PINNED_SET)), '--color-brand')).toBe(
			'var(--cmb-color-brand)',
		);

		// Restricted to the ramp names, not the whole `--color-<word>` shape: a bare semantic token
		// like `--color-background` matches that shape too, and is a different kind of entry with a
		// different reason for being unnumbered.
		const unnumberedRampNames = names.filter((name) =>
			FIXTURE_RAMPS.some((rampName) => name === `--color-${rampName}`),
		);
		expect(unnumberedRampNames).toEqual(['--color-brand']);
	});

	it('registers every scalar the token set carries, mapped onto its Tailwind root', () => {
		const declarations = themeDeclarations(toThemeBlock(PINNED_SET));

		expect(valueOf(declarations, '--radius-lg')).toBe('var(--cmb-radius-lg)');
		expect(valueOf(declarations, '--text-base')).toBe('var(--cmb-text-base)');
		expect(valueOf(declarations, '--font-weight-regular')).toBe('var(--cmb-font-weight-regular)');
		expect(valueOf(declarations, '--leading-normal')).toBe('var(--cmb-leading-normal)');
		expect(valueOf(declarations, '--tracking-normal')).toBe('var(--cmb-tracking-normal)');
	});

	it('registers every shadow step', () => {
		const declarations = themeDeclarations(toThemeBlock(PINNED_SET));

		expect(valueOf(declarations, '--shadow-md')).toBe('var(--cmb-shadow-md)');
	});

	it('holds no literal value: every declaration is a var() reference', () => {
		const declarations = themeDeclarations(toThemeBlock(PINNED_SET));

		for (const declaration of declarations) {
			expect(/^var\(--[\w-]+\)$/.test(declaration.value)).toBe(true);
		}
	});

	it('references no property that toGlobalsCss does not also declare', () => {
		// Criterion 5's alias half is vacuous here the same way `globals-css.test.ts` notes it is
		// vacuous there, just with the two adapters swapped: this file emits no ramp.step alias at
		// all, so the assertion worth making is the var() one, against the sibling adapter's real
		// declarations rather than against this module's own naming.
		const declared = declaredByGlobalsCss(PINNED_SET);
		const declarations = themeDeclarations(toThemeBlock(PINNED_SET));

		for (const declaration of declarations) {
			for (const [, property] of declaration.value.matchAll(VAR_REFERENCE)) {
				expect(declared).toContain(property);
			}
		}
	});

	it('references no property that toGlobalsCss does not also declare, under a caller-supplied prefix', () => {
		const options = { prefix: 'acme' };
		const declared = declaredByGlobalsCss(PINNED_SET, options);
		const declarations = themeDeclarations(toThemeBlock(PINNED_SET, options));

		for (const declaration of declarations) {
			for (const [, property] of declaration.value.matchAll(VAR_REFERENCE)) {
				expect(declared).toContain(property);
			}
		}
	});

	it('carries a caller-supplied prefix everywhere but on the bare semantic colours', () => {
		const declarations = themeDeclarations(toThemeBlock(PINNED_SET, { prefix: 'acme' }));

		expect(valueOf(declarations, '--shadow-md')).toBe('var(--acme-shadow-md)');
		expect(valueOf(declarations, '--radius-lg')).toBe('var(--acme-radius-lg)');
		expect(valueOf(declarations, '--color-brand-500')).toBe('var(--acme-color-brand-500)');
		expect(valueOf(declarations, '--color-brand')).toBe('var(--acme-color-brand)');
		expect(valueOf(declarations, '--color-background')).toBe('var(--background)');
	});

	it('is a pure function of the token set: same set in, same bytes out, input untouched', () => {
		const frozen = deepFreeze(TokenSetSchema.parse(structuredClone(PINNED_SET)));
		const before = structuredClone(PINNED_SET);

		expect(toThemeBlock(PINNED_SET)).toBe(toThemeBlock(PINNED_SET));
		expect(() => toThemeBlock(frozen)).not.toThrow();
		expect(toThemeBlock(frozen)).toBe(toThemeBlock(PINNED_SET));
		expect(PINNED_SET).toEqual(before);
	});
});
