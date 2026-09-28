/**
 * Vitest, not the Playwright tier `docs/agents/testing.md` reserves for component tests. That
 * exclusion is about the interface still moving; this suite never touches rendered behaviour or the
 * interface at all — it asserts contrast math over `buttonVariants`'s compiled CSS output, the same
 * kind of seam `core/css/stylesheet.test.ts` tests other adapters at.
 *
 * `buttonVariants`'s `link` and `destructive` variants paint text over a surface no
 * `CONTRAST_PAIRS` entry declares (#68): `link` is body text straight on `background`, and
 * `destructive` is body text over a translucent tint of itself. Neither is checkable through
 * `checkContrast`, which only measures declared pairs, so this suite reads the component's actual
 * compiled classes and measures the composite with `compositeOver`. Chromium rounds alpha to 1/255
 * before it blends, so on light destructive hover this suite reads about 0.03 above what the
 * browser paints (4.56:1 against 4.53:1). A ratio inside that gap needs
 * `e2e/button-contrast.spec.ts`, which reads the painted pixels.
 *
 * The compile half follows `core/css/stylesheet.test.ts`'s hermetic technique: `source(none)` plus
 * `@source inline(...)` so the only candidates Tailwind sees are `buttonVariants`'s own output, fed
 * a real generated stylesheet (`toStylesheet`) rather than a hand-typed `:root` block. That proves
 * the classes resolve against the same custom properties `app/globals.css` declares. What a compile
 * can prove stops at selectors and property names (`docs/agents/testing.md`, "Where the seam
 * actually is") — it cannot say what a `var()` resolves to or what a browser paints once alpha
 * blends two colours. So the compiled output only supplies what a hand-written expectation would
 * otherwise hard-code: which custom property `link`'s `color` reads, and which integer percentage
 * `destructive`'s tinted fills use. Both are read back from the AST with a regex, not assumed — for
 * `link`, by filtering on the `color` property rather than on a selector spelling, so a regression
 * back to `text-primary` fails the contrast loop below on its own merits, not only the compiled
 * `.text-foreground` pin beside it. An edit to `buttonVariants` that swaps the token or the fraction
 * is what this test would need to keep reading, not what it would need to be told again.
 *
 * From there the gate is `renderedContrast`/`compositeOver` (`core/oklch.ts`): a per-channel sRGB
 * alpha blend, then 8-bit rounding — the same method `core/contrast/check.ts`'s `checkContrast`
 * gates production contrast repair on, over real engine output (`createOklchScaleEngine` +
 * `buildTokenSet`). Not the continuous `contrastFromOklch` `core/semantic-layer.test.ts`'s own
 * assertions use, and not the issue's illustrative snippet either — a value solved a hair over
 * target in full precision can round under it once both colours hit the byte grid a browser
 * actually paints (#72).
 */
import postcss, { type Container, type Declaration, type Document, parse, Rule } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from '../../core/brand-seed';
import { toStylesheet } from '../../core/css/stylesheet';
import { BALANCED } from '../../core/interpretation';
import { compositeOver, type Oklch, renderedContrast } from '../../core/oklch';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import { resolveScheme } from '../../core/resolve-scheme';
import { SCHEME_NAMES } from '../../core/scale-engine';
import { buildTokenSet } from '../../core/semantic-layer';
import type { TokenSet } from '../../core/token-set';
import { badgeVariants } from './badge';
import { buttonVariants } from './button';

/** WCAG 2.2 SC 1.4.3: normal text needs 4.5:1 against its surface. */
const TEXT_TARGET = 4.5;

/**
 * Real engine output. `core/contrast/check.test.ts:43-54` and `core/contrast/repair.test.ts:51-62`
 * both define this same ten-seed sweep locally rather than exporting it, and
 * `core/contrast/repair.test.ts:25-26` says why: each suite reproduces the documented failures
 * against its own seeds instead of borrowing another file's choice of them. Repeated here for the
 * same reason.
 */
