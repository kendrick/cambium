import { type Declaration, parse } from 'postcss';
import { ZodError } from 'zod';

import { BrandSeedSchema } from '../brand-seed';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { derived } from '../provenance';
import { buildTokenSet } from '../semantic-layer';
import { SEMANTIC_MAP } from '../semantic-map';
import { type Ramp, type SemanticEntry, type TokenSet, TokenSetSchema } from '../token-set';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from '../token-set.fixture';
import type { VocabularyCategory } from './globals-css';

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
 * `PINNED_SET` carrying one extra name in one category, named by the caller.
 *
 * Every record these categories live in keys on any non-empty string, so a name the generator never
 * emits is a schema-legal input rather than a hypothetical. That is what the vocabulary checks need:
 * the set parses, and only the adapters stand between the name and the consumer. Per-scheme
 * categories get the name in both schemes, so the refusal is about the name and not a mismatch
 * between light and dark.
 */
export function setWithName(category: VocabularyCategory, name: string): TokenSet {
	const light = structuredClone(LIGHT_SCHEME) as unknown as LooseScheme;
	const dark = structuredClone(DARK_SCHEME) as unknown as LooseScheme;
	const nonColor = structuredClone(NON_COLOR_FIXTURE) as unknown as LooseNonColor;
	const { typography } = NON_COLOR_FIXTURE;

	switch (category) {
		case 'semantic token':
			light.semantic[name] = { alias: 'neutral.5', $extensions: EXTENSIONS };
			dark.semantic[name] = { alias: 'neutral.5', $extensions: EXTENSIONS };
			break;
		case 'ramp':
			light.primitives[name] = ramp(90, 0.02, 0);
			dark.primitives[name] = ramp(90, 0.03, 50);
			break;
		case 'shadow step':
			light.shadow.values[name] = SHADOW_FIXTURE.values.md;
			dark.shadow.values[name] = DARK_SHADOW_FIXTURE.values.md;
			break;
		case 'radius step':
			nonColor.radius.values[name] = NON_COLOR_FIXTURE.radius.values.lg;
			break;
		case 'type size':
			nonColor.typography.values.size[name] = { ...typography.values.size.base, value: 2 };
			break;
		case 'font weight':
			nonColor.typography.values.weight[name] = typography.values.weight.regular;
			break;
		case 'line height':
			nonColor.typography.values.lineHeight[name] = typography.values.lineHeight.normal;
			break;
		case 'tracking step':
			nonColor.tracking.values[name] = NON_COLOR_FIXTURE.tracking.values.normal;
			break;
	}

	// The top level mirrors the light scheme, which `checkMirroredLayers` requires.
	return TokenSetSchema.parse({ ...light, schemes: { light, dark }, ...nonColor });
}

/** The records `setWithName` writes into, loosened so any category can take a new key. */
type LooseRecord = Record<string, unknown>;
type LooseScheme = {
	primitives: LooseRecord;
	semantic: LooseRecord;
	shadow: { values: LooseRecord };
};
type LooseNonColor = {
	radius: { values: LooseRecord };
	typography: { values: { size: LooseRecord; weight: LooseRecord; lineHeight: LooseRecord } };
	tracking: { values: LooseRecord };
};

/** `PINNED_SET` carrying one extra semantic token; the common case of {@link setWithName}. */
export function setWithSemanticToken(token: string): TokenSet {
	return setWithName('semantic token', token);
}

/**
 * What the generator itself hands the adapters: a full token set built by the real scale engine and
 * semantic layer from a one-colour seed, carrying every name in the generator's vocabulary. All
 * seven ramps, the five shadow steps, eight type sizes and the rest.
 *
 * Generated, unlike `PINNED_SET`, because its subject is the vocabulary. The whitelist admits
 * exactly what the generator emits, so the set that proves the whitelist sound in Tailwind has to be
 * the generator's own output. A hand-written copy could drift from it.
 */
