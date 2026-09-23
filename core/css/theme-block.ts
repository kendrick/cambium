import { BRAND_STEP } from '../step-roles';
import {
	type ColorScheme,
	declaredRamp,
	type Ramp,
	type ShadowScale,
	type TokenSet,
} from '../token-set';
import {
	BRAND_RAMP,
	type CssNaming,
	declarationBlock,
	type ParsedTokenSet,
	parseTokenSet,
	requireGeneratedVocabulary,
} from './globals-css';
import { stepNumberName } from './step-numbers';

/** One theme entry: the bare Tailwind name and the raw property its `var()` points at. */
type ThemeEntry = { name: string; reference: string };

/**
 * Zero specificity, so on the same element Tailwind's `:root` declaration of a theme entry wins.
 * `toDarkThemeLayer` says why that matters.
 */
const DARK_THEME_SELECTOR = ':where(.dark)';

/**
 * Writes a token set out as the Tailwind v4 `@theme inline { … }` block a shadcn project's
 * `globals.css` carries alongside its custom-property rules.
 *
 * Every entry here is a `var()` reference and never a literal, because a theme entry holding a
 * literal is frozen for the life of the stylesheet, and `toGlobalsCss` (`core/css/globals-css.ts`)
 * is the half of this design that puts scheme-dependent values somewhere a `var()` can reach: under
 * `:root` and `.dark`. Which property each entry points at is not restated here: it comes from the
 * one `CssNaming` that half names its properties by, so the two shapes below describe what comes
 * out rather than a second copy of the prefixing rule. The entry names themselves are spelled in
 * both files, category by category; the cross-adapter test in `theme-block.test.ts` is what holds
 * those two spellings together.
 *
 * - `--<entry>: var(--<prefix>-<entry>)` for every prefixed property
 * - `--color-<semantic>: var(--<semantic>)` for the semantic colours, which stay bare
 *
 * Property names come from a `CssNaming` (`core/css/globals-css.ts`) rather than from a prefix this
 * module resolves for itself. Every name here has to be the name the other half declares, or the
 * prefixed entries point at properties nothing declares and every utility they feed goes without a
 * value, with the parse still clean. Only the semantic entries survive a mismatch, because their
 * references carry no prefix. One naming object handed to both halves is what makes them agree by
 * construction; a second copy of the rule, or a second reading of the same prefix, would leave the
 * agreement to a comment.
 *
 * The argument carries no default for the same reason. `toThemeBlock(set)` beside
 * `toGlobalsCss(set, cssNaming({ prefix }))` is exactly the mismatch above, and without a default
 * it does not compile. `toStylesheet` (`core/css/stylesheet.ts`) is the entry point that builds one
 * naming and hands it to both.
 *
 * Five namespaces, matching the acceptance criterion by name: colour, radius, typography, tracking,
 * shadow. Typography is the one with no single Tailwind root of its own — a size, a weight and a
 * line height are three different roots, `--text-*`, `--font-weight-*` and `--leading-*` — so all
 * three are registered and none of them is treated as the whole of the namespace.
 *
 * Ramp step numbers come from `stepNumberName` (`core/css/step-numbers.ts`), the same table
 * `toGlobalsCss` reads to name the property this module points at. The mapping lives in that one
 * table because it argues there why a lookup and not a formula: declaring it as data here a second
 * time would give a renamed step two tables that could disagree.
 *
 * The brand ramp alone gets an unnumbered `--color-brand` entry, pointing at the property
 * `rampDeclarations` (`core/css/globals-css.ts`) declares for it, and that function carries the
 * argument for why brand and no other ramp: step 9's conventional number is 700, so `bg-brand-500`
 * is not the brand colour and the unnumbered name is the one that holds still. `accent` is the only
 * other ramp name `SEMANTIC_MAP` also uses as a key, and `--color-accent` is already the semantic
 * token's, which is the collision that decides the rule rather than an exception to it.
 *
 * Names come off the token set's own semantic layer, ramp keys and scalar keys, the way
 * `toGlobalsCss` reads its inputs, so a set short a ramp exports the ramps it has. Every one of
 * those names has to be in `GENERATED_VOCABULARY` (`core/css/globals-css.ts`), the generator's own
 * vocabulary, and `requireGeneratedVocabulary` refuses a set carrying any other name before an entry
 * is built. That is what keeps a token from being exported shadowed: a semantic `base` beside the
 * type size `base` would compile `.text-base` to a colour and drop the size, and a weight `mono`
 * would lose `font-mono` to the font family. A prefix that walks a reference back inside a Tailwind
 * namespace is refused when the entry is built, by `CssNaming`. A malformed or `tw-` prefix is
 * refused earlier still, when `cssNaming` resolves it.
 *
 * Property names only, taken from the light scheme. A theme entry does not carry a colour, so it
 * cannot itself be scheme-dependent, and reading one scheme's names is exactly right when the two
 * schemes agree. This function does no such checking itself; `toGlobalsCss`'s own mirror check is
 * what enforces that light and dark name the same semantic tokens, ramps and shadow steps for any
 * set the two adapters share.
 *
 * The set is parsed first, through `parseTokenSet` (`core/css/globals-css.ts`), though no value
 * reaches this block: every entry is a `var()`. Called alone it is still half a stylesheet, and a set
 * the other half refuses for a negative radius shouldn't get this half out. `emitThemeBlock` skips
 * the parse, for `toStylesheet`, which has already done it.
 *
 * Pure in the sense `serializeDtcg` (`core/dtcg/serialize.ts`) states the contract: same token set
 * in, same bytes out, key order included (`toStylesheet` in `core/css/stylesheet.ts` says why).
 * Nothing here reads the DOM, the network, storage or module state, and the token set is read and
 * never written.
 */
