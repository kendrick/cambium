/**
 * The consumer here is the Tailwind compiler, not a string and not even a CSS parser. What a
 * generated stylesheet has to do is survive being pasted into a project's `globals.css` and come
 * out the other side as utilities wired to the properties it declares. So most of what follows
 * runs the real `@tailwindcss/postcss` at the version this repo pins, hands it the output verbatim,
 * and reads the compiled utilities back: `.bg-background` has to read a property this stylesheet
 * declares, and `dark:bg-background` has to land under `.dark` rather than inside a media query.
 *
 * That is the one check the adapters' own suites cannot make. Each of them proves its half parses
 * and names what it should; neither can say whether the pair works, because the failure is a
 * `var()` resolving to nothing, which parses cleanly and paints nothing. `#13`'s review found two
 * of those, and both are compiled here rather than argued.
 *
 * What a compile can see stops at selectors and property names. Tailwind passes a custom
 * property's value through unread, so nothing here sees a computed colour, and nothing here can
 * say what a nested `.dark` resolves to. That takes a browser computing styles, and
 * `e2e/stylesheet-dark.spec.ts` is where one does.
 *
 * `source(none)` keeps the compile hermetic: Tailwind scans no files, so the candidates come from
 * the `@source inline(...)` line and the output is a function of this file alone. A whole compile
 * costs tens of milliseconds.
 */
import postcss, { type Declaration, parse, type Rule } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

import type { TokenSet } from '../token-set';
import {
	allDeclarations,
	CONVENTIONAL_NUMBERS,
	declarationsBySelector,
	deepFreeze,
	GENERATED_SET,
	OUT_OF_BOUNDS,
	PINNED_SET,
	setWithName,
	setWithSemanticToken,
	VAR_REFERENCE,
	zodIssuePaths,
} from './css.fixture';
import { cssNaming, toGlobalsCss, type VocabularyCategory } from './globals-css';
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

/**
 * The declarations of the one compiled rule whose selector is exactly `selector`. The prefix match
 * above is ambiguous across a whole vocabulary, where `.bg-card` is also the start of
 * `.bg-card-foreground`.
 */
