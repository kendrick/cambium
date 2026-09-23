import { BRAND_STEP } from '../step-roles';
import { declaredRamp, type Ramp, type TokenSet } from '../token-set';
import type { GlobalsCssOptions } from './globals-css';
import { stepNumberName } from './step-numbers';

/** The one ramp that also gets an unnumbered name. Mirrors `toGlobalsCss`'s own constant. */
const BRAND_RAMP = 'brand';

/** One theme entry: the bare Tailwind name and the raw property its `var()` points at. */
type ThemeEntry = { name: string; reference: string };

/**
 * Writes a token set out as the Tailwind v4 `@theme inline { … }` block a shadcn project's
 * `globals.css` carries alongside its custom-property rules.
 *
 * Every entry here is a `var()` reference and never a literal, because a theme entry holding a
 * literal is frozen for the life of the stylesheet, and `toGlobalsCss` (`core/css/globals-css.ts`)
 * is the half of this design that puts scheme-dependent values somewhere a `var()` can reach: under
 * `:root` and `.dark`. This module reads that other file's own docblock for exactly which property
 * name answers to which entry, and states the same rule the other file states, mechanically:
 *
 * - `--<entry>: var(--<prefix>-<entry>)` for every prefixed property
 * - `--color-<semantic>: var(--<semantic>)` for the semantic colours, which stay bare
 *
 * `prefix` (`GlobalsCssOptions`, imported from `globals-css.ts` rather than redeclared here) has to
 * be the value a caller also hands `toGlobalsCss`, or the two halves point at properties the other
 * file never declares. Sharing the one type instead of declaring a second, structurally identical
 * one is what keeps that requirement from being only a comment.
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
 * The brand ramp alone gets an unnumbered `--color-brand` entry, for the reason `toGlobalsCss`
 * gives for the property it points at: `BRAND_STEP` (`core/step-roles.ts`) is 9 for every ramp, not
 * a property brand alone carries, but brand is the one ramp `SEMANTIC_MAP` also reaches by role
 * (`primary`), so it is the one worth a second, role-shaped name.
 *
 * Names come off the token set's own semantic layer, ramp keys and scalar keys rather than off
 * `SEMANTIC_MAP` or a hardcoded ramp list, the way `toGlobalsCss` already reads its own inputs: a
 * set short a ramp, or one carrying a semantic key `SEMANTIC_MAP` never named, still gets exported
 * exactly as it holds it.
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
export function toThemeBlock(tokenSet: TokenSet, options: GlobalsCssOptions = {}): string {
	const prefix = options.prefix ?? 'cmb';
	const { light } = tokenSet.schemes;

	const entries: ThemeEntry[] = [
		...colorEntries(light.semantic, light.primitives, prefix),
		...radiusEntries(tokenSet, prefix),
		...typographyEntries(tokenSet, prefix),
		...trackingEntries(tokenSet, prefix),
		...shadowEntries(light.shadow, prefix),
	];

	const body = entries.map(({ name, reference }) => `\t--${name}: var(--${reference});\n`).join('');

	return `@theme inline {\n${body}}\n`;
}

/**
 * The semantic colours, bare on both sides, plus every ramp step and the brand alias, prefixed on
 * the reference side.
 *
 * A raw property named `--background` sits outside every Tailwind namespace, so `--color-background`
 * and `--background` are two different names and the semantic reference is safe left bare. A ramp
 * step's raw property does not get that for free: left bare it would be `--color-brand-500` itself,
 * already inside Tailwind's own colour namespace, so the theme entry of the same name would read
 * itself and resolve to nothing. Prefixing the reference is what keeps the two apart, the same
 * distinction `toGlobalsCss`'s `prefixedProperty` enforces on the declaring side.
 */
function colorEntries(
	semantic: Record<string, unknown>,
	primitives: Record<string, Ramp>,
	prefix: string,
): ThemeEntry[] {
	const semanticEntries = Object.keys(semantic).map((token) => ({
		name: `color-${token}`,
		reference: token,
	}));

	const rampEntries = Object.entries(primitives).flatMap(([rampName, ramp]) =>
		ramp.map((step) => {
			const name = `color-${rampName}-${stepNumberName(step.step)}`;
			return { name, reference: prefixed(name, prefix) };
		}),
	);

	const brand = declaredRamp(primitives, BRAND_RAMP)?.find((step) => step.step === BRAND_STEP);
	const brandEntry = brand
		? [{ name: `color-${BRAND_RAMP}`, reference: prefixed(`color-${BRAND_RAMP}`, prefix) }]
		: [];

	return [...semanticEntries, ...rampEntries, ...brandEntry];
}

function radiusEntries(tokenSet: TokenSet, prefix: string): ThemeEntry[] {
	return Object.keys(tokenSet.radius.values).map((name) => {
		const entryName = `radius-${name}`;
		return { name: entryName, reference: prefixed(entryName, prefix) };
	});
}

/**
 * Typography fans out across three Tailwind roots because Tailwind has no `typography` root of its
 * own. `toGlobalsCss`'s `scalarDeclarations` makes the same split for the same reason.
 */
function typographyEntries(tokenSet: TokenSet, prefix: string): ThemeEntry[] {
	const { size, weight, lineHeight } = tokenSet.typography.values;

	return [
		...Object.keys(size).map((name) => {
			const entryName = `text-${name}`;
			return { name: entryName, reference: prefixed(entryName, prefix) };
		}),
		...Object.keys(weight).map((name) => {
			const entryName = `font-weight-${name}`;
			return { name: entryName, reference: prefixed(entryName, prefix) };
		}),
		...Object.keys(lineHeight).map((name) => {
			const entryName = `leading-${name}`;
			return { name: entryName, reference: prefixed(entryName, prefix) };
		}),
	];
}

function trackingEntries(tokenSet: TokenSet, prefix: string): ThemeEntry[] {
	return Object.keys(tokenSet.tracking.values).map((name) => {
		const entryName = `tracking-${name}`;
		return { name: entryName, reference: prefixed(entryName, prefix) };
	});
}

function shadowEntries(shadow: { values: Record<string, unknown> }, prefix: string): ThemeEntry[] {
	return Object.keys(shadow.values).map((step) => {
		const entryName = `shadow-${step}`;
		return { name: entryName, reference: prefixed(entryName, prefix) };
	});
}

/** Prefixes a Tailwind entry name into the raw property `toGlobalsCss` declares for it. */
function prefixed(name: string, prefix: string): string {
	return prefix === '' ? name : `${prefix}-${name}`;
}
