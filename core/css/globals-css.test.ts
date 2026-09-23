/**
 * Nothing here string-matches the emitted stylesheet. A browser never sees the string this adapter
 * returns; it sees whatever a CSS parser made of it, and an expected literal like
 * `':root {\n\t--background: oklch(1 0 0);\n}'` passes just as readily on output no parser accepts.
 * So every assertion about what the output says runs it through postcss and walks the tree it
 * built, and the property names, the selectors and the channel numbers are read back off that tree.
 * Two kinds never parse. The purity check compares two returned strings byte for byte, because
 * purity is a claim about bytes. The refusal checks read the thrown message, because a refused set
 * has no output to parse.
 *
 * The expected values are settled ahead of the emitter rather than read out of it. `PINNED_SET`
 * numbers its ramp steps so that step n sits at lightness n/100, and the assertions below name the
 * lightness each semantic token has to land on given the alias `SEMANTIC_MAP` assigns it. Deriving
 * those by resolving the alias in the test would be running the implementation twice and comparing
 * it with itself. The non-colour values are settled the same way: `NON_COLOR_FIXTURE` holds a
 * radius of 0.625rem, so `--cmb-radius-lg` has to read `0.625rem`.
 *
 * The property-name invariant is scoped rather than whole-block. Colours and shadows are
 * per-scheme and have to appear under both selectors; radius, type and tracking hold still across
 * the two and are declared once under `:root`. So each selector is compared against its own full
 * expected set. That is stricter than comparing the two selectors to each other, and it puts the
 * scalars under `:root` on the record as a decision rather than an omission.
 *
 * The token set and the postcss helpers come from `core/css/css.fixture.ts`, shared with the other
 * two CSS suites. What this file cannot reach from here is the pair: whether the properties it
 * checks are the ones the theme block points at, and whether Tailwind resolves them. That is
 * `core/css/stylesheet.test.ts`, which compiles the output rather than parsing it.
 */
import { parse } from 'postcss';
import { describe, expect, it } from 'vitest';

import { SEMANTIC_MAP } from '../semantic-map';
import { TokenSetSchema } from '../token-set';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from '../token-set.fixture';
import {
	CONVENTIONAL_NUMBERS,
	DARK_SCHEME,
	DARK_SHADOW_FIXTURE,
	declarationsBySelector,
	deepFreeze,
	FIXTURE_RAMPS,
	LIGHT_SCHEME,
	PINNED_SET,
	propertyNames,
	ramp,
	setWithName,
	SEMANTIC,
	sorted,
	valueOf,
} from './css.fixture';
import {
	cssNaming,
	declarationBlock,
	GENERATED_VOCABULARY,
	toGlobalsCss,
	type VocabularyCategory,
} from './globals-css';

/** `oklch(<l> <c> <h>)`: three space-separated numbers, no comma, no alpha slot. */
const OKLCH_TRIPLE = /^oklch\(([^\s]+) ([^\s]+) ([^\s]+)\)$/;

/**
 * CSS `box-shadow`'s longhand: four lengths in `<offset-x> <offset-y> <blur> <spread>` order, then
 * the colour. Capturing the five parts separately is what lets the assertions below name the order
 * a compositor reads them in. Comparing the whole value against one expected string would pass or
 * fail on the same bytes and say nothing about which part landed where.
 */
const BOX_SHADOW = /^(\S+) (\S+) (\S+) (\S+) (oklch\([^)]*\))$/;

/**
 * An alias the way `SemanticLayerSchema` spells one: a ramp name, a dot, a step number. Anchored on
 * a leading letter so it cannot match the fractional part of a number. `oklch(0.09 0.02 260)` has
 * no identifier before a dot, and `neutral.1` does.
 */
const RAMP_ALIAS = /[A-Za-z][\w-]*\.\d{1,2}/;

/** Every `var(--x)` reference a declaration value makes. */
const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g;

