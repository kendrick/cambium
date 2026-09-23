/**
 * The consumer here is the Tailwind compiler, not a string and not even a CSS parser. What a
 * generated stylesheet has to do is survive being pasted into a project's `globals.css` and come
 * out the other side as utilities that paint. So most of what follows runs the real
 * `@tailwindcss/postcss` at the version this repo pins, hands it the output verbatim, and reads the
 * compiled utilities back: `.bg-background` has to resolve to a property this stylesheet declares,
 * and `dark:bg-background` has to land under `.dark` rather than inside a media query.
 *
 * That is the one check the adapters' own suites cannot make. Each of them proves its half parses
 * and names what it should; neither can say whether the pair works, because the failure is a
 * `var()` resolving to nothing, which parses cleanly and paints nothing. `#13`'s review found two
 * of those, and both are compiled here rather than argued.
 *
 * `source(none)` keeps the compile hermetic: Tailwind scans no files, so the candidates come from
 * the `@source inline(...)` line and the output is a function of this file alone. A whole compile
 * costs tens of milliseconds.
 */
import postcss, { type Declaration, parse, type Rule } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

import {
	declarationsBySelector,
	deepFreeze,
	PINNED_SET,
	setWithSemanticToken,
	VAR_REFERENCE,
} from './css.fixture';
import { cssNaming, toGlobalsCss } from './globals-css';
import { toStylesheet } from './stylesheet';
import { toThemeBlock } from './theme-block';

/**
 * A consumer's stylesheet: Tailwind, then whatever Cambium generated, pasted in as a consumer would
 * paste it. The candidate list stands in for the markup a real project would be scanned for.
 */
async function compile(generated: string, candidates: readonly string[]): Promise<string> {
	const input = `@import "tailwindcss" source(none);\n@source inline("${candidates.join(' ')}");\n${generated}`;
	const result = await postcss([tailwindcss({ base: import.meta.dirname })]).process(input, {
		from: undefined,
	});

	return result.css;
}

/** The one compiled rule whose selector starts with `selector`. */
function utilityRule(compiled: string, selector: string): Rule {
	const rules: Rule[] = [];
	parse(compiled).walkRules((rule) => {
		if (rule.selector.startsWith(selector)) rules.push(rule);
	});

	const [found] = rules;
	if (!found || rules.length !== 1) {
		throw new Error(`expected one rule for ${selector}, found ${rules.length}`);
	}

	return found;
}

/** The declarations of the one compiled utility whose selector starts with `selector`. */
function utility(compiled: string, selector: string): Declaration[] {
	const declarations: Declaration[] = [];
	utilityRule(compiled, selector).walkDecls((declaration) => {
		declarations.push(declaration);
	});

	return declarations;
}

/** Every at-rule a compiled rule sits inside, outermost first: `layer utilities`, `media …`. */
function enclosingAtRules(rule: Rule): string[] {
	const names: string[] = [];
	for (let node = rule.parent; node?.type === 'atrule'; node = node.parent) {
		names.unshift(`${node.name} ${node.params}`.trim());
	}

	return names;
}

/**
 * Every custom property a compiled utility reads, minus Tailwind's own `--tw-*` machinery, which it
 * declares itself through `@property` and which says nothing about this adapter.
 */
function propertiesRead(declarations: Declaration[]): string[] {
	return declarations.flatMap((declaration) =>
		[...declaration.value.matchAll(VAR_REFERENCE)]
			.map(([, property]) => property ?? '')
			.filter((property) => !property.startsWith('--tw-')),
	);
}

/**
 * Every custom property Tailwind's own theme declares in a compile, which is the set a pasted
 * stylesheet must not name. Tailwind emits a theme variable only where a candidate used it, so this
 * is scoped to the utilities `CANDIDATES` asks for rather than to the whole stock theme.
 */
function themeLayerProperties(compiled: string): string[] {
	const properties: string[] = [];
	parse(compiled).walkAtRules('layer', (layer) => {
		if (layer.params !== 'theme') return;
		layer.walkDecls((declaration) => {
			properties.push(declaration.prop);
		});
	});

	return properties;
}

/** Every custom property the generated stylesheet declares, under either selector. */
function declaredBy(generated: string): Set<string> {
	return new Set(
		[...declarationsBySelector(generated).values()].flatMap((declarations) =>
			declarations.map((declaration) => declaration.prop),
		),
	);
}

/**
 * One utility per namespace the token set registers, written the way a consumer writes them. The
 * expected property is a literal on purpose: it is the contract the two halves have to agree on,
 * and deriving it from either half would let both drift together.
 */
const UTILITIES = [
	{ candidate: 'bg-background', selector: '.bg-background', reads: '--background' },
	{ candidate: 'text-brand-500', selector: '.text-brand-500', reads: '--cmb-color-brand-500' },
	{ candidate: 'rounded-lg', selector: '.rounded-lg', reads: '--cmb-radius-lg' },
	{ candidate: 'tracking-normal', selector: '.tracking-normal', reads: '--cmb-tracking-normal' },
	{ candidate: 'shadow-md', selector: '.shadow-md', reads: '--cmb-shadow-md' },
];

const CANDIDATES = [...UTILITIES.map(({ candidate }) => candidate), 'dark:bg-background'];

