import type { Oklch } from '../oklch';
import { resolveScheme } from '../resolve-scheme';
import { BRAND_STEP } from '../step-roles';
import {
	type DimensionValue,
	declaredRamp,
	type Ramp,
	type Shadow,
	type ShadowScale,
	type SignedDimensionValue,
	type TokenSet,
} from '../token-set';
import { formatCssNumber, toOklchCss } from './oklch-css';
import { stepNumberName } from './step-numbers';

/**
 * Dark is a class rather than a `prefers-color-scheme` query. `app/globals.css` declares
 * `@custom-variant dark (&:is(.dark *))`, so every `dark:` utility Tailwind generates resolves
 * against that class, and a media query would paint a page the reader had switched to light.
 */
const LIGHT_SELECTOR = ':root';
const DARK_SELECTOR = '.dark';

const DEFAULT_PREFIX = 'cmb';

/**
 * A name segment run both adapters will emit: ASCII letters, digits and underscores, joined by
 * single hyphens, with none leading or trailing.
 *
 * Narrower than CSS's own identifier grammar on purpose. Every name here reaches two consumers,
 * PostCSS and Tailwind, and Tailwind reads more into a name than CSS does: a `--` inside a theme
 * key marks what follows as a companion of the key before it, so `--text-base--line-height` is
 * `text-base`'s line height and not a size. Refusing any doubled hyphen closes that for every
 * companion Tailwind has or adds later, and it rules out a leading or trailing hyphen for the same
 * reason, since either one doubles up against the hyphen the adapters join names with. Non-ASCII
 * would parse; nothing Cambium generates uses it, so it is refused rather than argued.
 */
const SOUND_NAME = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*$/;

/** The one ramp that also gets an unnumbered name. See {@link rampDeclarations}. */
export const BRAND_RAMP = 'brand';

/**
 * Every theme namespace root Tailwind v4 claims, read off the installed `tailwindcss/theme.css` at
 * 4.3.3 rather than from memory. A custom property whose name is one of these, or begins with one
 * followed by a hyphen, is a theme entry as far as Tailwind is concerned, so it cannot also be the
 * raw property an `@theme inline` entry reads from.
 *
 * `spacing` is the one whose stock theme declares no `--spacing-*` entries at all, only the bare
 * base variable `--spacing`. Both halves of the check still bite: a `--spacing` of ours would
 * rescale every spacing utility in the consuming project, and 4.3.3 looks a `--spacing-md` up as a
 * theme variable before falling back to its `--spacing()` function, so one of ours would answer
 * that lookup.
 */
const TAILWIND_NAMESPACES = [
	'animate',
	'aspect',
	'blur',
	'breakpoint',
	'color',
	'container',
	'default',
	'drop',
	'ease',
	'font',
	'inset',
	'leading',
	'max',
	'perspective',
	'radius',
	'shadow',
	'spacing',
	'text',
	'tracking',
] as const;

/** Options controlling how {@link cssNaming} names the properties an adapter writes. */
export type CssNamingOptions = {
	/**
	 * Namespace carried by every property except the semantic colours, without the leading `--` and
	 * without the trailing hyphen. Defaults to `cmb`.
	 */
	prefix?: string;
};

/**
 * The one naming rule both adapters write properties through.
 *
 * A token set exports as two halves: the scheme rules `toGlobalsCss` writes, and the `@theme
 * inline` block `toThemeBlock` (`core/css/theme-block.ts`) writes, in which every entry is a
 * `var()` pointing at a property the first half declares. Two copies of the rule would put that
 * agreement one careless edit away from a stylesheet that parses and leaves every prefixed utility
 * without a value, so there is one copy and both halves take it as an argument rather than each
 * building its own from a prefix.
 *
 * Taking it as an argument is also what makes a mismatched pair cost a deliberate act. Neither half
 * defaults the naming, so `toThemeBlock(set)` beside `toGlobalsCss(set, cssNaming({ prefix }))`
 * does not compile; producing halves that disagree takes two `cssNaming` calls with two different
 * prefixes, written out. `toStylesheet` (`core/css/stylesheet.ts`) is the entry point that hands
 * one naming to both and is what a caller wanting a working stylesheet should reach for.
 */
