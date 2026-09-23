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
 *
 * That cross-adapter check stops at the property names. Whether Tailwind resolves them into
 * utilities that paint is `core/css/stylesheet.test.ts`, which runs the real compiler over the two
 * halves as one file.
 */
import { parse } from 'postcss';
import { describe, expect, it } from 'vitest';

import { SEMANTIC_MAP } from '../semantic-map';
import { type TokenSet, TokenSetSchema } from '../token-set';
import {
	allDeclarations,
	CONVENTIONAL_NUMBERS,
	deepFreeze,
	FIXTURE_RAMPS,
	PINNED_SET,
	propertyNames,
	setWithSemanticToken,
	valueOf,
	VAR_REFERENCE,
} from './css.fixture';
import { type CssNamingOptions, cssNaming, toGlobalsCss } from './globals-css';
import { toThemeBlock } from './theme-block';

/**
 * Every property `toGlobalsCss` declares, under either selector.
 *
 * The union, not the intersection, is the right comparison: `:root`-only scalars like
 * `--cmb-radius-lg` are absent from `.dark`'s declarations because `.dark` inherits from `:root`,
 * not because the property does not exist. A theme entry naming one of those is correct, so
 * checking against light alone (or against an intersection) would fail entries this adapter is
 * right to emit.
 */
function declaredByGlobalsCss(tokenSet: TokenSet, options: CssNamingOptions = {}): Set<string> {
	return new Set(
		allDeclarations(toGlobalsCss(tokenSet, cssNaming(options))).map(
			(declaration) => declaration.prop,
		),
	);
}

describe('toThemeBlock', () => {
	it('parses as valid CSS holding one @theme inline at-rule', () => {
		const root = parse(toThemeBlock(PINNED_SET, cssNaming()));

		expect(root.nodes).toHaveLength(1);
		const [atRule] = root.nodes;
		expect(atRule?.type).toBe('atrule');
		if (atRule?.type !== 'atrule') throw new Error('expected an at-rule');
		expect(atRule.name).toBe('theme');
		expect(atRule.params).toBe('inline');
	});

	it('registers the colour, radius, typography, tracking and shadow namespaces', () => {
		const names = propertyNames(allDeclarations(toThemeBlock(PINNED_SET, cssNaming())));

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
		const declarations = allDeclarations(toThemeBlock(PINNED_SET, cssNaming()));

		for (const token of Object.keys(SEMANTIC_MAP)) {
			expect(valueOf(declarations, `--color-${token}`)).toBe(`var(--${token})`);
		}
	});

	it('numbers each ramp step by the conventional name, declared as data rather than computed inline', () => {
		const declarations = allDeclarations(toThemeBlock(PINNED_SET, cssNaming()));

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
		const names = propertyNames(allDeclarations(toThemeBlock(PINNED_SET, cssNaming())));

		expect(names).toContain('--color-brand');
		expect(valueOf(allDeclarations(toThemeBlock(PINNED_SET, cssNaming())), '--color-brand')).toBe(
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
		const declarations = allDeclarations(toThemeBlock(PINNED_SET, cssNaming()));

		expect(valueOf(declarations, '--radius-lg')).toBe('var(--cmb-radius-lg)');
		expect(valueOf(declarations, '--text-base')).toBe('var(--cmb-text-base)');
		expect(valueOf(declarations, '--font-weight-regular')).toBe('var(--cmb-font-weight-regular)');
		expect(valueOf(declarations, '--leading-normal')).toBe('var(--cmb-leading-normal)');
		expect(valueOf(declarations, '--tracking-normal')).toBe('var(--cmb-tracking-normal)');
	});

	it('registers every shadow step', () => {
		const declarations = allDeclarations(toThemeBlock(PINNED_SET, cssNaming()));

		expect(valueOf(declarations, '--shadow-md')).toBe('var(--cmb-shadow-md)');
	});

	it('holds no literal value: every declaration is a var() reference', () => {
		const declarations = allDeclarations(toThemeBlock(PINNED_SET, cssNaming()));

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
		const declarations = allDeclarations(toThemeBlock(PINNED_SET, cssNaming()));

		for (const declaration of declarations) {
			for (const [, property] of declaration.value.matchAll(VAR_REFERENCE)) {
				expect(declared).toContain(property);
			}
		}
	});

	it('references no property that toGlobalsCss does not also declare, under a caller-supplied prefix', () => {
		const options = { prefix: 'acme' };
		const declared = declaredByGlobalsCss(PINNED_SET, options);
		const declarations = allDeclarations(toThemeBlock(PINNED_SET, cssNaming(options)));

		for (const declaration of declarations) {
			for (const [, property] of declaration.value.matchAll(VAR_REFERENCE)) {
				expect(declared).toContain(property);
			}
		}
	});

	it('carries a caller-supplied prefix everywhere but on the bare semantic colours', () => {
		const declarations = allDeclarations(toThemeBlock(PINNED_SET, cssNaming({ prefix: 'acme' })));

		expect(valueOf(declarations, '--shadow-md')).toBe('var(--acme-shadow-md)');
		expect(valueOf(declarations, '--radius-lg')).toBe('var(--acme-radius-lg)');
		expect(valueOf(declarations, '--color-brand-500')).toBe('var(--acme-color-brand-500)');
		expect(valueOf(declarations, '--color-brand')).toBe('var(--acme-color-brand)');
		expect(valueOf(declarations, '--color-background')).toBe('var(--background)');
	});

	it('refuses the empty prefix, which would point every entry at itself', () => {
		// `@theme inline { --color-brand-25: var(--color-brand-25) }` reads itself: the entry and the
		// property it points at are one name, so the colour resolves to nothing and every
		// `bg-brand-25` utility paints nothing, silently. `toGlobalsCss` threw on the empty prefix
		// from the start and this half emitted it, which is what naming both through one `CssNaming`
		// ends. The ramp entries come first here, so the ramp is the collision reported; in
		// `globals-css.test.ts` the shadow is, for the same reason in the other order.
		expect(() => toThemeBlock(PINNED_SET, cssNaming({ prefix: '' }))).toThrow(/--color-brand-25/);
		expect(() => toThemeBlock(PINNED_SET, cssNaming({ prefix: 'text' }))).toThrow(
			/--text-color-brand-25/,
		);
	});

	it('refuses a semantic token whose bare property lands inside a Tailwind namespace', () => {
		// The reference side of the same collision `globals-css.test.ts` checks on the declaring
		// side: this module would write `--color-blur-sm: var(--blur-sm)`, pointing at a property
		// Tailwind's own `blur-sm` utility reads. Both halves name properties through one
		// `CssNaming`, so both refuse it; a guard on one side only would leave the other emitting an
		// entry whose target the sibling refused to declare.
		expect(() => toThemeBlock(setWithSemanticToken('blur-sm'), cssNaming())).toThrow(/--blur-sm/);
	});

	it('is a pure function of the token set: same set in, same bytes out, input untouched', () => {
		const frozen = deepFreeze(TokenSetSchema.parse(structuredClone(PINNED_SET)));
		const before = structuredClone(PINNED_SET);

		expect(toThemeBlock(PINNED_SET, cssNaming())).toBe(toThemeBlock(PINNED_SET, cssNaming()));
		expect(() => toThemeBlock(frozen, cssNaming())).not.toThrow();
		expect(toThemeBlock(frozen, cssNaming())).toBe(toThemeBlock(PINNED_SET, cssNaming()));
		expect(PINNED_SET).toEqual(before);
	});
});