describe('toStylesheet', () => {
	it('lays the file out the way app/globals.css does: variant, theme block, then the two schemes', () => {
		const root = parse(toStylesheet(PINNED_SET));
		const shape = root.nodes.map((node) =>
			node.type === 'atrule' ? `@${node.name} ${node.params}` : (node as Rule).selector,
		);

		expect(shape).toEqual([
			'@custom-variant dark (&:is(.dark *))',
			'@theme inline',
			':root',
			'.dark',
		]);
	});

	it('binds every dark: utility to the .dark class the stylesheet declares', async () => {
		const generated = toStylesheet(PINNED_SET);
		const compiled = await compile(generated, CANDIDATES);
		const dark = utilityRule(compiled, String.raw`.dark\:bg-background`);

		// Without the `@custom-variant` line, Tailwind's stock `dark` variant compiles to
		// `@media (prefers-color-scheme: dark)`, and a consumer's toggle would paint the class while
		// the page kept reading the light values. Both forms generate a rule for the candidate, so
		// the selector and what encloses it are what tell the two apart.
		expect(dark.selector).toBe(String.raw`.dark\:bg-background:is(.dark *)`);
		expect(enclosingAtRules(dark)).toEqual(['layer utilities']);
		expect(propertiesRead(utility(compiled, String.raw`.dark\:bg-background`))).toEqual([
			'--background',
		]);

		const declarations = declarationsBySelector(generated);
		expect(declarations.get('.dark')?.map((declaration) => declaration.prop)).toContain(
			'--background',
		);
	});

	it.each(UTILITIES)(
		'compiles $candidate down to a property the stylesheet declares',
		async ({ selector, reads }) => {
			const generated = toStylesheet(PINNED_SET);
			const compiled = await compile(generated, CANDIDATES);

			expect(propertiesRead(utility(compiled, selector))).toContain(reads);
			expect(declaredBy(generated)).toContain(reads);
		},
	);

	it('carries a caller-supplied prefix through both halves at once', async () => {
		const generated = toStylesheet(PINNED_SET, { prefix: 'acme' });
		const compiled = await compile(generated, CANDIDATES);
		const declared = declaredBy(generated);

		for (const { selector, reads } of UTILITIES) {
			const renamed = reads.replace('--cmb-', '--acme-');
			expect(propertiesRead(utility(compiled, selector))).toContain(renamed);
			expect(declared).toContain(renamed);
		}
	});

	it('is the only way to get the pair, because two halves under two prefixes paint nothing', async () => {
		// The hazard this entry point forecloses, compiled rather than argued, and assembled the only
		// way the types still allow: two `cssNaming` calls carrying two different prefixes. The pair
		// parses cleanly and every utility it feeds resolves to an undeclared property, which CSS
		// treats as invalid at computed-value time — no error anywhere, and no radius on the page.
		const mismatched = `${toThemeBlock(PINNED_SET, cssNaming({ prefix: 'acme' }))}${toGlobalsCss(PINNED_SET, cssNaming())}`;
		const compiled = await compile(mismatched, CANDIDATES);

		expect(propertiesRead(utility(compiled, '.rounded-lg'))).toEqual(['--acme-radius-lg']);
		expect(declaredBy(mismatched)).not.toContain('--acme-radius-lg');
		expect(declaredBy(mismatched)).toContain('--cmb-radius-lg');

		// The same utility off the one entry point reads a property that is there.
		const paired = toStylesheet(PINNED_SET, { prefix: 'acme' });
		expect(declaredBy(paired)).toContain('--acme-radius-lg');
	});

	it('takes one prefix for both halves, so neither can be called with a prefix of its own', () => {
		// The coupling as a type rather than as a comment. `toGlobalsCss(set)` paired with
		// `toThemeBlock(set, { prefix: 'acme' })` was the silent mismatch above, and it is now two
		// compile errors rather than a stylesheet that paints nothing. If the naming argument ever
		// goes back to being optional, this line stops erroring and `tsc` fails on the unused
		// expectation, which is the point of writing it as one.
		// @ts-expect-error - a naming is required, so a defaulted call cannot pair with a prefixed one
		expect(() => toGlobalsCss(PINNED_SET)).toThrow(TypeError);
		expect(() => toGlobalsCss(PINNED_SET, cssNaming())).not.toThrow();
	});

	it('names no property a Tailwind utility reads, and refuses a semantic token that would', async () => {
		const generated = toStylesheet(PINNED_SET);
		const compiled = await compile(generated, [...CANDIDATES, 'blur-sm']);

		// What a bare name costs when it lands inside a namespace, read off the compiler instead of
		// argued. `blur-sm` resolves its radius through `--blur-sm`, and a `:root` rule pasted into a
		// project is unlayered where Tailwind's own theme sits in `@layer theme`, so a semantic token
		// of that name would win the cascade and hand a blur an `oklch()` colour. CSS drops that at
		// computed-value time and logs nothing.
		expect(propertiesRead(utility(compiled, '.blur-sm'))).toContain('--blur-sm');
		expect(themeLayerProperties(compiled)).toContain('--blur-sm');

		// So nothing this stylesheet declares may be a name Tailwind's theme declares.
		for (const property of declaredBy(generated)) {
			expect(themeLayerProperties(compiled)).not.toContain(property);
		}

		// And the token that would break the rule is refused by name rather than emitted, on both
		// halves at once, because both name properties through the one `CssNaming`.
		expect(() => toStylesheet(setWithSemanticToken('blur-sm'))).toThrow(/--blur-sm/);
	});

	it('is a pure function of the token set: same set in, same bytes out, input untouched', () => {
		const frozen = deepFreeze(structuredClone(PINNED_SET));
		const before = structuredClone(PINNED_SET);

		expect(toStylesheet(PINNED_SET)).toBe(toStylesheet(PINNED_SET));
		expect(() => toStylesheet(frozen)).not.toThrow();
		expect(toStylesheet(frozen)).toBe(toStylesheet(PINNED_SET));
		expect(PINNED_SET).toEqual(before);
	});
});
