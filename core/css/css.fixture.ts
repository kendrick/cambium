import { type Declaration, parse } from 'postcss';

import { derived } from '../provenance';
import { SEMANTIC_MAP } from '../semantic-map';
import { type Ramp, type SemanticEntry, type TokenSet, TokenSetSchema } from '../token-set';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from '../token-set.fixture';

/**
 * What the three CSS adapter suites share: one pinned token set built to make a declaration name
 * the step it came from, and the postcss helpers that read an emitted stylesheet back.
 *
 * Not `core/token-set.fixture.ts`, which is the home for the token-set halves four non-CSS suites
 * build a whole set from. Half of what is here is postcss, and putting a CSS parser behind a module
 * `token-set.test.ts`, `strictness.test.ts`, `purity.test.ts` and `brand-record.test.ts` all import
 * would hand four suites a dependency none of them parses anything with. The other half is a token
 * set shaped for one job — reading a channel back out of a CSS declaration — which is worth nothing
 * to those four. The non-colour half still comes from that file; this one only adds the colour
 * schemes the CSS adapters need on top.
 *
 * Not a `.test.ts` file, for the reason `core/token-set.fixture.ts` gives: the Vitest include glob
 * would run it and it holds no tests.
 */

const EXTENSIONS = derived('keyColors', 'exercises a schema bound rather than a real derivation');

/**
 * A ramp whose step numbers are legible in the output: step n sits at lightness `(n + offset)/100`,
 * so a declaration's lightness names the step it came from and the two schemes never collide.
 *
 * Integer division by 100 is deliberate. IEEE division is correctly rounded, so `9/100` lands on
 * the same double the literal `0.09` parses to, and the assertions that read a channel back compare
 * decimal literals against it with no tolerance at all. Accumulating a step's lightness by repeated
 * addition carries no such guarantee.
 */
export function ramp(hue: number, chroma: number, offset: number): Ramp {
	return Array.from({ length: 12 }, (_, index) => ({
		step: index + 1,
		l: (index + 1 + offset) / 100,
		c: chroma,
		h: hue,
		$extensions: EXTENSIONS,
	}));
}

/**
 * The whole shadcn contract as a semantic layer: one entry per `SEMANTIC_MAP` key, so an adapter
 * meets the token set a generated theme actually hands it rather than a five-token sample.
 *
 * A `ContrastingPair` takes its first candidate. Which of the two a real scheme keeps is
 * `semantic-layer.ts`'s contrast decision, and it changes nothing these suites measure, because
 * either way the layer holds one plain alias under that name.
 */