export function toThemeBlock(tokenSet: TokenSet, naming: CssNaming): string {
	return emitThemeBlock(parseTokenSet(tokenSet), naming);
}

/** {@link toThemeBlock} on a set `parseTokenSet` has already parsed. */
export function emitThemeBlock(tokenSet: ParsedTokenSet, naming: CssNaming): string {
	requireGeneratedVocabulary(tokenSet);

	const entries: ThemeEntry[] = [
		...schemeDependentEntries(tokenSet, naming),
		...radiusEntries(tokenSet, naming),
		...typographyEntries(tokenSet, naming),
		...trackingEntries(tokenSet, naming),
	];

	return declarationBlock('@theme inline', entries.map(toDeclaration));
}

/**
 * The theme block's colour and shadow entries again, redeclared under `:where(.dark)` inside
 * `@layer theme`, so that a nested `.dark` reaches an arbitrary value naming a theme entry.
 *
 * Tailwind declares each theme entry once, in a `:root, :host` rule. There `--color-brand-500:
 * var(--cmb-color-brand-500)` resolves against the light value, and descendants inherit the resolved
 * colour, not the `var()`. A `.dark` wrapper below the root swaps `--cmb-color-brand-500` on the
 * wrapper and leaves the inherited entry alone, so `bg-[var(--color-brand-500)]` inside it keeps
 * the light colour. Named utilities are fine without this, because `@theme inline` compiles the raw
 * property straight into them. Redeclaring the entry on `.dark` makes it resolve again there.
 * `e2e/stylesheet-dark.spec.ts` measures both in Chromium.
 *
 * Layered because these are Tailwind's own theme names, and `@layer theme` is where Tailwind
 * declares them. Unlayered, this rule would beat every layered declaration of those names on a
 * `.dark` element, the consumer's own theme included.
 *
 * `:where()` because of `<html class="dark">`, the way shadcn switches schemes. There this rule and
 * Tailwind's `:root` rule land on the same element in the same layer, and a consumer's own `@theme`
 * override of a Cambium entry is part of that `:root` rule. At `.dark`'s specificity this rule would
 * beat it, and the consumer's colour would hold in light and lose in dark, named utilities
 * included. At zero specificity `:root` wins on that element. Cambium's dark value still reaches
 * the root through the entry's own `var()`, since that `var()` is what `:root` holds when nobody
 * overrides it. The spec measures the override on the root.
 *
 * Under a nested `.dark` a root override still loses, whatever the selector. The wrapper's own
 * declaration beats the value it would inherit from `:root`, unlayered consumer CSS on `:root`
 * included. A consumer who overrides a Cambium entry and nests `.dark` has to override it under
 * `.dark` as well. The same holds going the other way: a light island inside dark that resets the
 * raw `--cmb-*` values, or a semantic property such as `--primary`, has to reset these entries too,
 * or a named utility and its arbitrary twin paint different colours.
 *
 * Only colour and shadow, because only they vary by scheme; radius, type and tracking are declared
 * on `:root` alone and have nothing to swap. The list comes from `schemeDependentEntries`, which
 * the theme block also calls, and a test holds this layer's declarations equal to the theme
 * block's colour and shadow entries.
 *
 * Parsed first, like `toThemeBlock` and for the same reason; `emitDarkThemeLayer` skips the parse.
 */
export function toDarkThemeLayer(tokenSet: TokenSet, naming: CssNaming): string {
	return emitDarkThemeLayer(parseTokenSet(tokenSet), naming);
}