export type CssNaming = {
	/** `--cmb-shadow-md` for the Tailwind entry name `shadow-md`. */
	prefixedProperty(entry: string): string;
	/** `--background` for the semantic token `background`. */
	semanticProperty(token: string): string;
};

/** Resolves {@link CssNamingOptions} into the {@link CssNaming} both adapters name properties by. */
export function cssNaming(options: CssNamingOptions = {}): CssNaming {
	const prefix = options.prefix ?? DEFAULT_PREFIX;

	// Checked here, once, rather than left to the block writer, because a prefix also reaches the
	// output inside the theme block's `var()` references, which `declarationBlock` never reads as
	// names. The empty prefix passes this and is refused by the namespace check instead.
	if (prefix !== '' && !SOUND_NAME.test(prefix)) {
		throw new Error(
			`prefix "${prefix}" is not a run of hyphen-separated letters, digits and underscores, so the properties it names would not reach a consumer intact`,
		);
	}

	return {
		prefixedProperty: (entry: string) => prefixedProperty(entry, prefix),
		semanticProperty,
	};
}

/** One custom-property declaration, before it is joined into a block. */
export type CssDeclaration = { property: string; value: string };

/**
 * Writes a token set out as the custom-property blocks a shadcn project drops into its
 * `globals.css`: the two colour schemes, their ramps and shadows, and the scalars that hold still
 * across both.
 *
 * Every declaration carries a value, because CSS has nowhere to put an alias. `ramp.step` is how
 * the semantic layer is authored and how it stays honest when a ramp moves, so `resolveScheme`
 * flattens each token to the three OKLCH channels it names and `toOklchCss` prints them.
 * Flattening there rather than here keeps a dangling alias a thrown error instead of a declaration
 * the browser drops.
 *
 * Every value lives here; `core/css/theme-block.ts` emits nothing but `var()` references. An
 * `@theme inline` entry holding a literal is frozen at one value for the whole stylesheet, and half
 * of what this set holds is scheme-dependent: a shadow's colour put there would fix the dark page's
 * shadow to the light page's tint. Splitting the two at the category level, rather than deciding it
 * token by token, keeps the theme block uniform enough to read.
 *
 * Semantic colours are bare: `--background`, `--foreground`, and so on, exactly as shadcn writes
 * them, which keeps this output drop-in for a project whose components already read those names.
 * Bare works for those names because none of them starts with a Tailwind namespace root, so
 * `--color-background: var(--background)` names two different properties. That is a fact about the
 * names rather than about the category, and `SemanticLayerSchema` keys on any non-empty string, so
 * `semanticProperty` checks each one against the same table the prefixed properties are checked
 * against instead of taking the category's word for it.
 *
 * Everything else carries `prefix`, because bare would not survive the move. Bare, `--shadow-md`
 * is already Tailwind's shadow namespace, so the theme entry `--shadow-md: var(--shadow-md)` reads
 * itself and resolves to nothing: a stylesheet that parses and paints no shadow. A ramp step is a
 * colour and still lands in that group, because its theme entry is `--color-brand-500`, which sits
 * inside the colour namespace that a semantic name has to stay out of to be emitted at all. Strip
 * the prefix from what this emits and what is left is the Tailwind v4 theme entry the property maps
 * onto.
 *
 * - `--cmb-color-brand-500` → `--color-brand-500` (a ramp step; see {@link rampDeclarations})
 * - `--cmb-shadow-md` → `--shadow-md`
 * - `--cmb-radius-lg` → `--radius-lg`
 * - `--cmb-text-base` → `--text-base` (a typography size)
 * - `--cmb-font-weight-regular` → `--font-weight-regular`
 * - `--cmb-leading-normal` → `--leading-normal` (a line height)
 * - `--cmb-tracking-normal` → `--tracking-normal`
 *
 * So the theme block writes `--<entry>: var(--<prefix>-<entry>)` and needs no table mapping an
 * entry onto its property. It does spell each category's entry name again (`font-weight-${name}`
 * and the rest are written out in both files), so a root renamed on one side only is not prevented
 * here. `theme-block.test.ts` catches it: every `var()` the theme block writes has to name a
 * property this adapter declares.
 *
 * A property that lands inside a namespace is refused by name rather than skipped, the same call
 * `resolveScheme` and `stepNumberName` make: the alternative is an export that is short a token and
 * says so nowhere. Both sides of the prefix are refused by the one rule — a prefix that walks a
 * property back inside a namespace, and a semantic token whose own name is already there. An empty
 * prefix therefore always throws: `PrimitiveLayerSchema` requires at least one ramp and
 * `TokenSetSchema` requires radius, typography and tracking, so every set reaching this carries
 * something that would land bare inside a namespace.
 *
 * The shadows come from `schemes.light.shadow` and `schemes.dark.shadow`, never from the top-level
 * `tokenSet.shadow`. `checkMirroredLayers` pins that top-level copy to the light scheme's, so
 * reading it would cast the light page's shadow under `.dark`. That substitution renders cleanly
 * and looks like a shadow that simply failed to darken.
 *
 * Pure in the sense the acceptance criterion asks for: same token set in, same bytes out, key order
 * included (`toStylesheet` in `core/css/stylesheet.ts` says why). Nothing reads the DOM, the
 * network, storage, or module state, and the token set is read and never written. That is the
 * contract `serializeDtcg` (`core/dtcg/serialize.ts`) states for the `DtcgDocumentPair` it
 * returns. This adapter needs no counterpart to that file's defensive clone, because it hands back
 * a string it built rather than any part of the token set.
 *
 * `serializeDtcg` parses its argument first and this does not. That parse buys DTCG a hue of
 * exactly 360 folded to 0, which the vendored schema rejects and CSS accepts, so parsing here would
 * only add a second opinion on a set `resolveScheme` already refuses to flatten.
 *
 * Scope is the two scheme blocks. The `@theme inline` block that maps these properties onto
 * Tailwind's namespaces is `core/css/theme-block.ts`, and the `@custom-variant dark` line that
 * makes `.dark` mean anything belongs to `toStylesheet` (`core/css/stylesheet.ts`), which assembles
 * the whole file from the two halves and is what a caller should reach for.
 */
