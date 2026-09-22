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
 * it with itself.
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
	shadow: SHADOW_FIXTURE,
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

/** The property names criterion 1 asks for, taken off the contract rather than off the output. */
const EXPECTED_PROPERTIES = Object.keys(SEMANTIC_MAP)
	.map((token) => `--${token}`)
	// oxlint-disable-next-line unicorn/no-array-sort
	.sort();

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

	it('declares every semantic token under the light selector', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));

		expect(propertyNames(byScheme.get(':root') ?? [])).toEqual(EXPECTED_PROPERTIES);
	});

	// Asserted against the contract rather than against what the light selector happened to emit. A
	// token present in light and missing in dark is the defect this pair catches, and comparing the
	// two selectors to each other would report them as agreeing when both are short the same token.
	it('declares every semantic token under the dark selector', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));

		expect(propertyNames(byScheme.get('.dark') ?? [])).toEqual(EXPECTED_PROPERTIES);
	});

	it('emits every colour as an oklch() call', () => {
		const byScheme = declarationsBySelector(toGlobalsCss(PINNED_SET));

		for (const declarations of byScheme.values()) {
			for (const declaration of declarations) {
				expect(OKLCH_TRIPLE.test(declaration.value)).toBe(true);
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
});
