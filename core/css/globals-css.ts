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
import { toOklchCss } from './oklch-css';
import { stepNumberName } from './step-numbers';

/**
 * Dark is a class rather than a `prefers-color-scheme` query. `app/globals.css` declares
 * `@custom-variant dark (&:is(.dark *))`, so every `dark:` utility Tailwind generates resolves
 * against that class, and a media query would paint a page the reader had switched to light.
 */
const LIGHT_SELECTOR = ':root';
const DARK_SELECTOR = '.dark';

const DEFAULT_PREFIX = 'cmb';

/** The one ramp that also gets an unnumbered name. See {@link rampDeclarations}. */
const BRAND_RAMP = 'brand';

/**
 * Decimals a scalar rounds to. Matches `toOklchCss`'s default, so the geometry and the colour
 * inside one shadow declaration print at one precision.
 */
const PLACES = 6;

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

/** Options controlling how {@link toGlobalsCss} names the properties it writes. */
export type GlobalsCssOptions = {
	/**
	 * Namespace carried by every property except the semantic colours, without the leading `--` and
	 * without the trailing hyphen. Defaults to `cmb`.
	 */
	prefix?: string;
};

/** One custom-property declaration, before it is joined into a rule body. */
type CssDeclaration = { property: string; value: string };

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
 * Bare is safe for a colour because Tailwind's colour namespace is `--color-*`, so a theme entry
 * `--color-background: var(--background)` names two different properties.
 *
 * Everything else carries `prefix`, because the same trick does not survive the move. Bare,
 * `--shadow-md` is already Tailwind's shadow namespace, so the theme entry
 * `--shadow-md: var(--shadow-md)` reads itself and resolves to nothing: a stylesheet that parses
 * and paints no shadow. A ramp step is a colour and still lands in that group, because its theme
 * entry is `--color-brand-500`, which sits inside the colour namespace where a semantic name never
 * does. Strip the prefix from what this emits and what is left is the Tailwind v4 theme entry the
 * property maps onto.
 *
 * - `--cmb-color-brand-500` → `--color-brand-500` (a ramp step; see {@link rampDeclarations})
 * - `--cmb-shadow-md` → `--shadow-md`
 * - `--cmb-radius-lg` → `--radius-lg`
 * - `--cmb-text-base` → `--text-base` (a typography size)
 * - `--cmb-font-weight-regular` → `--font-weight-regular`
 * - `--cmb-leading-normal` → `--leading-normal` (a line height)
 * - `--cmb-tracking-normal` → `--tracking-normal`
 *
 * So the theme block writes `--<entry>: var(--<prefix>-<entry>)` and needs no second table mapping
 * category names onto namespaces.
 *
 * A prefix that walks a property back inside a namespace is refused by name rather than skipped,
 * the same call `resolveScheme` and `stepNumberName` make: the alternative is an export that is
 * short a token and says so nowhere. An empty prefix therefore always throws: `PrimitiveLayerSchema`
 * requires at least one ramp and `TokenSetSchema` requires radius, typography and tracking, so
 * every set reaching this carries something that would land bare inside a namespace.
 *
 * The shadows come from `schemes.light.shadow` and `schemes.dark.shadow`, never from the top-level
 * `tokenSet.shadow`. `checkMirroredLayers` pins that top-level copy to the light scheme's, so
 * reading it would cast the light page's shadow under `.dark`. That substitution renders cleanly
 * and looks like a shadow that simply failed to darken.
 *
 * Pure in the sense the acceptance criterion asks for: same token set in, same bytes out. Nothing
 * reads the DOM, the network, storage, or module state, and the token set is read and never
 * written. That is the contract `serializeDtcg` (`core/dtcg/serialize.ts`) states for the
 * `DtcgDocumentPair` it returns. This adapter needs no counterpart to that file's defensive clone,
 * because it hands back a string it built rather than any part of the token set.
 *
 * `serializeDtcg` parses its argument first and this does not. That parse buys DTCG a hue of
 * exactly 360 folded to 0, which the vendored schema rejects and CSS accepts, so parsing here would
 * only add a second opinion on a set `resolveScheme` already refuses to flatten.
 *
 * Scope is the two scheme blocks. The `@theme inline` block that maps these properties onto
 * Tailwind's namespaces is `core/css/theme-block.ts`, and the `@import` and `@custom-variant`
 * preamble belongs to whatever assembles a whole file from the two.
 */