function channels(value: string): [number, number, number] {
	const match = OKLCH_TRIPLE.exec(value);
	if (!match) throw new Error(`not an oklch() triple: ${value}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** The property names criterion 1 asks for, taken off the contract rather than off the output. */
const EXPECTED_COLOR_PROPERTIES = sorted(Object.keys(SEMANTIC_MAP).map((token) => `--${token}`));

/**
 * The prefixed names, written out as literals rather than derived from the fixture, because they
 * are the contract `core/css/theme-block.ts` codes against: drop the `cmb-` and what is left is the
 * Tailwind v4 theme entry that adapter maps the property onto. `--cmb-text-base` pairs with
 * `--text-base`, `--cmb-font-weight-regular` with `--font-weight-regular`, and so on down the list.
 * Deriving them here from the same category-to-namespace table the emitter uses would leave a
 * renamed namespace passing on both sides.
 */
const EXPECTED_SHADOW_PROPERTIES = ['--cmb-shadow-md'];

const EXPECTED_SCALAR_PROPERTIES = [
	'--cmb-radius-lg',
	'--cmb-text-base',
	'--cmb-font-weight-regular',
	'--cmb-leading-normal',
	'--cmb-tracking-normal',
];

/**
 * Every ramp step, plus the one unnumbered alias. Strip the `cmb-` and what is left is the Tailwind
 * colour entry the theme block maps the property onto: `--cmb-color-brand-500` pairs with
 * `--color-brand-500`, the property behind `bg-brand-500`.
 *
 * `--cmb-color-brand` has no number because the brand colour is step 9, whose conventional name is
 * 700. A consumer reaching for `bg-brand-500` would get step 7 and a colour that is not the brand.
 */
const EXPECTED_RAMP_PROPERTIES = [
	...FIXTURE_RAMPS.flatMap((name) =>
		CONVENTIONAL_NUMBERS.map((number) => `--cmb-color-${name}-${number}`),
	),
	'--cmb-color-brand',
];

/** Colours and shadows are per-scheme; the scalars hold still and are declared under `:root` only. */
const EXPECTED_ROOT_PROPERTIES = sorted([
	...EXPECTED_COLOR_PROPERTIES,
	...EXPECTED_RAMP_PROPERTIES,
	...EXPECTED_SHADOW_PROPERTIES,
	...EXPECTED_SCALAR_PROPERTIES,
]);

const EXPECTED_DARK_PROPERTIES = sorted([
	...EXPECTED_COLOR_PROPERTIES,
	...EXPECTED_RAMP_PROPERTIES,
	...EXPECTED_SHADOW_PROPERTIES,
]);

describe('toGlobalsCss', () => {
	it('parses as valid CSS holding exactly the light and dark selectors', () => {
		const root = parse(toGlobalsCss(PINNED_SET, cssNaming()));
		const selectors: string[] = [];

		root.walkRules((rule) => {
			selectors.push(rule.selector);
		});

		// `app/globals.css` fixes the dark scheme to a class through `@custom-variant dark
		// (&:is(.dark *))`, so a `prefers-color-scheme` query would leave every `dark:` utility
		// Tailwind generates pointing somewhere this stylesheet never declares.
		expect(selectors).toEqual([':root', '.dark']);
		expect(root.nodes.every((node) => node.type === 'rule')).toBe(true);
	});

	it('declares every semantic token, every ramp step, every shadow and every scalar under :root', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));

		expect(propertyNames(byScheme.get(':root') ?? [])).toEqual(EXPECTED_ROOT_PROPERTIES);
	});

	// Asserted against the contract rather than against what the light selector happened to emit. A
	// token present in light and missing in dark is the defect this pair catches, and comparing the
	// two selectors to each other would report them as agreeing when both are short the same token.
	it('declares every semantic token, every ramp step and every shadow under the dark selector', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));

		expect(propertyNames(byScheme.get('.dark') ?? [])).toEqual(EXPECTED_DARK_PROPERTIES);
	});

	// The scoped form of the mirror invariant, said out loud so that widening the adapter later
	// cannot satisfy it by dropping a comparison. A scalar leaking into `.dark` is harmless today
	// and a divergence waiting to happen the moment somebody makes radius scheme-dependent, which
	// is the decision this layout forecloses.
	it('mirrors colours, ramps and shadows across both selectors and keeps the scalars to :root', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));
		const light = new Set(propertyNames(byScheme.get(':root') ?? []));
		const dark = new Set(propertyNames(byScheme.get('.dark') ?? []));

		for (const property of [
			...EXPECTED_COLOR_PROPERTIES,
			...EXPECTED_RAMP_PROPERTIES,
			...EXPECTED_SHADOW_PROPERTIES,
		]) {
			expect(light).toContain(property);
			expect(dark).toContain(property);
		}

		for (const property of EXPECTED_SCALAR_PROPERTIES) {
			expect(light).toContain(property);
			expect(dark).not.toContain(property);
		}
	});

	it('emits every semantic colour as an oklch() call', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));

		for (const declarations of byScheme.values()) {
			for (const property of EXPECTED_COLOR_PROPERTIES) {
				expect(OKLCH_TRIPLE.test(valueOf(declarations, property))).toBe(true);
			}
		}
	});

	it('resolves every alias, leaving no ramp.step reference in a declaration value', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));

		for (const declarations of byScheme.values()) {
			for (const declaration of declarations) {
				expect(RAMP_ALIAS.test(declaration.value)).toBe(false);
			}
		}
	});

	it('references no custom property it does not also declare', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));
		const declared = new Set(
			[...byScheme.values()].flatMap((declarations) =>
				declarations.map((declaration) => declaration.prop),
			),
		);

		for (const declarations of byScheme.values()) {
			for (const declaration of declarations) {
				for (const [, property] of declaration.value.matchAll(VAR_REFERENCE)) {
					expect(declared).toContain(property);
				}
			}
		}
	});

	it('takes each selector from its own scheme, so dark is not a copy of light', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));
		const light = byScheme.get(':root') ?? [];
		const dark = byScheme.get('.dark') ?? [];

		// `background` is `neutral.1`, `primary` is `brand.9`, `destructive` is `danger.11`. The
		// fixture pins step n at lightness n/100 in light and (n + 50)/100 in dark.
		expect(channels(valueOf(light, '--background'))).toEqual([0.01, 0.02, 250]);
		expect(channels(valueOf(dark, '--background'))).toEqual([0.51, 0.03, 250]);
		expect(channels(valueOf(light, '--primary'))).toEqual([0.09, 0.02, 260]);
		expect(channels(valueOf(dark, '--primary'))).toEqual([0.59, 0.03, 260]);
		expect(channels(valueOf(light, '--destructive'))).toEqual([0.11, 0.02, 25]);
		expect(channels(valueOf(dark, '--destructive'))).toEqual([0.61, 0.03, 25]);
	});

	it('numbers each ramp step the way a consumer expects rather than by its internal index', () => {
		const light = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming())).get(':root') ?? [];

		// `PINNED_SET` pins step n at lightness n/100, so the lightness a declaration carries names the
		// step it came from. 25 and 950 are the two ends of the ramp, 500 is the number most consumers
		// type, and 700 is the brand.
		expect(channels(valueOf(light, '--cmb-color-brand-25'))).toEqual([0.01, 0.02, 260]);
		expect(channels(valueOf(light, '--cmb-color-brand-500'))).toEqual([0.07, 0.02, 260]);
		expect(channels(valueOf(light, '--cmb-color-brand-700'))).toEqual([0.09, 0.02, 260]);
		expect(channels(valueOf(light, '--cmb-color-brand-950'))).toEqual([0.12, 0.02, 260]);

		// Every ramp is numbered off the same table, so `danger-500` is step 7 of danger, the step
		// `brand-500` is of brand.
		expect(channels(valueOf(light, '--cmb-color-danger-500'))).toEqual([0.07, 0.02, 25]);
		expect(channels(valueOf(light, '--cmb-color-neutral-950'))).toEqual([0.12, 0.02, 250]);
	});

	it('takes each ramp step from its own scheme, so bg-brand-500 moves under .dark', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));

		// The reason the ramps are declared under both selectors instead of once in the theme block:
		// `primitives` sits inside `ColorSchemeSchema`, so the two schemes hold different ramps, and a
		// theme entry holding a literal would freeze the light one onto the dark page.
		expect(channels(valueOf(byScheme.get(':root') ?? [], '--cmb-color-brand-500'))).toEqual([
			0.07, 0.02, 260,
		]);
		expect(channels(valueOf(byScheme.get('.dark') ?? [], '--cmb-color-brand-500'))).toEqual([
			0.57, 0.03, 260,
		]);
	});

	it('gives the brand colour an unnumbered name, and gives no other ramp one', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));
		const light = byScheme.get(':root') ?? [];
		const dark = byScheme.get('.dark') ?? [];

		// `BRAND_STEP` is 9 and step 9's conventional number is 700, so the brand colour answers to
		// `brand-700` while `bg-brand-500` lands on step 7. `--cmb-color-brand` is the name that holds
		// still if the numbering ever moves.
		expect(channels(valueOf(light, '--cmb-color-brand'))).toEqual([0.09, 0.02, 260]);
		expect(valueOf(light, '--cmb-color-brand')).toBe(valueOf(light, '--cmb-color-brand-700'));
		expect(valueOf(dark, '--cmb-color-brand')).toBe(valueOf(dark, '--cmb-color-brand-700'));

		// `SEMANTIC_MAP.primary` is `brand.9` as well, so the two names are two spellings of one
		// colour: `bg-primary` under shadcn's contract, `bg-brand` under the ramp's.
		expect(valueOf(light, '--cmb-color-brand')).toBe(valueOf(light, '--primary'));
		expect(valueOf(dark, '--cmb-color-brand')).toBe(valueOf(dark, '--primary'));

		// Nothing but brand. An unnumbered `--cmb-color-accent` would become `--color-accent`, a name
		// the semantic layer already claims for `SEMANTIC_MAP.accent`, which aliases `neutral.4`. The
		// other ramps are left out so the exception stays one name a reader can hold.
		const names = propertyNames(light);
		expect(names.filter((name) => /^--cmb-color-[a-z]+$/.test(name))).toEqual([
			'--cmb-color-brand',
		]);
	});

	it('writes each shadow as a box-shadow value taken from its own scheme', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming()));
		const light = BOX_SHADOW.exec(valueOf(byScheme.get(':root') ?? [], '--cmb-shadow-md'));
		const dark = BOX_SHADOW.exec(valueOf(byScheme.get('.dark') ?? [], '--cmb-shadow-md'));

		// `SHADOW_FIXTURE`: no horizontal offset, 4px down, 6px of blur, pulled in 1px, tinted at
		// alpha 0.1, which CSS Color 4 spells as a tenth of full opacity: `10%`.
		expect(light?.slice(1)).toEqual(['0px', '4px', '6px', '-1px', 'oklch(0.15 0.02 259.8 / 10%)']);
		// `DARK_SHADOW_FIXTURE` differs in the offset, the blur and the colour, so this row reading
		// as the light one above would mean the adapter took the top-level shadow copy.
		expect(dark?.slice(1)).toEqual(['0px', '8px', '12px', '-1px', 'oklch(0.02 0.01 275.5 / 45%)']);
	});

	it('writes each scheme-agnostic scalar at the value and unit the token set holds', () => {
		const root = declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming())).get(':root') ?? [];

		// Straight off `NON_COLOR_FIXTURE`. The weight and the line height are unitless, and every
		// dimension keeps its unit, including the tracking step sitting at zero. A bare `0` would be
		// a valid length too, and `0em` keeps the em readable in the export.
		expect(valueOf(root, '--cmb-radius-lg')).toBe('0.625rem');
		expect(valueOf(root, '--cmb-text-base')).toBe('1rem');
		expect(valueOf(root, '--cmb-font-weight-regular')).toBe('400');
		expect(valueOf(root, '--cmb-leading-normal')).toBe('1.5');
		expect(valueOf(root, '--cmb-tracking-normal')).toBe('0em');
	});

	it('prints a shadow geometry and the colour beside it at one precision', () => {
		// One `box-shadow` declaration carries four lengths and a colour, and until #13's review the
		// lengths and the channels went through two separate round-and-trim helpers with a comment
		// claiming they agreed. A third is a number with no exact binary form and no terminating
		// decimal, so it is the input that would separate two roundings: `0.333333px` beside
		// `oklch(0.333333 …)` is the two halves agreeing, and anything else is them disagreeing
		// inside a value a compositor reads as one thing.
		const third = 1 / 3;
		const shadow = {
			source: 'derived',
			values: {
				md: {
					...SHADOW_FIXTURE.values.md,
					blur: { value: third, unit: 'px' },
					color: { l: third, c: 0.02, h: 259.8, alpha: third },
				},
			},
		};
		const light = { ...LIGHT_SCHEME, shadow };
		const dark = { ...DARK_SCHEME, shadow };
		const set = TokenSetSchema.parse({
			...light,
			schemes: { light, dark },
			...NON_COLOR_FIXTURE,
		});

		const root = declarationsBySelector(toGlobalsCss(set, cssNaming())).get(':root') ?? [];
		const parts = BOX_SHADOW.exec(valueOf(root, '--cmb-shadow-md'));

		expect(parts?.[3]).toBe('0.333333px');
		expect(parts?.[5]).toBe('oklch(0.333333 0.02 259.8 / 33.333333%)');
	});

	it('carries a caller-supplied prefix everywhere but on the semantic colours', () => {
		const names = propertyNames(
			declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming({ prefix: 'acme' }))).get(
				':root',
			) ?? [],
		);

		expect(names).toContain('--acme-shadow-md');
		expect(names).toContain('--acme-radius-lg');
		// A ramp step is a colour and still takes the prefix, because its theme entry is
		// `--color-brand-500`, which sits inside Tailwind's colour namespace. A semantic name like
		// `--background` never does.
		expect(names).toContain('--acme-color-brand-500');
		expect(names).toContain('--acme-color-brand');
		// Bare and unprefixed is what makes the output drop-in for a shadcn project, whose own
		// components read `--background` by that name.
		expect(names).toContain('--background');
		expect(names.filter((name) => name.startsWith('--cmb-'))).toEqual([]);
	});

	it('refuses a prefix that leaves a non-colour property inside a Tailwind namespace', () => {
		// `@theme inline { --shadow-md: var(--shadow-md) }` reads itself: the theme entry and the
		// property it points at are one name, so the shadow resolves to nothing and every
		// `shadow-md` utility paints nothing, silently.
		expect(() => toGlobalsCss(PINNED_SET, cssNaming({ prefix: '' }))).toThrow(/--shadow-md/);
		// Not only the empty prefix. A prefix that is itself a namespace root walks the property
		// straight back inside one.
		expect(() => toGlobalsCss(PINNED_SET, cssNaming({ prefix: 'text' }))).toThrow(
			/--text-shadow-md/,
		);
	});

	it("refuses a tw prefix, which would declare Tailwind's own --tw-* state", () => {
		// `--tw-shadow` and `--tw-gradient-from` are properties Tailwind's utilities write and read
		// for themselves. A prefix of `tw` would put every prefixed property of ours in that space.
		for (const prefix of ['tw', 'tw-x', 'tw--x']) {
			expect(() => toGlobalsCss(PINNED_SET, cssNaming({ prefix }))).toThrow(`prefix "${prefix}"`);
		}

		// Only the `tw-` namespace itself. A prefix that merely starts with the letters is not in it.
		expect(() => toGlobalsCss(PINNED_SET, cssNaming({ prefix: 'twig' }))).not.toThrow();
	});

	it('takes a prefix with a run of hyphens inside it, and refuses one at either end', () => {
		// `stylesheet.test.ts` compiles `foo--bar` through Tailwind; this is only the shape rule.
		const names = propertyNames(
			declarationsBySelector(toGlobalsCss(PINNED_SET, cssNaming({ prefix: 'foo--bar' }))).get(
				':root',
			) ?? [],
		);
		expect(names).toContain('--foo--bar-shadow-md');

		for (const prefix of ['-foo', 'foo-', 'bad prefix', 'a:b']) {
			expect(() => cssNaming({ prefix })).toThrow(`prefix "${prefix}"`);
		}
	});

	/*
	 * The names #13's two reviews showed breaking a Tailwind consumer, every one of which passed
	 * the old shape check. `stylesheet.test.ts` compiles what each would have done; this is the
	 * refusal, which has to name both the token and the category it arrived in.
	 */
	it.each<{ category: VocabularyCategory; name: string }>([
		{ category: 'semantic token', name: 'base' },
		{ category: 'font weight', name: 'mono' },
		{ category: 'semantic token', name: 'sm' },
		{ category: 'semantic token', name: 'lg' },
		{ category: 'semantic token', name: 'inherit' },
		{ category: 'semantic token', name: 'transparent' },
		{ category: 'semantic token', name: 'center' },
		{ category: 'semantic token', name: 'fixed' },
		{ category: 'semantic token', name: 'tw-shadow' },
	])('refuses the $category "$name", which the generator never emits', ({ category, name }) => {
		const set = setWithName(category, name);

		expect(() => toGlobalsCss(set, cssNaming())).toThrow(`${category} "${name}"`);
	});

	// One foreign name per category, so a category left out of the check shows up as a set that
	// exports. `blur-sm` also sits in a Tailwind namespace, and the vocabulary refuses it first.
	it.each<{ category: VocabularyCategory; name: string }>([
		{ category: 'semantic token', name: 'blur-sm' },
		{ category: 'ramp', name: 'teal' },
		{ category: 'shadow step', name: 'huge' },
		{ category: 'radius step', name: 'pill' },
		{ category: 'type size', name: 'base--line-height' },
		{ category: 'font weight', name: 'black' },
		{ category: 'line height', name: 'loose' },
		{ category: 'tracking step', name: 'widest' },
	])('refuses a $category outside the vocabulary, naming it', ({ category, name }) => {
		expect(() => toGlobalsCss(setWithName(category, name), cssNaming())).toThrow(
			`${category} "${name}"`,
		);
	});

	it('accepts every name the generator emits, in every category', () => {
		// The other half of the whitelist: every name in it has to export. One set per category
		// carrying each accepted name; the fixture's own names are already in there, so a name the
		// fixture holds is re-added rather than duplicated.
		for (const [category, names] of Object.entries(GENERATED_VOCABULARY)) {
			for (const name of names) {
				expect(() =>
					toGlobalsCss(setWithName(category as VocabularyCategory, name), cssNaming()),
				).not.toThrow();
			}
		}
	});

	it('holds the whitelist to the generator vocabulary, category by category', () => {
		// Written out, because these are the names a consumer types and the list the whitelist has to
		// match. Deriving them from the generator here would compare the whitelist with itself.
		expect(GENERATED_VOCABULARY).toEqual({
			'semantic token': Object.keys(SEMANTIC_MAP),
			ramp: ['brand', 'accent', 'neutral', 'danger', 'warning', 'success', 'info'],
			'shadow step': ['xs', 'sm', 'md', 'lg', 'xl'],
			'radius step': ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'],
			'type size': ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'],
			'font weight': ['regular', 'medium', 'semibold', 'bold'],
			'line height': ['tight', 'snug', 'normal', 'relaxed'],
			'tracking step': ['tighter', 'tight', 'normal', 'wide', 'wider'],
		});
	});

	it('refuses a block that would declare one property twice', () => {
		// The vocabulary can't produce a repeat today, so this is reached directly: the backstop for
		// the day the vocabulary grows.
		expect(() =>
			declarationBlock(':root', [
				{ property: '--background', value: 'red' },
				{ property: '--background', value: 'blue' },
			]),
		).toThrow(/--background twice/);
	});

	it('is a pure function of the token set: same set in, same bytes out, input untouched', () => {
		const frozen = deepFreeze(TokenSetSchema.parse(structuredClone(PINNED_SET)));
		const before = structuredClone(PINNED_SET);

		expect(toGlobalsCss(PINNED_SET, cssNaming())).toBe(toGlobalsCss(PINNED_SET, cssNaming()));
		expect(() => toGlobalsCss(frozen, cssNaming())).not.toThrow();
		expect(toGlobalsCss(frozen, cssNaming())).toBe(toGlobalsCss(PINNED_SET, cssNaming()));
		expect(PINNED_SET).toEqual(before);
	});

	it('refuses a set whose two schemes name different semantic tokens', () => {
		const withoutRing = Object.fromEntries(
			Object.entries(SEMANTIC).filter(([token]) => token !== 'ring'),
		);
		const lopsided = TokenSetSchema.parse({
			...LIGHT_SCHEME,
			schemes: { light: LIGHT_SCHEME, dark: { ...DARK_SCHEME, semantic: withoutRing } },
			...NON_COLOR_FIXTURE,
		});

		// Emitting the union instead would put `--ring` under `:root` alone, and a dark page would
		// then paint the focus ring with the light scheme's colour and look like it rendered fine.
		// The fixture only bites if `ring` was there to remove; a no-op filter would leave the two
		// schemes mirrored and the throw would never be reached.
		expect(Object.keys(withoutRing)).toHaveLength(Object.keys(SEMANTIC).length - 1);
		expect(() => toGlobalsCss(lopsided, cssNaming())).toThrow(/ring/);
	});

	it('refuses a set whose two schemes name different shadow steps', () => {
		const renamedStep = {
			source: 'derived',
			values: { lg: DARK_SHADOW_FIXTURE.values.md },
		};
		const lopsided = TokenSetSchema.parse({
			...LIGHT_SCHEME,
			schemes: { light: LIGHT_SCHEME, dark: { ...DARK_SCHEME, shadow: renamedStep } },
			...NON_COLOR_FIXTURE,
		});

		// Same hazard as the semantic mirror one selector over: `--cmb-shadow-md` declared under
		// `:root` alone leaves a dark page casting a shadow tuned for a white one, with nothing
		// upstream to notice. `checkMirroredLayers` compares each scheme against the top level and
		// never puts the two schemes side by side.
		expect(() => toGlobalsCss(lopsided, cssNaming())).toThrow(/shadow steps/);
		expect(() => toGlobalsCss(lopsided, cssNaming())).toThrow(/md/);
	});

	it('refuses a set whose two schemes declare different ramps', () => {
		const withWarning = {
			...LIGHT_SCHEME,
			primitives: { ...LIGHT_SCHEME.primitives, warning: ramp(90, 0.02, 0) },
		};
		const lopsided = TokenSetSchema.parse({
			...withWarning,
			schemes: { light: withWarning, dark: DARK_SCHEME },
			...NON_COLOR_FIXTURE,
		});

		// The fixture only bites if the extra ramp survived the parse on one side and not the other.
		expect(Object.keys(lopsided.schemes.light.primitives)).toContain('warning');
		expect(Object.keys(lopsided.schemes.dark.primitives)).not.toContain('warning');

		// Emitting the union would leave `--cmb-color-warning-500` under `:root` alone, so every
		// `bg-warning-500` on a dark page would paint the light ramp's colour and look deliberate.
		// Nothing upstream compares the two schemes' ramps: `checkAliasesResolve` looks inside one
		// scheme and `checkMirroredLayers` compares the top level against light, so neither puts the
		// two side by side.
		expect(() => toGlobalsCss(lopsided, cssNaming())).toThrow(/ramp steps/);
		expect(() => toGlobalsCss(lopsided, cssNaming())).toThrow(/warning-500/);
	});
});