export function toGlobalsCss(tokenSet: TokenSet, naming: CssNaming): string {
	const light = resolveScheme(tokenSet.schemes.light);
	const dark = resolveScheme(tokenSet.schemes.dark);

	requireMirroredNames('semantic tokens', Object.keys(light), Object.keys(dark));
	requireMirroredNames(
		'shadow steps',
		Object.keys(tokenSet.schemes.light.shadow.values),
		Object.keys(tokenSet.schemes.dark.shadow.values),
	);
	requireMirroredNames(
		'ramp steps',
		rampStepNames(tokenSet.schemes.light.primitives),
		rampStepNames(tokenSet.schemes.dark.primitives),
	);

	// Both blocks run in the light scheme's order, so a reader comparing them is looking at values
	// instead of at a reordering. The two token sets are equal by the check above, so taking the
	// order from one of them loses nothing.
	const tokens = Object.keys(light);

	// The ramps trail the shadow rather than joining the semantic colours above it. Eighty-five of
	// them land at once for a seven-ramp set, and a reader editing a pasted stylesheet is looking for
	// the semantic names they recognise.
	const rootBody = [
		...colorDeclarations(tokens, light, naming),
		...shadowDeclarations(tokenSet.schemes.light.shadow, naming),
		...rampDeclarations(tokenSet.schemes.light.primitives, naming),
		...scalarDeclarations(tokenSet, naming),
	];

	const darkBody = [
		...colorDeclarations(tokens, dark, naming),
		...shadowDeclarations(tokenSet.schemes.dark.shadow, naming),
		...rampDeclarations(tokenSet.schemes.dark.primitives, naming),
	];

	return `${declarationBlock(LIGHT_SELECTOR, rootBody)}\n${declarationBlock(DARK_SELECTOR, darkBody)}`;
}

/**
 * Joins declarations into one block, refusing any property the consumer would not read back as
 * exactly the one property it was written as. Both adapters write every block through here, which
 * is what makes this the one place the rule is enforced rather than one copy per adapter.
 *
 * Two ways a name fails. It is not a {@link SOUND_NAME}, so PostCSS stops at the first space or
 * Tailwind reads a `--` suffix as another entry's companion. Or it repeats within the block: two
 * tokens in the set mapped onto one name, and Tailwind keeps the last theme entry and a browser the
 * last declaration, so one token loses its utility with nothing logged. A semantic `brand-500`
 * beside ramp step 7 is that case, both landing on `--color-brand-500`.
 *
 * Unique within each block is unique across the output. The namespace check in
 * {@link prefixedProperty} and {@link semanticProperty} keeps every scheme-rule property outside
 * Tailwind's namespaces, and every theme entry sits inside one, so the two halves cannot share a
 * name. `:root` and `.dark` repeating each other is the design: it is how a scheme swaps values.
 */