function exactUtility(compiled: string, selector: string): Declaration[] {
	const declarations: Declaration[] = [];
	let rules = 0;
	parse(compiled).walkRules((rule) => {
		if (rule.selector !== selector) return;
		rules += 1;
		rule.walkDecls((declaration) => {
			declarations.push(declaration);
		});
	});

	if (rules !== 1) throw new Error(`expected one rule for ${selector}, found ${rules}`);

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

/**
 * Every custom property the generated stylesheet's scheme rules declare, under `:root` or `.dark`.
 * The layered `:where(.dark)` rule redeclares Tailwind theme entries on purpose, so it is left
 * out: it names what the theme block names, and the checks that use this are about the scheme
 * rules.
 */
function declaredBy(generated: string): Set<string> {
	return new Set(
		[...declarationsBySelector(generated).values()].flatMap((declarations) =>
			declarations.map((declaration) => declaration.prop),
		),
	);
}

/**
 * What a consumer gets from a set: the stylesheet, or the refusal that replaces it.
 *
 * Caught rather than asserted with `toThrow`, so a test can hand whatever came out to the consumer
 * before it checks the refusal. Remove a guard and the test fails on what the consumer made of the
 * output, not just on a missing throw.
 */
function attempt(set: TokenSet, prefix?: string): { generated?: string; refusal?: string } {
	try {
		return { generated: toStylesheet(set, prefix === undefined ? {} : { prefix }) };
	} catch (error) {
		return { refusal: (error as Error).message };
	}
}

/**
 * Every property declared more than once inside a single parsed block. `:root` and `.dark`
 * repeating each other is the design, so a repeat only counts within one rule or at-rule.
 */
function repeatedWithinABlock(generated: string): string[] {
	const repeated: string[] = [];
	parse(generated).walk((node) => {
		if (node.type !== 'rule' && node.type !== 'atrule') return;
		const seen = new Set<string>();
		node.each((child) => {
			if (child.type !== 'decl') return;
			if (seen.has(child.prop)) repeated.push(child.prop);
			seen.add(child.prop);
		});
	});

	return repeated;
}

/**
 * One utility per Tailwind root the token set registers onto, written the way a consumer writes
 * them, and two for colour, whose semantic and ramp entries are named differently. Typography
 * counts three times because Tailwind splits it across `text`, `font-weight` and `leading`. The
 * expected property is a literal on purpose: it is the contract the two halves have to agree on,
 * and deriving it from either half would let both drift together.
 */
const UTILITIES = [
	{ candidate: 'bg-background', selector: '.bg-background', reads: '--background' },
	{ candidate: 'text-brand-500', selector: '.text-brand-500', reads: '--cmb-color-brand-500' },
	{ candidate: 'rounded-lg', selector: '.rounded-lg', reads: '--cmb-radius-lg' },
	{ candidate: 'text-base', selector: '.text-base', reads: '--cmb-text-base' },
	{ candidate: 'font-regular', selector: '.font-regular', reads: '--cmb-font-weight-regular' },
	{ candidate: 'leading-normal', selector: '.leading-normal', reads: '--cmb-leading-normal' },
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
			'@layer theme',
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

	it('is the only way to get the pair, because two halves under two prefixes strand every prefixed utility', async () => {
		// The hazard this entry point forecloses, compiled rather than argued, and assembled the only
		// way the types still allow: two `cssNaming` calls carrying two different prefixes. The pair
		// parses cleanly and every prefixed utility it feeds reads an undeclared property, which CSS
		// treats as invalid at computed-value time — no error anywhere, and no radius on the page.
		// The semantic utilities carry no prefix and survive, which is what makes the mismatch easy
		// to miss on a page that shows mostly `bg-background`.
		const mismatched = `${toThemeBlock(PINNED_SET, cssNaming({ prefix: 'acme' }))}${toGlobalsCss(PINNED_SET, cssNaming())}`;
		const compiled = await compile(mismatched, CANDIDATES);

		expect(propertiesRead(utility(compiled, '.rounded-lg'))).toEqual(['--acme-radius-lg']);
		expect(declaredBy(mismatched)).not.toContain('--acme-radius-lg');
		expect(declaredBy(mismatched)).toContain('--cmb-radius-lg');
		expect(propertiesRead(utility(compiled, '.bg-background'))).toEqual(['--background']);
		expect(declaredBy(mismatched)).toContain('--background');

		// The same utility off the one entry point reads a property that is there.
		const paired = toStylesheet(PINNED_SET, { prefix: 'acme' });
		expect(declaredBy(paired)).toContain('--acme-radius-lg');
	});

	it('takes one prefix for both halves, so neither can be called with a prefix of its own', () => {
		// The coupling as a type rather than as a comment. `toGlobalsCss(set)` paired with
		// `toThemeBlock(set, { prefix: 'acme' })` was the silent mismatch above, and it is now two
		// compile errors rather than a stylesheet whose prefixed utilities paint nothing. If the
		// naming argument ever goes back to being optional, this line stops erroring and `tsc` fails
		// on the unused expectation, which is the point of writing it as one.
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

		// And a set carrying that token is refused, naming it, because the generator never emits it.
		expect(() => toStylesheet(setWithSemanticToken('blur-sm'))).toThrow('semantic token "blur-sm"');
	});

	/*
	 * The refusal cases below share one property: every name the pair emits reaches the consumer as
	 * exactly the property it was written as. Each one takes the adapter's refusal or its output,
	 * whichever it gives, and runs the consumer over the output first. So with the guard gone, the
	 * test fails on what PostCSS or Tailwind made of the stylesheet, not just on a missing throw.
	 */

	it.each([
		{
			label: 'a semantic token',
			set: () => setWithSemanticToken('has space'),
			prefix: undefined,
			offender: 'has space',
		},
		{ label: 'a prefix', set: () => PINNED_SET, prefix: 'bad prefix', offender: 'bad prefix' },
	])(
		'refuses $label that leaves a property name no CSS parser reads',
		({ set, prefix, offender }) => {
			const { generated, refusal } = attempt(set(), prefix);

			expect(() => parse(generated ?? '')).not.toThrow();
			expect(refusal).toContain(offender);
		},
	);

	it('refuses a type size that Tailwind would read as another size’s line height', async () => {
		// Tailwind reads a `--` in a `--text-*` theme key as a companion of the key before it, so a
		// size named `base--line-height` would become `text-base`'s line height rather than a size.
		const { generated, refusal } = attempt(setWithName('type size', 'base--line-height'));
		const compiled = generated === undefined ? undefined : await compile(generated, ['text-base']);
		const read = compiled === undefined ? [] : propertiesRead(utility(compiled, '.text-base'));

		expect(read).not.toContain('--cmb-text-base--line-height');
		expect(refusal).toContain('type size "base--line-height"');
	});

	it.each([
		{ token: 'brand-500', shares: 'ramp step 7, on --color-brand-500' },
		{ token: 'brand', shares: 'the brand alias, on --color-brand' },
		{ token: 'cmb-color-brand-500', shares: 'ramp step 7, on --cmb-color-brand-500 under :root' },
	])('refuses a semantic token $token that would share a property with $shares', ({ token }) => {
		// Tailwind keeps the last of two same-named theme entries and a browser the last of two
		// same-named declarations, so one of the two tokens loses its utility with nothing logged.
		const { generated, refusal } = attempt(setWithSemanticToken(token));

		expect(generated === undefined ? [] : repeatedWithinABlock(generated)).toEqual([]);
		expect(refusal).toContain(`semantic token "${token}"`);
	});

	/*
	 * The names #13's reviews showed breaking a consumer, each run the way the cases above run:
	 * whatever the adapter hands back is compiled first, and the utility the name would have broken
	 * has to come out reading Cambium's property. So with the whitelist gone, the first five cases
	 * fail on what Tailwind made of the stylesheet, not only on a missing refusal.
	 *
	 * `tw-shadow` is the exception. `.shadow-md` compiles to the same bytes either way, because the
	 * damage is a cascade collision on the element, which only a browser resolves. Its `intact`
	 * passes unconditionally, and the case fails on the adapter's own output declaring
	 * `--tw-shadow`.
	 */
	it.each<{
		category: VocabularyCategory;
		name: string;
		candidate: string;
		selector: string;
		intact: (declarations: Declaration[]) => boolean;
	}>([
		{
			// `.text-base` turns into `color: var(--base)` and the size is gone.
			category: 'semantic token',
			name: 'base',
			candidate: 'text-base',
			selector: '.text-base',
			intact: (declarations) => propertiesRead(declarations).includes('--cmb-text-base'),
		},
		{
			// `.font-mono` stays `font-family: var(--font-mono)`, and the weight has no utility.
			category: 'font weight',
			name: 'mono',
			candidate: 'font-mono',
			selector: '.font-mono',
			intact: (declarations) => propertiesRead(declarations).includes('--cmb-font-weight-mono'),
		},
		{
			// `.text-sm` turns into a colour.
			category: 'semantic token',
			name: 'sm',
			candidate: 'text-sm',
			selector: '.text-sm',
			intact: (declarations) => !propertiesRead(declarations).includes('--sm'),
		},
		{
			// `bg-inherit` compiles to the CSS keyword and never reads the token.
			category: 'semantic token',
			name: 'inherit',
			candidate: 'bg-inherit',
			selector: '.bg-inherit',
			intact: (declarations) => propertiesRead(declarations).includes('--inherit'),
		},
		{
			// `bg-center` sets a colour and a background position at once.
			category: 'semantic token',
			name: 'center',
			candidate: 'bg-center',
			selector: '.bg-center',
			intact: (declarations) => !propertiesRead(declarations).includes('--center'),
		},
		{
			// `--tw-shadow` is the property `shadow-md` itself writes and reads back.
			category: 'semantic token',
			name: 'tw-shadow',
			candidate: 'shadow-md',
			selector: '.shadow-md',
			intact: () => true,
		},
	])(
		'refuses the $category "$name" before Tailwind can misread it',
		async ({ category, name, candidate, selector, intact }) => {
			const { generated, refusal } = attempt(setWithName(category, name));
			const compiled = generated === undefined ? undefined : await compile(generated, [candidate]);
			const broken = compiled !== undefined && !intact(utility(compiled, selector));
			const declared = allDeclarations(generated ?? '').map(({ prop }) => prop);

			expect(broken).toBe(false);
			expect(declared).not.toContain('--tw-shadow');
			expect(refusal).toContain(`${category} "${name}"`);
		},
	);

	it('emits no --tw-* property, whatever prefix it is given', () => {
		// `--tw-*` is Tailwind's own utility state. The vocabulary keeps semantic names out of it and
		// `cssNaming` keeps prefixes out of it; this is the output-level check on both.
		for (const prefix of [undefined, 'acme', 'twig', 'foo--bar']) {
			const { generated } = attempt(GENERATED_SET, prefix);
			const properties = allDeclarations(generated ?? '').map(({ prop }) => prop);

			expect(properties.length).toBeGreaterThan(0);
			expect(properties.filter((property) => property.startsWith('--tw-'))).toEqual([]);
		}

		for (const prefix of ['tw', 'tw-cmb']) {
			const { generated, refusal } = attempt(GENERATED_SET, prefix);
			const properties = allDeclarations(generated ?? '').map(({ prop }) => prop);

			expect(properties.filter((property) => property.startsWith('--tw-'))).toEqual([]);
			expect(refusal).toContain(`prefix "${prefix}"`);
		}
	});

	it('wires every utility up under a prefix holding a run of hyphens', async () => {
		// The one relaxation of the prefix rule, compiled: a `--` in a prefix lands in raw
		// properties, never in a theme key, so Tailwind reads nothing into it.
		const generated = toStylesheet(PINNED_SET, { prefix: 'foo--bar' });
		const compiled = await compile(generated, CANDIDATES);

		for (const { selector, reads } of UTILITIES) {
			const renamed = reads.replace('--cmb-', '--foo--bar-');
			expect(propertiesRead(utility(compiled, selector))).toContain(renamed);
			expect(declaredBy(generated)).toContain(renamed);
		}
	});

	/*
	 * The whitelist is only as sound as the vocabulary it admits. This compiles the generator's own
	 * output, every name in every category, and checks each utility a consumer would write for it
	 * reads Cambium's property and nothing Tailwind owns. A name added to the generator that
	 * collides the way `base` or `mono` did fails here.
	 */
	it('compiles every name the generator emits onto the property this stylesheet declares', async () => {
		const generated = toStylesheet(GENERATED_SET);
		const { light } = GENERATED_SET.schemes;
		const { size, weight, lineHeight } = GENERATED_SET.typography.values;

		const expected = [
			...Object.keys(light.semantic).map((name) => [`bg-${name}`, `--${name}`]),
			...Object.keys(light.primitives).flatMap((name) =>
				CONVENTIONAL_NUMBERS.map((number) => [
					`bg-${name}-${number}`,
					`--cmb-color-${name}-${number}`,
				]),
			),
			['bg-brand', '--cmb-color-brand'],
			...Object.keys(light.shadow.values).map((name) => [`shadow-${name}`, `--cmb-shadow-${name}`]),
			...Object.keys(GENERATED_SET.radius.values).map((name) => [
				`rounded-${name}`,
				`--cmb-radius-${name}`,
			]),
			...Object.keys(size).map((name) => [`text-${name}`, `--cmb-text-${name}`]),
			...Object.keys(weight).map((name) => [`font-${name}`, `--cmb-font-weight-${name}`]),
			...Object.keys(lineHeight).map((name) => [`leading-${name}`, `--cmb-leading-${name}`]),
			...Object.keys(GENERATED_SET.tracking.values).map((name) => [
				`tracking-${name}`,
				`--cmb-tracking-${name}`,
			]),
		] as const;

		// A generated set that came back short would make every loop below vacuous. 26 semantic
		// colours, 7 ramps of 12 steps plus the brand alias, 5 shadows, 7 radii, 8 sizes, 4 weights,
		// 4 line heights and 5 tracking steps.
		expect(expected).toHaveLength(26 + 7 * 12 + 1 + 5 + 7 + 8 + 4 + 4 + 5);

		const compiled = await compile(
			generated,
			expected.map(([candidate]) => candidate),
		);
		const declared = declaredBy(generated);

		// Collected rather than asserted one by one, so a failure names every utility that broke.
		const miswired: string[] = [];
		for (const [candidate, property] of expected) {
			const read = propertiesRead(exactUtility(compiled, `.${candidate}`));
			if (!read.includes(property)) miswired.push(`${candidate} does not read ${property}`);
			if (!declared.has(property)) miswired.push(`${candidate}: ${property} is not declared`);

			// Anything else a utility reads is Tailwind's, and the one expected case is a size's
			// line-height companion from the stock theme, which Cambium doesn't set.
			const companion = `--${candidate}--line-height`;
			for (const other of read.filter((each) => !declared.has(each))) {
				if (!(candidate.startsWith('text-') && other === companion)) {
					miswired.push(`${candidate} also reads ${other}`);
				}
			}
		}
		expect(miswired).toEqual([]);

		for (const property of declared) {
			expect(themeLayerProperties(compiled)).not.toContain(property);
			expect(property.startsWith('--tw-')).toBe(false);
		}
		expect(repeatedWithinABlock(generated)).toEqual([]);
	});

	it('is a pure function of the token set: same set in, same bytes out, input untouched', () => {
		const frozen = deepFreeze(structuredClone(PINNED_SET));
		const before = structuredClone(PINNED_SET);

		expect(toStylesheet(PINNED_SET)).toBe(toStylesheet(PINNED_SET));
		expect(() => toStylesheet(frozen)).not.toThrow();
		expect(toStylesheet(frozen)).toBe(toStylesheet(PINNED_SET));
		expect(PINNED_SET).toEqual(before);
	});

	it.each(OUT_OF_BOUNDS)('refuses a $bound through the schema, naming $path', ({ path, set }) => {
		expect(zodIssuePaths(() => toStylesheet(set))).toContain(path);
	});
});