export function shadcnSemanticLayer(): Record<string, SemanticEntry> {
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

export const SEMANTIC = shadcnSemanticLayer();

/**
 * The dark scheme's shadow, differing from `SHADOW_FIXTURE` in its colour, its vertical offset and
 * its blur.
 *
 * `checkMirroredLayers` pins the top-level `shadow` to `schemes.light.shadow`, so a set carries two
 * distinguishable shadows and only one of them is reachable from the top level. Reading the top
 * level would therefore paint the light scheme's shadow under `.dark` and look entirely healthy.
 * These three differences are what make that substitution visible.
 */
export const DARK_SHADOW_FIXTURE = {
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
export const LIGHT_SCHEME = {
	primitives: { brand: ramp(260, 0.02, 0), neutral: ramp(250, 0.02, 0), danger: ramp(25, 0.02, 0) },
	semantic: SEMANTIC,
	shadow: SHADOW_FIXTURE,
};

export const DARK_SCHEME = {
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
 * from freezing anything the module-level literals still share.
 */
export const PINNED_SET: TokenSet = TokenSetSchema.parse({
	...LIGHT_SCHEME,
	schemes: { light: LIGHT_SCHEME, dark: DARK_SCHEME },
	...NON_COLOR_FIXTURE,
});

/**
 * `PINNED_SET` carrying one extra semantic token, named by the caller.
 *
 * `SemanticLayerSchema` is a record keyed on any non-empty string, so a token name is whatever the
 * layer that built the set put there. That makes a name landing inside a Tailwind namespace a
 * schema-legal input rather than a hypothetical, which is what the collision checks need.
 */
export function setWithSemanticToken(token: string): TokenSet {
	const semantic = { ...SEMANTIC, [token]: { alias: 'neutral.5', $extensions: EXTENSIONS } };
	const light = { ...LIGHT_SCHEME, semantic };
	const dark = { ...DARK_SCHEME, semantic };

	return TokenSetSchema.parse({ ...light, schemes: { light, dark }, ...NON_COLOR_FIXTURE });
}

/**
 * `PINNED_SET` carrying one extra typography size, named by the caller, at `2rem`.
 *
 * The size record keys on any non-empty string too, so a name Tailwind would parse as something
 * other than a size is as schema-legal as the semantic case above.
 */
export function setWithTypeSize(name: string): TokenSet {
	const { typography } = NON_COLOR_FIXTURE;
	const size = {
		...typography.values.size,
		[name]: { value: 2, unit: 'rem', $extensions: typography.values.size.base.$extensions },
	};

	return TokenSetSchema.parse({
		...LIGHT_SCHEME,
		schemes: { light: LIGHT_SCHEME, dark: DARK_SCHEME },
		...NON_COLOR_FIXTURE,
		typography: { ...typography, values: { ...typography.values, size } },
	});
}

/**
 * The ramps `PINNED_SET` carries, which is deliberately not all seven of `RAMP_NAMES`. The adapters
 * read the keys the token set actually holds, so a fixture short four ramps is the case that
 * catches a hardcoded list.
 */
export const FIXTURE_RAMPS = ['brand', 'neutral', 'danger'];

/**
 * The twelve numbers a Tailwind or shadcn consumer already types, as in `bg-brand-500` and
 * `text-brand-700`. A literal, never `STEP_NUMBERS` read back: that table is one of the things
 * under test, and a suite that derives the expected names from it would pass on any mapping the
 * table happened to hold, wrong ones included.
 *
 * Shared rather than written out per suite because it is the literal that is doing the work, and
 * one literal three suites read is still independent of the implementation. Deriving it here would
 * lose that independence for all three at once, which is why this stays a list of strings.
 *
 * 25 sits below 50 because Tailwind's own palette has eleven stops and a Cambium ramp has twelve.
 * `core/css/step-numbers.ts` argues that choice; the list here only states what a consumer gets.
 */
export const CONVENTIONAL_NUMBERS = [
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

/** Every `var(--x)` reference a declaration value makes. */
export const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g;

export function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const held of Object.values(value)) deepFreeze(held);
		Object.freeze(value);
	}
	return value;
}

/** The declarations postcss found under each selector, keyed by the selector it parsed. */
export function declarationsBySelector(css: string): Map<string, Declaration[]> {
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

/** Every declaration anywhere in a stylesheet, whatever rule or at-rule postcss nested it under. */
export function allDeclarations(css: string): Declaration[] {
	const declarations: Declaration[] = [];
	parse(css).walkDecls((declaration) => {
		declarations.push(declaration);
	});
	return declarations;
}

export function propertyNames(declarations: Declaration[]): string[] {
	// `map` already returned a fresh array, so this sort mutates nothing postcss still holds.
	// `toSorted` would say it directly and is ES2023 against an ES2022 target, the same trade
	// `core/css/step-numbers.test.ts` makes.
	// oxlint-disable-next-line unicorn/no-array-sort
	return declarations.map((declaration) => declaration.prop).sort();
}

export function valueOf(declarations: Declaration[], property: string): string {
	const found = declarations.find((declaration) => declaration.prop === property);
	if (!found) throw new Error(`no ${property} declaration`);
	return found.value;
}

export function sorted(names: readonly string[]): string[] {
	// oxlint-disable-next-line unicorn/no-array-sort
	return [...names].sort();
}