export function declarationBlock(header: string, declarations: readonly CssDeclaration[]): string {
	const seen = new Set<string>();

	for (const { property } of declarations) {
		if (!property.startsWith('--') || !SOUND_NAME.test(property.slice(2))) {
			throw new Error(
				`${property} is not a name every consumer reads as one property: it has to be letters, digits and underscores joined by single hyphens. Rename the token it came from`,
			);
		}
		if (seen.has(property)) {
			throw new Error(
				`${header} would declare ${property} twice, so two tokens in this set map onto one name and the consumer keeps only the last; rename one of them`,
			);
		}
		seen.add(property);
	}

	const body = declarations.map(({ property, value }) => `\t${property}: ${value};\n`).join('');

	return `${header} {\n${body}}\n`;
}

function colorDeclarations(
	tokens: readonly string[],
	colors: Record<string, Oklch>,
	naming: CssNaming,
): CssDeclaration[] {
	return tokens.map((token) => ({
		property: naming.semanticProperty(token),
		value: toOklchCss(colors[token]!),
	}));
}

function shadowDeclarations(scale: ShadowScale, naming: CssNaming): CssDeclaration[] {
	return Object.entries(scale.values).map(([step, shadow]) => ({
		property: naming.prefixedProperty(`shadow-${step}`),
		value: boxShadow(shadow),
	}));
}

/**
 * Every ramp step under its conventional number, plus the unnumbered brand alias.
 *
 * Cambium's ramps run 1 through 12 and the ecosystem this exports into runs 25 through 950, so a
 * step emitted under its own index would hand a consumer `bg-brand-9` where every Tailwind habit
 * says `bg-brand-500`. `stepNumberName` is the table that mapping lives in, and it argues there why
 * it is a lookup rather than a formatter.
 *
 * The ramp names come off the token set instead of `RAMP_NAMES`, the way the semantic layer is
 * already read. `PrimitiveLayerSchema` accepts any non-empty record, so a set carrying some other
 * spread of ramps still has to export every ramp it holds.
 *
 * Declared per scheme, because `primitives` sits inside `ColorSchemeSchema` and light and dark hold
 * different ramps. Same reasoning that put the shadows under both selectors: an `@theme` entry
 * holding a literal is frozen at one value, so a scheme-dependent colour cannot be one.
 *
 * `--<prefix>-color-brand` carries no number, and only brand gets it. `BRAND_STEP` is 9 and step
 * 9's conventional name is 700, so the brand colour answers to `brand-700`, while `bg-brand-500`
 * lands on step 7. That is the name most consumers would reach for first, so the unnumbered alias
 * gives the brand colour one that holds still if the numbering ever moves.
 *
 * `SEMANTIC_MAP` already aliases `primary` to `brand.9`, so `bg-primary` is the brand colour under
 * shadcn's own contract. `--<prefix>-color-brand` is the ramp-side spelling of the same colour, for
 * a consumer thinking in ramps rather than in roles.
 *
 * The other six ramps get no such alias. `accent` is the one that would collide: it is a key of
 * `SEMANTIC_MAP` too, so `--color-accent` is taken, and the semantic `accent` aliases `neutral.4`.
 * The two names would carry different colours and the semantic one has to win. Handing the
 * remaining five an alias each would leave six ramps out of seven following a rule, which is the
 * shape a consumer trips over, so brand stays the one exception.
 */
function rampDeclarations(primitives: Record<string, Ramp>, naming: CssNaming): CssDeclaration[] {
	const steps = Object.entries(primitives).flatMap(([name, ramp]) =>
		ramp.map((step) => ({
			property: naming.prefixedProperty(`color-${rampStepName(name, step.step)}`),
			value: toOklchCss(step),
		})),
	);

	const brand = declaredRamp(primitives, BRAND_RAMP)?.find((step) => step.step === BRAND_STEP);

	if (!brand) return steps;

	return [
		...steps,
		{ property: naming.prefixedProperty(`color-${BRAND_RAMP}`), value: toOklchCss(brand) },
	];
}