export const GENERATED_SET: TokenSet = (() => {
	const seed = BrandSeedSchema.parse({
		keyColors: [
			{
				oklch: [0.55, 0.15, 260],
				proposedRole: 'brand',
				sourceImageId: 'img-1',
				sourceRegion: null,
			},
		],
		neutralTemperature: null,
		surfacePolarity: null,
		radiusCharacter: null,
		shadowCharacter: null,
		trackingFeel: null,
		typeClassification: null,
		suggestedPairing: null,
		typeScaleRatio: null,
		imageClassifications: null,
		expressive: null,
	});
	const result = createOklchScaleEngine().generate(seed, BALANCED);

	if (!result.ok)
		throw new Error(`the scale engine rejected the fixture seed: ${result.error.kind}`);

	return buildTokenSet(result.schemes, seed);
})();

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

/**
 * The declarations postcss found under each top-level selector, keyed by the selector it parsed.
 * Top-level only, because `toStylesheet` also writes a `:where(.dark)` rule inside `@layer theme`,
 * and its declarations are theme aliases rather than the scheme's own, so mixing them in would
 * answer a question about the dark scheme with the wrong rule.
 */
export function declarationsBySelector(css: string): Map<string, Declaration[]> {
	const found = new Map<string, Declaration[]>();

	parse(css).walkRules((rule) => {
		if (rule.parent?.type !== 'root') return;
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

/**
 * `PINNED_SET` with one number pushed past a bound `TokenSetSchema` enforces, which the `TokenSet`
 * type can't carry. The compiler accepts every one of these, so only a parse stands between each and
 * the stylesheet.
 *
 * A negative radius or blur prints as a length that parses and then goes invalid in the property
 * reading it through `var()`, so `rounded-lg` or `shadow-md` quietly paints nothing. A line height of
 * 0 is legal CSS and draws every line of the text using it on top of the one before. The blur sits
 * in the dark scheme only: the top-level shadow mirrors light, and a bound broken where nothing
 * mirrors it is the case a check reading one copy would miss.
 */
export const OUT_OF_BOUNDS: readonly { bound: string; path: string; set: TokenSet }[] = [
	{
		bound: 'negative radius',
		path: 'radius.values.lg.value',
		set: withScalar((set) => {
			set.radius.values.lg!.value = -4;
		}),
	},
	{
		bound: 'negative dark shadow blur',
		path: 'schemes.dark.shadow.values.md.blur.value',
		set: withScalar((set) => {
			set.schemes.dark.shadow.values.md!.blur.value = -2;
		}),
	},
	{
		bound: 'zero line height',
		path: 'typography.values.lineHeight.normal.value',
		set: withScalar((set) => {
			set.typography.values.lineHeight.normal!.value = 0;
		}),
	},
];

/**
 * `PINNED_SET` with the light brand ramp's first step at hue 360, in both copies of the light scheme
 * so `checkMirroredLayers` still passes. Legal on the way in, and the schema folds it to 0: the case
 * where emitting from the parsed set and emitting from the argument print different bytes.
 */
export const HUE_360_SET: TokenSet = withScalar((set) => {
	set.primitives.brand![0]!.h = 360;
	set.schemes.light.primitives.brand![0]!.h = 360;
});

function withScalar(edit: (set: TokenSet) => void): TokenSet {
	const set = structuredClone(PINNED_SET);
	edit(set);
	return set;
}

/**
 * The dotted path of every issue in the `ZodError` that `run` throws. Fails the test if `run`
 * returns, or throws anything else: a CSS adapter's own error naming the value would not show that
 * the schema was the thing that refused it.
 */
export function zodIssuePaths(run: () => unknown): string[] {
	try {
		run();
	} catch (error) {
		if (!(error instanceof ZodError)) throw error;
		return error.issues.map((issue) => issue.path.join('.'));
	}
	throw new Error('expected a ZodError, and nothing was thrown');
}
