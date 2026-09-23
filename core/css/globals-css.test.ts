/**
 * Nothing here string-matches the emitted stylesheet. A browser never sees the string this adapter
 * returns; it sees whatever a CSS parser made of it, and an expected literal like
 * `':root {\n\t--background: oklch(1 0 0);\n}'` passes just as readily on output no parser accepts.
 * So every assertion runs the output through postcss and walks the tree it built, and the property
 * names, the selectors and the channel numbers are read back off that tree.
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
 */
import { type Declaration, parse } from 'postcss';
import { describe, expect, it } from 'vitest';

import { derived } from '../provenance';
import { SEMANTIC_MAP } from '../semantic-map';
import { type Ramp, type SemanticEntry, type TokenSet, TokenSetSchema } from '../token-set';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from '../token-set.fixture';
import { toGlobalsCss } from './globals-css';

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

const EXTENSIONS = derived('keyColors', 'exercises a schema bound rather than a real derivation');

/**
 * A ramp whose step numbers are legible in the output: step n sits at lightness `(n + offset)/100`,
 * so a declaration's lightness names the step it came from and the two schemes never collide.
 *
 * Integer division by 100 is deliberate. IEEE division is correctly rounded, so `9/100` lands on
 * the same double the literal `0.09` parses to, and the assertions below compare decimal literals
 * against what the parser read back with no tolerance at all. Accumulating a step's lightness by
 * repeated addition carries no such guarantee.
 */
function ramp(hue: number, chroma: number, offset: number): Ramp {
	return Array.from({ length: 12 }, (_, index) => ({
		step: index + 1,
		l: (index + 1 + offset) / 100,
		c: chroma,
		h: hue,
		$extensions: EXTENSIONS,
	}));
}

/**
 * The whole shadcn contract as a semantic layer: one entry per `SEMANTIC_MAP` key, so the adapter
 * meets the token set a generated theme actually hands it rather than a five-token sample.
 *
 * A `ContrastingPair` takes its first candidate. Which of the two a real scheme keeps is
 * `semantic-layer.ts`'s contrast decision, and it changes nothing this file measures, because
 * either way the layer holds one plain alias under that name.
 */
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

/**
 * The dark scheme's shadow, differing from `SHADOW_FIXTURE` in its colour, its vertical offset and
 * its blur.
 *
 * `checkMirroredLayers` pins the top-level `shadow` to `schemes.light.shadow`, so a set carries two
 * distinguishable shadows and only one of them is reachable from the top level. Reading the top
 * level would therefore paint the light scheme's shadow under `.dark` and look entirely healthy.
 * These three differences are what make that substitution visible.
 */
const DARK_SHADOW_FIXTURE = {
	source: 'derived',
	values: {
		md: {
			...SHADOW_FIXTURE.values.md,
			color: { l: 0.02, c: 0.01, h: 275.5, alpha: 0.45 },
			offsetY: { value: 8, unit: 'px' },
			blur: { value: 12, unit: 'px' },
		},
	},
} as const;

/** Light steps run 0.01 to 0.12; dark steps run 0.51 to 0.62. Chroma separates them a second way. */
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
	shadow: DARK_SHADOW_FIXTURE,
};

/**
 * Parsed rather than cast, so the fixture is a token set the schema accepts instead of one the
 * compiler was told to believe in. The parse also rebuilds the structure, which keeps `deepFreeze`
 * below from freezing anything the module-level literals still share.
 */
const PINNED_SET: TokenSet = TokenSetSchema.parse({
	...LIGHT_SCHEME,
	schemes: { light: LIGHT_SCHEME, dark: DARK_SCHEME },
	...NON_COLOR_FIXTURE,
});

/** The declarations postcss found under each selector, keyed by the selector it parsed. */
function declarationsBySelector(css: string): Map<string, Declaration[]> {
	const found = new Map<string, Declaration[]>();

	parse(css).walkRules((rule) => {
		const declarations: Declaration[] = [];
		rule.walkDecls((declaration) => {
			declarations.push(declaration);
		});
		found.set(rule.selector, declarations);
	});

	return found;
}

function propertyNames(declarations: Declaration[]): string[] {
	// `map` already returned a fresh array, so this sort mutates nothing postcss still holds.
	// `toSorted` would say it directly and is ES2023 against an ES2022 target, the same trade
	// `core/css/step-numbers.test.ts` makes.
	// oxlint-disable-next-line unicorn/no-array-sort
	return declarations.map((declaration) => declaration.prop).sort();
}