/**
 * One ramp step's entry name, `brand-500`, which prefixes into the property the theme block reads
 * and un-prefixes back into Tailwind's own `--color-brand-500`.
 */
function rampStepName(ramp: string, step: number): string {
	return `${ramp}-${stepNumberName(step)}`;
}

/**
 * Every entry name one scheme's ramps produce, for the mirror check.
 *
 * Compared as step names rather than as ramp names, because the properties are what has to line up
 * across the two selectors. `RampSchema` fixes every ramp at steps 1 through 12 today, so the two
 * comparisons agree; naming the steps keeps that a coincidence instead of a dependency.
 */
function rampStepNames(primitives: Record<string, Ramp>): string[] {
	return Object.entries(primitives).flatMap(([name, ramp]) =>
		ramp.map((step) => rampStepName(name, step.step)),
	);
}

/**
 * A shadow token's five parts as one `box-shadow` value.
 *
 * The order is CSS's, not the token's: `<offset-x> <offset-y> <blur> <spread>` and then the colour.
 * A compositor reads the four lengths by position, so a spread emitted where the blur belongs
 * renders as a shadow, wrongly and with nothing logged.
 *
 * The colour goes through `toOklchCss` carrying its alpha. A shadow is the one colour in the set
 * whose whole job is to be partly transparent, and `ShadowColorSchema` requires the channel for
 * exactly that reason; dropping it would paint an opaque slab.
 */
function boxShadow(shadow: Shadow): string {
	const geometry = [shadow.offsetX, shadow.offsetY, shadow.blur, shadow.spread]
		.map((dimension) => length(dimension))
		.join(' ');

	return `${geometry} ${toOklchCss(shadow.color)}`;
}

/**
 * The categories that sit at the top level because none of them varies by scheme, flattened onto
 * their Tailwind entry names. Typography is the one category that fans out: Tailwind has no
 * `typography` root, and its sizes, weights and line heights land under `text`, `font-weight` and
 * `leading` respectively.
 */
function scalarDeclarations(tokenSet: TokenSet, naming: CssNaming): CssDeclaration[] {
	const { size, weight, lineHeight } = tokenSet.typography.values;

	return [
		...Object.entries(tokenSet.radius.values).map(([name, dimension]) => ({
			property: naming.prefixedProperty(`radius-${name}`),
			value: length(dimension),
		})),
		...Object.entries(size).map(([name, dimension]) => ({
			property: naming.prefixedProperty(`text-${name}`),
			value: length(dimension),
		})),
		...Object.entries(weight).map(([name, token]) => ({
			property: naming.prefixedProperty(`font-weight-${name}`),
			value: formatCssNumber(token.value),
		})),
		...Object.entries(lineHeight).map(([name, token]) => ({
			property: naming.prefixedProperty(`leading-${name}`),
			value: formatCssNumber(token.value),
		})),
		...Object.entries(tokenSet.tracking.values).map(([name, dimension]) => ({
			property: naming.prefixedProperty(`tracking-${name}`),
			value: length(dimension),
		})),
	];
}

/**
 * Prefixes a Tailwind entry name into the raw custom property that holds its value, refusing the
 * result if it landed back inside a namespace.
 *
 * Both the exact match and the hyphenated descendant are rejected, because Tailwind claims roots
 * in both forms: `--spacing` is a theme variable on its own and `--shadow-md` is one under
 * `shadow`.
 *
 * With the empty prefix the raw property is the theme entry's own name, so
 * `--shadow-md: var(--shadow-md)` reads itself and the utility gets no value. The stylesheet still
 * parses, which is why that earns a throw and not a warning.
 *
 * A prefix that is itself a root, such as `text`, fails differently or not yet. `--text-shadow-md`
 * is a different name from `--shadow-md`, so nothing reads itself. What it is instead is a name
 * inside a namespace Tailwind owns, the same position that makes a semantic `blur-sm` rebind
 * Tailwind's own `blur-sm` utility (see {@link semanticProperty}). In 4.3.3 none of the names
 * `text` produces is one a stock utility reads through `var()`: the stock theme does declare
 * `--text-shadow-md`, but `text-shadow-md` compiles its value inline. So `text` is refused because
 * the rule is about the position, not a lookup of which names the stock theme happens to read
 * today, and a later Tailwind could start reading any of them.
 */
