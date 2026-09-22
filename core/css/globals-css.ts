import type { Oklch } from '../oklch';
import { resolveScheme } from '../resolve-scheme';
import type { TokenSet } from '../token-set';
import { toOklchCss } from './oklch-css';

/**
 * Dark is a class rather than a `prefers-color-scheme` query. `app/globals.css` declares
 * `@custom-variant dark (&:is(.dark *))`, so every `dark:` utility Tailwind generates resolves
 * against that class, and a media query would paint a page the reader had switched to light.
 */
const LIGHT_SELECTOR = ':root';
const DARK_SELECTOR = '.dark';

/**
 * Writes a token set's two colour schemes out as the custom-property blocks a shadcn project drops
 * into its `globals.css`.
 *
 * Every declaration carries a value, because CSS has nowhere to put an alias. `ramp.step` is how
 * the semantic layer is authored and how it stays honest when a ramp moves, so `resolveScheme`
 * flattens each token to the three OKLCH channels it names and `toOklchCss` prints them.
 * Flattening there rather than here keeps a dangling alias a thrown error instead of a declaration
 * the browser drops.
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
export function toGlobalsCss(tokenSet: TokenSet): string {
	const light = resolveScheme(tokenSet.schemes.light);
	const dark = resolveScheme(tokenSet.schemes.dark);

	requireMirroredTokens(light, dark);

	// Both blocks run in the light scheme's order, so a reader comparing them is looking at values
	// instead of at a reordering. The two token sets are equal by the check above, so taking the
	// order from one of them loses nothing.
	const tokens = Object.keys(light);

	return `${rule(LIGHT_SELECTOR, tokens, light)}\n${rule(DARK_SELECTOR, tokens, dark)}`;
}

function rule(selector: string, tokens: readonly string[], colors: Record<string, Oklch>): string {
	const declarations = tokens
		.map((token) => `\t--${token}: ${toOklchCss(colors[token]!)};\n`)
		.join('');

	return `${selector} {\n${declarations}}\n`;
}

/**
 * Refuses a set whose two schemes name different semantic tokens instead of emitting the union.
 *
 * A property declared under `:root` and missing under `.dark` falls back to the light scheme's
 * value rather than to nothing, so a dark page paints that token in a colour meant for a white
 * background and renders with no error anywhere. Both directions are checked, because a token only
 * the dark scheme declares is the same failure with the schemes swapped.
 *
 * Nothing upstream catches it. `checkMirroredLayers` compares the unprefixed layers against
 * `schemes.light` and never puts the two schemes beside each other, and `SemanticLayerSchema`
 * accepts any non-empty record. So the guarantee has to be made where the two schemes first meet.
 */
function requireMirroredTokens(light: Record<string, Oklch>, dark: Record<string, Oklch>): void {
	const missingFromDark = absentFrom(dark, light);
	const missingFromLight = absentFrom(light, dark);

	if (missingFromDark.length === 0 && missingFromLight.length === 0) return;

	const complaints = [
		missingFromDark.length > 0 && `the dark scheme declares no ${missingFromDark.join(', ')}`,
		missingFromLight.length > 0 && `the light scheme declares no ${missingFromLight.join(', ')}`,
	].filter(Boolean);

	throw new Error(`the two schemes must name the same semantic tokens: ${complaints.join('; ')}`);
}

/**
 * `Object.hasOwn` rather than a bare index, for the reason `declaredRamp` (`core/token-set.ts`)
 * gives: a resolved scheme is a plain object, so `constructor` and `toString` answer truthy on it
 * and a missing token would look present.
 */
function absentFrom(from: Record<string, Oklch>, present: Record<string, Oklch>): string[] {
	return Object.keys(present).filter((token) => !Object.hasOwn(from, token));
}