const SWEEP: [string, [number, number, number]][] = [
	['dark-navy', [0.2, 0.1, 265]],
	['purple', [0.45, 0.2, 300]],
	['red', [0.58, 0.22, 27]],
	['magenta', [0.55, 0.25, 330]],
	['blue', [0.6231, 0.188, 259.8]],
	['green', [0.6959, 0.1491, 162.5]],
	['orange', [0.7, 0.17, 55]],
	['cyan', [0.72, 0.12, 200]],
	['yellow', [0.7952, 0.1617, 86]],
	['light-yellow', [0.9, 0.14, 95]],
];

function fixtureFor(oklch: [number, number, number]): TokenSet {
	const seed: BrandSeed = BrandSeedSchema.parse({
		keyColors: [{ oklch, proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null }],
		neutralTemperature: null,
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
}

const SWEPT = SWEEP.map(([name, oklch]) => ({ name, tokenSet: fixtureFor(oklch) }));

/**
 * One seed's real generated stylesheet, standing in for `app/globals.css`: the `@custom-variant
 * dark` declaration, the `@theme inline` registrations that make `bg-destructive` and
 * `text-foreground` valid utilities, and the `:root`/`.dark` blocks holding real OKLCH values.
 * Which seed backs it is irrelevant to what this test reads out of it — only property names and
 * selectors, never a resolved colour (see the module docblock) — so one compile serves every seed
 * in the sweep below.
 */
const GENERATED_STYLESHEET = toStylesheet(SWEPT[0]!.tokenSet);

/**
 * A consumer's stylesheet: Tailwind, then the token set's generated custom properties, then
 * `buttonVariants`'s own class output as the only candidates Tailwind is allowed to see
 * (`source(none)` + `@source inline(...)`), the same hermetic technique
 * `core/css/stylesheet.test.ts:44-54` uses.
 */
async function compile(classes: string): Promise<string> {
	const input = `@import "tailwindcss" source(none);\n@source inline("${classes}");\n${GENERATED_STYLESHEET}`;
	const result = await postcss([tailwindcss({ base: import.meta.dirname })]).process(input, {
		from: undefined,
	});

	return result.css;
}

/** The one `prop` declaration inside `@layer utilities` whose rule selector satisfies `selector`. */
function utilityDeclaration(
	compiled: string,
	prop: string,
	selector: (value: string) => boolean,
): Declaration {
	const matches: Declaration[] = [];

	parse(compiled).walkAtRules('layer', (layer) => {
		if (layer.params !== 'utilities') return;
		layer.walkDecls(prop, (declaration) => {
			const rule = declaration.parent;
			if (rule?.type === 'rule' && selector(rule.selector)) matches.push(declaration);
		});
	});

	if (matches.length !== 1) {
		throw new Error(`expected exactly one "${prop}" declaration matching, found ${matches.length}`);
	}

	return matches[0]!;
}

/**
 * The four `background-color: color-mix(...)` declarations `destructive`'s tinted fills compile
 * to, one per rest/hover and light/dark combination. Filtered on the declared property and on the
 * `color-mix` value rather than on a selector spelling, because `focus-visible:ring-destructive/N`
 * and `aria-invalid:border-destructive/N` compile to `--tw-ring-color` and `border-color`
 * `color-mix` declarations beside these four, and matching just the property and function name is
 * enough to exclude both without hand-escaping a class name's `/` and `[...]`.
 *
 * This also skips, without naming it, Tailwind's unconditional `background-color: var(--destructive)`
 * fallback — painted ahead of the `@supports (color-mix(in oklab, ...))` block for engines that
 * predate it, since `color-mix` is Baseline 2023. Skipped because its value never matches
 * `color-mix(...)`, and left untested on purpose: an engine old enough to need that fallback renders
 * the state on its own solid colour rather than on a tint, which is a different failure than the one
 * this suite gates.
 */
function destructiveFillDeclarations(compiled: string): Declaration[] {
	const found: Declaration[] = [];

	parse(compiled).walkDecls('background-color', (declaration) => {
		if (declaration.value.includes('color-mix(in oklab, var(--destructive)'))
			found.push(declaration);
	});

	if (found.length !== 4) {
		throw new Error(`expected 4 destructive fill declarations, found ${found.length}`);
	}

	return found;
}

/**
 * The selector of the nearest enclosing rule. Tailwind nests a non-`:hover` fill's `@supports`
 * fallback directly inside its rule without repeating the selector, but groups a `:hover` fill's
 * `@supports` block as a sibling under a shared `@media (hover: hover)` instead — so a fill
 * declaration's own `.parent` is a `Rule` in one shape and an `AtRule` in the other. Walking up to
 * the first `Rule` reads the selector either way rather than assuming which shape applies.
 */
function nearestSelector(node: Declaration): string {
	let current: Container | Document | undefined = node.parent;

	while (current) {
		if (current instanceof Rule) return current.selector;
		current = current.parent;
	}

	throw new Error('declaration has no enclosing rule');
}

/** Which of the four states a compiled fill declaration's selector names. */
function classify(selector: string): { hover: boolean; dark: boolean } {
	return { hover: selector.includes(':hover'), dark: selector.includes(':is(.dark') };
}

function declarationFor(declarations: Declaration[], hover: boolean, dark: boolean): Declaration {
	const matches = declarations.filter((declaration) => {
		const state = classify(nearestSelector(declaration));
		return state.hover === hover && state.dark === dark;
	});

	if (matches.length !== 1) {
		throw new Error(
			`expected exactly one fill declaration for hover=${hover} dark=${dark}, found ${matches.length}`,
		);
	}

	return matches[0]!;
}

/** The `N` a `color-mix(in oklab, var(--destructive) N%, transparent)` declaration carries. */
function percentOf(declaration: Declaration): number {
	const match = /color-mix\(in oklab, var\(--destructive\) ([\d.]+)%, transparent\)/.exec(
		declaration.value,
	);

	if (!match) throw new Error(`"${declaration.value}" is not a destructive color-mix declaration`);

	return Number(match[1]);
}

/** The bare token name inside a `var(--token)` reference, e.g. `"foreground"` from `"var(--foreground)"`. */
function customPropertyName(value: string): string {
	const match = /^var\(--([a-z-]+)\)$/.exec(value);
	if (!match) throw new Error(`"${value}" is not a var(--token) reference`);
	return match[1]!;
}

describe('buttonVariants link', () => {
	const compiledPromise = compile(buttonVariants({ variant: 'link' }));

	it('compiles to `color: var(--foreground)`, not `var(--primary)`', async () => {
		const declaration = utilityDeclaration(
			await compiledPromise,
			'color',
			(selector) => selector === '.text-foreground',
		);

		expect(declaration.value).toBe('var(--foreground)');
	});

	/**
	 * Reads whichever custom property the compiled `color` declaration actually references, filtered
	 * on the `color` property alone rather than on a selector spelling — `compile` already restricts
	 * Tailwind to this variant's own classes (`@source inline`), so exactly one declaration sets
	 * `color`, whatever the variant happens to be. That is what makes this loop an independent gate
	 * rather than a restatement of the string pin above: swap the variant back to `text-primary` and
	 * this reads `--primary` instead and measures it, the same way a browser would resolve the class
	 * that actually shipped.
	 *
	 * `foreground`/`background` is already a declared, repair-protected pair
	 * (`core/contrast/pairs.ts:46`, `core/semantic-map.ts:90-91`: worst case 9.92:1 across the
	 * sweep), so a passing `link` here is a regression guard tying the component's actual output to
	 * that existing guarantee, not a new proof of it. Verified failing before #68: swapping the class
	 * back to `text-primary` and rerunning this loop fails on 10 of the 20 seed-and-scheme
	 * combinations, worst 1.01:1 for `dark-navy` in dark — matching the issue's own figures, because
	 * this loop reads the class that actually shipped rather than assuming which token it names.
	 */
	it.each(SCHEME_NAMES)('clears 4.5:1 against background in every seed, %s', async (scheme) => {
		const declaration = utilityDeclaration(await compiledPromise, 'color', () => true);
		const token = customPropertyName(declaration.value);

		for (const { name, tokenSet } of SWEPT) {
			const resolved = resolveScheme(tokenSet.schemes[scheme]);
			const textColor = resolved[token];

			if (!textColor) {
				throw new Error(`link's compiled "color" references unknown semantic token "${token}"`);
			}

			const ratio = renderedContrast(textColor, resolved.background!);

			expect(ratio, `${name} ${scheme}`).toBeGreaterThanOrEqual(TEXT_TARGET);
		}
	});
});

describe('buttonVariants destructive', () => {
	const compiledPromise = compile(buttonVariants({ variant: 'destructive' }));

	async function fractions() {
		const declarations = destructiveFillDeclarations(await compiledPromise);

		return {
			lightRest: percentOf(declarationFor(declarations, false, false)),
			lightHover: percentOf(declarationFor(declarations, true, false)),
			darkRest: percentOf(declarationFor(declarations, false, true)),
			darkHover: percentOf(declarationFor(declarations, true, true)),
		};
	}

	it('resolves each state to a distinct destructive color-mix fraction', async () => {
		// Behaviour, not the pinned numbers: two states sharing a fraction is the same collapse the
		// "keeps hover darker than rest" case below guards against, generalised to all four states
		// rather than just a scheme's own pair. The fractions themselves are pinned in exactly one
		// place, `components/ui/button.tsx`'s comment on the destructive variant.
		const { lightRest, lightHover, darkRest, darkHover } = await fractions();

		expect(new Set([lightRest, lightHover, darkRest, darkHover]).size).toBe(4);
	});

	/**
	 * A hover fraction equal to rest's clears AA but loses the hover affordance — nothing about the
	 * surface changes on interaction. Dark already keeps hover (`/30`) darker than rest (`/20`);
	 * this pins the same ordering for light now that light rest moved to `/5` and light hover holds
	 * at `/10`, so a future search for "the smallest passing fraction" can't silently collapse the
	 * two again.
	 */
	it.each(SCHEME_NAMES)('keeps hover darker than rest, %s', async (scheme) => {
		const { lightRest, lightHover, darkRest, darkHover } = await fractions();
		const [rest, hover] = scheme === 'dark' ? [darkRest, darkHover] : [lightRest, lightHover];

		expect(hover, `${scheme} hover (${hover}%) vs rest (${rest}%)`).toBeGreaterThan(rest);
	});

	/**
	 * Composited via `compositeOver`, gated via `renderedContrast` — both against the colours
	 * Tailwind actually compiled (the fraction read out above) rather than the underlying tokens,
	 * per the module docblock. `background` is `neutral.1` and `destructive` is `danger.11`'s raw
	 * primitive step, not the resolved semantic alias: the tint sits on the literal page surface
	 * every button renders against, and `danger.11` is `destructive`'s own value either way.
	 *
	 * Which fractions landed where, and why light rest moved a step rather than leaving hover to
	 * match it, is `components/ui/button.tsx`'s comment — this loop only proves the four fractions
	 * that shipped clear 4.5:1, not the search that picked them. The "keeps hover darker than rest"
	 * case above is the regression guard for the ordering that search settled on.
	 */
	it.each(SCHEME_NAMES)('clears 4.5:1 for every state and seed, %s', async (scheme) => {
		const declarations = destructiveFillDeclarations(await compiledPromise);
		const isDark = scheme === 'dark';
		// Only this scheme's own rest/hover pair is relevant: each fill composites over that
		// scheme's own background, so the light states gate light seeds and the dark states gate
		// dark's.
		const states: Array<{ label: string; hover: boolean }> = [
			{ label: 'rest', hover: false },
			{ label: 'hover', hover: true },
		];

		for (const state of states) {
			const fraction = percentOf(declarationFor(declarations, state.hover, isDark)) / 100;

			for (const { name, tokenSet } of SWEPT) {
				const background: Oklch = tokenSet.schemes[scheme].primitives.neutral![0]!;
				const destructive: Oklch = tokenSet.schemes[scheme].primitives.danger![10]!;
				const composited = compositeOver(background, destructive, fraction);
				const ratio = renderedContrast(destructive, composited);

				expect(ratio, `${name} ${scheme} ${state.label}`).toBeGreaterThanOrEqual(TEXT_TARGET);
			}
		}
	});
});

/**
 * `badgeVariants`'s `link` and `destructive` carry the same defect as `buttonVariants`'s own
 * (`components/ui/badge.tsx`'s comments point back at `components/ui/button.tsx` for why), so this
 * reuses every helper defined above rather than restating docblocks that already cover what each
 * one proves.
 */
describe('badgeVariants link', () => {
	const compiledPromise = compile(badgeVariants({ variant: 'link' }));

	it('compiles to `color: var(--foreground)`, not `var(--primary)`', async () => {
		const declaration = utilityDeclaration(
			await compiledPromise,
			'color',
			(selector) => selector === '.text-foreground',
		);

		expect(declaration.value).toBe('var(--foreground)');
	});

	it.each(SCHEME_NAMES)('clears 4.5:1 against background in every seed, %s', async (scheme) => {
		const declaration = utilityDeclaration(await compiledPromise, 'color', () => true);
		const token = customPropertyName(declaration.value);

		for (const { name, tokenSet } of SWEPT) {
			const resolved = resolveScheme(tokenSet.schemes[scheme]);
			const textColor = resolved[token];

			if (!textColor) {
				throw new Error(
					`badge link's compiled "color" references unknown semantic token "${token}"`,
				);
			}

			const ratio = renderedContrast(textColor, resolved.background!);

			expect(ratio, `${name} ${scheme}`).toBeGreaterThanOrEqual(TEXT_TARGET);
		}
	});
});

describe('badgeVariants destructive', () => {
	const compiledPromise = compile(badgeVariants({ variant: 'destructive' }));

	async function fractions() {
		const declarations = destructiveFillDeclarations(await compiledPromise);

		return {
			lightRest: percentOf(declarationFor(declarations, false, false)),
			lightHover: percentOf(declarationFor(declarations, true, false)),
			darkRest: percentOf(declarationFor(declarations, false, true)),
			darkHover: percentOf(declarationFor(declarations, true, true)),
		};
	}

	it('resolves each state to a distinct destructive color-mix fraction', async () => {
		const { lightRest, lightHover, darkRest, darkHover } = await fractions();

		expect(new Set([lightRest, lightHover, darkRest, darkHover]).size).toBe(4);
	});

	it.each(SCHEME_NAMES)('keeps hover darker than rest, %s', async (scheme) => {
		const { lightRest, lightHover, darkRest, darkHover } = await fractions();
		const [rest, hover] = scheme === 'dark' ? [darkRest, darkHover] : [lightRest, lightHover];

		expect(hover, `${scheme} hover (${hover}%) vs rest (${rest}%)`).toBeGreaterThan(rest);
	});

	it.each(SCHEME_NAMES)('clears 4.5:1 for every state and seed, %s', async (scheme) => {
		const declarations = destructiveFillDeclarations(await compiledPromise);
		const isDark = scheme === 'dark';
		const states: Array<{ label: string; hover: boolean }> = [
			{ label: 'rest', hover: false },
			{ label: 'hover', hover: true },
		];

		for (const state of states) {
			const fraction = percentOf(declarationFor(declarations, state.hover, isDark)) / 100;

			for (const { name, tokenSet } of SWEPT) {
				const background: Oklch = tokenSet.schemes[scheme].primitives.neutral![0]!;
				const destructive: Oklch = tokenSet.schemes[scheme].primitives.danger![10]!;
				const composited = compositeOver(background, destructive, fraction);
				const ratio = renderedContrast(destructive, composited);

				expect(ratio, `${name} ${scheme} ${state.label}`).toBeGreaterThanOrEqual(TEXT_TARGET);
			}
		}
	});
});