export function toGlobalsCss(tokenSet: TokenSet, options: GlobalsCssOptions = {}): string {
	const prefix = options.prefix ?? DEFAULT_PREFIX;

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
		...colorDeclarations(tokens, light),
		...shadowDeclarations(tokenSet.schemes.light.shadow, prefix),
		...rampDeclarations(tokenSet.schemes.light.primitives, prefix),
		...scalarDeclarations(tokenSet, prefix),
	];

	const darkBody = [
		...colorDeclarations(tokens, dark),
		...shadowDeclarations(tokenSet.schemes.dark.shadow, prefix),
		...rampDeclarations(tokenSet.schemes.dark.primitives, prefix),
	];

	return `${rule(LIGHT_SELECTOR, rootBody)}\n${rule(DARK_SELECTOR, darkBody)}`;
}

function rule(selector: string, declarations: readonly CssDeclaration[]): string {
	const body = declarations.map(({ property, value }) => `\t${property}: ${value};\n`).join('');

	return `${selector} {\n${body}}\n`;
}

function colorDeclarations(
	tokens: readonly string[],
	colors: Record<string, Oklch>,
): CssDeclaration[] {
	return tokens.map((token) => ({ property: `--${token}`, value: toOklchCss(colors[token]!) }));
}

function shadowDeclarations(scale: ShadowScale, prefix: string): CssDeclaration[] {
	return Object.entries(scale.values).map(([step, shadow]) => ({
		property: prefixedProperty(`shadow-${step}`, prefix),
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
function rampDeclarations(primitives: Record<string, Ramp>, prefix: string): CssDeclaration[] {
	const steps = Object.entries(primitives).flatMap(([name, ramp]) =>
		ramp.map((step) => ({
			property: prefixedProperty(`color-${rampStepName(name, step.step)}`, prefix),
			value: toOklchCss(step),
		})),
	);

	const brand = declaredRamp(primitives, BRAND_RAMP)?.find((step) => step.step === BRAND_STEP);

	if (!brand) return steps;

	return [
		...steps,
		{ property: prefixedProperty(`color-${BRAND_RAMP}`, prefix), value: toOklchCss(brand) },
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
function scalarDeclarations(tokenSet: TokenSet, prefix: string): CssDeclaration[] {
	const { size, weight, lineHeight } = tokenSet.typography.values;

	return [
		...Object.entries(tokenSet.radius.values).map(([name, dimension]) => ({
			property: prefixedProperty(`radius-${name}`, prefix),
			value: length(dimension),
		})),
		...Object.entries(size).map(([name, dimension]) => ({
			property: prefixedProperty(`text-${name}`, prefix),
			value: length(dimension),
		})),
		...Object.entries(weight).map(([name, token]) => ({
			property: prefixedProperty(`font-weight-${name}`, prefix),
			value: formatNumber(token.value),
		})),
		...Object.entries(lineHeight).map(([name, token]) => ({
			property: prefixedProperty(`leading-${name}`, prefix),
			value: formatNumber(token.value),
		})),
		...Object.entries(tokenSet.tracking.values).map(([name, dimension]) => ({
			property: prefixedProperty(`tracking-${name}`, prefix),
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
 * `shadow`. Either collision leaves the `@theme inline` entry and the property it reads sharing a
 * name, so the entry resolves to nothing and the utility it feeds has no value to paint. The
 * stylesheet still parses, which is why the collision earns a throw and not a warning.
 */
function prefixedProperty(name: string, prefix: string): string {
	const property = prefix === '' ? name : `${prefix}-${name}`;
	const namespace = TAILWIND_NAMESPACES.find(
		(root) => property === root || property.startsWith(`${root}-`),
	);

	if (namespace) {
		throw new Error(
			`--${property} falls inside Tailwind's "${namespace}" namespace, so the theme entry reading it would reference itself; prefix "${prefix}" cannot carry the token "${name}"`,
		);
	}

	return `--${property}`;
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
	return `${formatNumber(dimension.value)}${dimension.unit}`;
}

/**
 * A scalar rounded and trimmed the way `toOklchCss` treats a channel, so a shadow's geometry and
 * its colour print at one precision inside the one declaration that holds both.
 *
 * Rounding at all is about the arithmetic upstream, not about the tokens: a derived tracking or
 * type scale is a chain of floating-point multiplications, and `0.30000000000000004em` is a length
 * every browser accepts and no reader can audit against the scale that produced it.
 *
 * Zero folds to the bare digit, negative zero included, for the reason `roundTo` in `core/oklch.ts`
 * gives: round-off can carry a value across zero from below, and `-0px` is a literal some CSS
 * tooling still trips over.
 */
function formatNumber(value: number): string {
	const scale = 10 ** PLACES;
	const rounded = Math.round(value * scale) / scale;

	if (rounded === 0) return '0';

	return rounded.toFixed(PLACES).replace(/0+$/, '').replace(/\.$/, '');
}
