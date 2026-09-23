import { BRAND_STEP } from '../step-roles';
import {
	type ColorScheme,
	declaredRamp,
	type Ramp,
	type ShadowScale,
	type TokenSet,
} from '../token-set';
import { BRAND_RAMP, type CssNaming } from './globals-css';
import { stepNumberName } from './step-numbers';

/** One theme entry: the bare Tailwind name and the raw property its `var()` points at. */
type ThemeEntry = { name: string; reference: string };

/**
 * Writes a token set out as the Tailwind v4 `@theme inline { … }` block a shadcn project's
 * `globals.css` carries alongside its custom-property rules.
 *
 * Every entry here is a `var()` reference and never a literal, because a theme entry holding a
 * literal is frozen for the life of the stylesheet, and `toGlobalsCss` (`core/css/globals-css.ts`)
 * is the half of this design that puts scheme-dependent values somewhere a `var()` can reach: under
 * `:root` and `.dark`. Which property each entry points at is not restated here: it comes from the
 * one `CssNaming` that half names its properties by, so the two shapes below describe what comes
 * out rather than a second copy of the rule that could drift from the first.
 *
 * - `--<entry>: var(--<prefix>-<entry>)` for every prefixed property
 * - `--color-<semantic>: var(--<semantic>)` for the semantic colours, which stay bare
 *
 * Property names come from a `CssNaming` (`core/css/globals-css.ts`) rather than from a prefix this
 * module resolves for itself. Every name here has to be the name the other half declares, or the
 * entries point at properties nothing declares: a stylesheet that parses and paints nothing. One
 * naming object handed to both halves is what makes them agree by construction; a second copy of
 * the rule, or a second reading of the same prefix, would leave the agreement to a comment.
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
 * Names come off the token set's own semantic layer, ramp keys and scalar keys rather than off
 * `SEMANTIC_MAP` or a hardcoded ramp list, the way `toGlobalsCss` already reads its own inputs: a
 * set short a ramp, or one carrying a semantic key `SEMANTIC_MAP` never named, still gets exported
 * exactly as it holds it. The one name that does not survive is one a Tailwind namespace already
 * claims, which `CssNaming` refuses on both halves rather than emitting an entry that would rebind
 * a utility in the consuming project.
 *
 * Property names only, taken from the light scheme. A theme entry does not carry a colour, so it
 * cannot itself be scheme-dependent, and reading one scheme's names is exactly right when the two
 * schemes agree. This function does no such checking itself; `toGlobalsCss`'s own mirror check is
 * what enforces that light and dark name the same semantic tokens, ramps and shadow steps for any
 * set the two adapters share.
 *
 * Pure in the sense `serializeDtcg` (`core/dtcg/serialize.ts`) states the contract: same token set
 * in, same bytes out. Nothing here reads the DOM, the network, storage or module state, and the
 * token set is read and never written.
 */
export function toThemeBlock(tokenSet: TokenSet, naming: CssNaming): string {
	const { light } = tokenSet.schemes;

	const entries: ThemeEntry[] = [
		...colorEntries(light.semantic, light.primitives, naming),
		...radiusEntries(tokenSet, naming),
		...typographyEntries(tokenSet, naming),
		...trackingEntries(tokenSet, naming),
		...shadowEntries(light.shadow, naming),
	];

	const body = entries.map(({ name, reference }) => `\t--${name}: var(${reference});\n`).join('');

	return `@theme inline {\n${body}}\n`;
}

/**
 * The semantic colours, bare on both sides, plus every ramp step and the brand alias, prefixed on
 * the reference side.
 *
 * `--background` sits outside every Tailwind namespace, so `--color-background` and `--background`
 * are two different names and that reference is safe left bare. `naming.semanticProperty` is what
 * establishes that rather than assumes it: a token whose own name lands inside a namespace is
 * refused there, on this side and on the declaring side at once. A ramp step's raw property never
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