function prefixedProperty(name: string, prefix: string): string {
	const property = prefix === '' ? name : `${prefix}-${name}`;
	const namespace = claimedNamespace(property);

	if (namespace) {
		throw new Error(
			`--${property} falls inside Tailwind's "${namespace}" namespace, where it is either the theme entry's own name or one Tailwind's theme can claim; prefix "${prefix}" cannot carry the token "${name}"`,
		);
	}

	return `--${property}`;
}

/**
 * A semantic token's property, left bare, refusing a token whose own name lands inside a namespace.
 *
 * Bare is what makes this output drop-in — a shadcn project's components read `--background` by
 * that name — and it is safe for every name shadcn ships, because none of them starts with a
 * namespace root. That is a property of those names and not of the category: `SemanticLayerSchema`
 * keys on any non-empty string, so the layer that built the set decides what arrives here.
 *
 * A token named `blur-sm` arrives bare as `--blur-sm`, which is the property Tailwind's own
 * `blur-sm` utility reads for its radius. The consuming project's stock theme declares it inside
 * `@layer theme`, and a pasted `:root` rule is unlayered, so ours wins the cascade wherever the two
 * land and `blur-sm` resolves a length to an `oklch()` colour. The declaration is dropped at
 * computed-value time with nothing logged: the utility simply stops working.
 *
 * So the same rule bites on both sides of the prefix. A prefix cannot rescue this one, because a
 * semantic colour never takes one; the token itself is what has to be renamed, and refusing it by
 * name is the only way the caller hears about it.
 */
function semanticProperty(token: string): string {
	const namespace = claimedNamespace(token);

	if (namespace) {
		throw new Error(
			`--${token} falls inside Tailwind's "${namespace}" namespace, so declaring the semantic token "${token}" bare would rebind the property that namespace's utilities read; the token has to be renamed`,
		);
	}

	return `--${token}`;
}

/** The Tailwind namespace root a property name falls under, exactly or as a descendant. */
function claimedNamespace(property: string): string | undefined {
	return TAILWIND_NAMESPACES.find((root) => property === root || property.startsWith(`${root}-`));
}

/**
 * Refuses a set whose two schemes name different per-scheme tokens instead of emitting the union.
 *
 * A property declared under `:root` and missing under `.dark` falls back to the light scheme's
 * value rather than to nothing, so a dark page paints that token in a colour meant for a white
 * background and renders with no error anywhere. Both directions are checked, because a token only
 * the dark scheme declares is the same failure with the schemes swapped.
 *
 * Nothing upstream catches it. `checkMirroredLayers` compares the unprefixed layers against
 * `schemes.light` and never puts the two schemes beside each other, and `SemanticLayerSchema` and
 * `ShadowScaleSchema` each accept any non-empty record. So the guarantee has to be made where the
 * two schemes first meet.
 *
 * Scoped to the per-scheme categories on purpose. Radius, typography and tracking are declared
 * under `:root` alone and have no dark counterpart to mirror, so widening this to compare whole
 * property sets would reject every set that reaches it.
 */
function requireMirroredNames(
	label: string,
	light: readonly string[],
	dark: readonly string[],
): void {
	const missingFromDark = absentFrom(dark, light);
	const missingFromLight = absentFrom(light, dark);

	if (missingFromDark.length === 0 && missingFromLight.length === 0) return;

	const complaints = [
		missingFromDark.length > 0 && `the dark scheme declares no ${missingFromDark.join(', ')}`,
		missingFromLight.length > 0 && `the light scheme declares no ${missingFromLight.join(', ')}`,
	].filter(Boolean);

	throw new Error(`the two schemes must name the same ${label}: ${complaints.join('; ')}`);
}

function absentFrom(from: readonly string[], present: readonly string[]): string[] {
	const held = new Set(from);

	return present.filter((name) => !held.has(name));
}

/**
 * A dimension as a CSS length. The unit always prints, `0px` included, so the token's own unit
 * survives the export.
 */
function length(dimension: DimensionValue | SignedDimensionValue): string {
	return `${formatCssNumber(dimension.value)}${dimension.unit}`;
}