/** {@link toDarkThemeLayer} on a set `parseTokenSet` has already parsed. */
export function emitDarkThemeLayer(tokenSet: ParsedTokenSet, naming: CssNaming): string {
	requireGeneratedVocabulary(tokenSet);

	const entries = schemeDependentEntries(tokenSet, naming);
	const rule = declarationBlock(DARK_THEME_SELECTOR, entries.map(toDeclaration));
	const indented = rule.replace(/^(?=.)/gm, '\t');

	return `@layer theme {\n${indented}}\n`;
}

/**
 * The colour and shadow entries, the ones whose values differ between schemes. Written once for
 * both the theme block and the dark layer, since an entry missing from the layer keeps its light
 * value under a nested `.dark` and nothing reports it.
 */
function schemeDependentEntries(tokenSet: TokenSet, naming: CssNaming): ThemeEntry[] {
	const { light } = tokenSet.schemes;

	return [
		...colorEntries(light.semantic, light.primitives, naming),
		...shadowEntries(light.shadow, naming),
	];
}

function toDeclaration({ name, reference }: ThemeEntry): { property: string; value: string } {
	return { property: `--${name}`, value: `var(${reference})` };
}

/**
 * The semantic colours, bare on both sides, plus every ramp step and the brand alias, prefixed on
 * the reference side.
 *
 * `--background` sits outside every Tailwind namespace, so `--color-background` and `--background`
 * are two different names and that reference is safe left bare. That holds for every semantic name
 * because `requireGeneratedVocabulary` admits only `SEMANTIC_MAP`'s keys, none of which starts with
 * a namespace root; `naming.semanticProperty` checks nothing itself. A ramp step's raw property never
 * gets it for free — left bare it would be `--color-brand-500` itself, already inside Tailwind's
 * colour namespace, so the entry of the same name would read itself and resolve to nothing — which
 * is why the reference side takes the prefix.
 */
function colorEntries(
	semantic: ColorScheme['semantic'],
	primitives: Record<string, Ramp>,
	naming: CssNaming,
): ThemeEntry[] {
	const semanticEntries = Object.keys(semantic).map((token) => ({
		name: `color-${token}`,
		reference: naming.semanticProperty(token),
	}));

	const rampEntries = Object.entries(primitives).flatMap(([rampName, ramp]) =>
		ramp.map((step) => {
			const name = `color-${rampName}-${stepNumberName(step.step)}`;
			return { name, reference: naming.prefixedProperty(name) };
		}),
	);

	const brand = declaredRamp(primitives, BRAND_RAMP)?.find((step) => step.step === BRAND_STEP);
	const brandEntry = brand
		? [
				{
					name: `color-${BRAND_RAMP}`,
					reference: naming.prefixedProperty(`color-${BRAND_RAMP}`),
				},
			]
		: [];

	return [...semanticEntries, ...rampEntries, ...brandEntry];
}

function radiusEntries(tokenSet: TokenSet, naming: CssNaming): ThemeEntry[] {
	return Object.keys(tokenSet.radius.values).map((name) => {
		const entryName = `radius-${name}`;
		return { name: entryName, reference: naming.prefixedProperty(entryName) };
	});
}

/**
 * Typography fans out across three Tailwind roots because Tailwind has no `typography` root of its
 * own. `toGlobalsCss`'s `scalarDeclarations` makes the same split for the same reason.
 */
function typographyEntries(tokenSet: TokenSet, naming: CssNaming): ThemeEntry[] {
	const { size, weight, lineHeight } = tokenSet.typography.values;

	return [
		...Object.keys(size).map((name) => {
			const entryName = `text-${name}`;
			return { name: entryName, reference: naming.prefixedProperty(entryName) };
		}),
		...Object.keys(weight).map((name) => {
			const entryName = `font-weight-${name}`;
			return { name: entryName, reference: naming.prefixedProperty(entryName) };
		}),
		...Object.keys(lineHeight).map((name) => {
			const entryName = `leading-${name}`;
			return { name: entryName, reference: naming.prefixedProperty(entryName) };
		}),
	];
}

function trackingEntries(tokenSet: TokenSet, naming: CssNaming): ThemeEntry[] {
	return Object.keys(tokenSet.tracking.values).map((name) => {
		const entryName = `tracking-${name}`;
		return { name: entryName, reference: naming.prefixedProperty(entryName) };
	});
}

function shadowEntries(shadow: ShadowScale, naming: CssNaming): ThemeEntry[] {
	return Object.keys(shadow.values).map((step) => {
		const entryName = `shadow-${step}`;
		return { name: entryName, reference: naming.prefixedProperty(entryName) };
	});
}