function channels(value: string): [number, number, number] {
	const match = OKLCH_TRIPLE.exec(value);
	if (!match) throw new Error(`not an oklch() triple: ${value}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function valueOf(declarations: Declaration[], property: string): string {
	const found = declarations.find((declaration) => declaration.prop === property);
	if (!found) throw new Error(`no ${property} declaration`);
	return found.value;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const held of Object.values(value)) deepFreeze(held);
		Object.freeze(value);
	}
	return value;
}

function sorted(names: readonly string[]): string[] {
	// oxlint-disable-next-line unicorn/no-array-sort
	return [...names].sort();
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
 * The twelve numbers a Tailwind or shadcn consumer already types, as in `bg-brand-500` and
 * `text-brand-700`. Written out here instead of read back from `STEP_NUMBERS`, because that table
 * is one of the things under test: importing it would let a wrong name pass on both sides at once.
 *
 * 25 sits below 50 because Tailwind's own palette has eleven stops and a Cambium ramp has twelve.
 * `core/css/step-numbers.ts` argues that choice; the list here only states what a consumer gets.
 */
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

/**
 * The ramps `PINNED_SET` carries, which is deliberately not all seven of `RAMP_NAMES`. The adapter
 * reads the keys the token set actually holds, so a fixture short four ramps is the case that
 * catches a hardcoded list.
 */
const FIXTURE_RAMPS = ['brand', 'neutral', 'danger'];

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
		const root = parse(toGlobalsCss(PINNED_SET));
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
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));

		expect(propertyNames(byScheme.get(':root') ?? [])).toEqual(EXPECTED_ROOT_PROPERTIES);
	});

	// Asserted against the contract rather than against what the light selector happened to emit. A
	// token present in light and missing in dark is the defect this pair catches, and comparing the
	// two selectors to each other would report them as agreeing when both are short the same token.
	it('declares every semantic token, every ramp step and every shadow under the dark selector', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));

		expect(propertyNames(byScheme.get('.dark') ?? [])).toEqual(EXPECTED_DARK_PROPERTIES);
	});

	// The scoped form of the mirror invariant, said out loud so that widening the adapter later
	// cannot satisfy it by dropping a comparison. A scalar leaking into `.dark` is harmless today
	// and a divergence waiting to happen the moment somebody makes radius scheme-dependent, which
	// is the decision this layout forecloses.
	it('mirrors colours, ramps and shadows across both selectors and keeps the scalars to :root', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));
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
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));

		for (const declarations of byScheme.values()) {
			for (const property of EXPECTED_COLOR_PROPERTIES) {
				expect(OKLCH_TRIPLE.test(valueOf(declarations, property))).toBe(true);
			}
		}
	});

	it('resolves every alias, leaving no ramp.step reference in a declaration value', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));

		for (const declarations of byScheme.values()) {
			for (const declaration of declarations) {
				expect(RAMP_ALIAS.test(declaration.value)).toBe(false);
			}
		}
	});

	it('references no custom property it does not also declare', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));
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
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));
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
		const light = declarationsBySelector(toGlobalsCss(PINNED_SET)).get(':root') ?? [];

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
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));

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
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));
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
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));
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
		const root = declarationsBySelector(toGlobalsCss(PINNED_SET)).get(':root') ?? [];

		// Straight off `NON_COLOR_FIXTURE`. The weight and the line height are unitless, and every
		// dimension keeps its unit, including the tracking step sitting at zero. A bare `0` would be
		// a valid length too, and `0em` keeps the em readable in the export.
		expect(valueOf(root, '--cmb-radius-lg')).toBe('0.625rem');
		expect(valueOf(root, '--cmb-text-base')).toBe('1rem');
		expect(valueOf(root, '--cmb-font-weight-regular')).toBe('400');
		expect(valueOf(root, '--cmb-leading-normal')).toBe('1.5');
		expect(valueOf(root, '--cmb-tracking-normal')).toBe('0em');
	});

	it('carries a caller-supplied prefix everywhere but on the semantic colours', () => {
		const names = propertyNames(
			declarationsBySelector(toGlobalsCss(PINNED_SET, { prefix: 'acme' })).get(':root') ?? [],
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
		expect(() => toGlobalsCss(PINNED_SET, { prefix: '' })).toThrow(/--shadow-md/);
		// Not only the empty prefix. A prefix that is itself a namespace root walks the property
		// straight back inside one.
		expect(() => toGlobalsCss(PINNED_SET, { prefix: 'text' })).toThrow(/--text-shadow-md/);
	});

	it('is a pure function of the token set: same set in, same bytes out, input untouched', () => {
		const frozen = deepFreeze(TokenSetSchema.parse(structuredClone(PINNED_SET)));
		const before = structuredClone(PINNED_SET);

		expect(toGlobalsCss(PINNED_SET)).toBe(toGlobalsCss(PINNED_SET));
		expect(() => toGlobalsCss(frozen)).not.toThrow();
		expect(toGlobalsCss(frozen)).toBe(toGlobalsCss(PINNED_SET));
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
		expect(() => toGlobalsCss(lopsided)).toThrow(/ring/);
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
		expect(() => toGlobalsCss(lopsided)).toThrow(/shadow steps/);
		expect(() => toGlobalsCss(lopsided)).toThrow(/md/);
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
		expect(() => toGlobalsCss(lopsided)).toThrow(/ramp steps/);
		expect(() => toGlobalsCss(lopsided)).toThrow(/warning-500/);
	});
});
