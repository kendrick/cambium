import { toOklchCss } from '../../../core/css/oklch-css';
import { resolveScheme } from '../../../core/resolve-scheme';
import type { TokenSet } from '../../../core/token-set';

/**
 * Ordered surface to ink, with `primary` in the middle. Semantic tokens rather than ramp steps,
 * because a person recognises a brand by what its colours are used for. Seven leaves each swatch
 * 2rem wide at the strip's `max-w-56` cap.
 */
export const PALETTE_TOKENS = [
	'background',
	'muted',
	'border',
	'primary',
	'ring',
	'destructive',
	'foreground',
] as const;

export type PaletteSwatch = { token: (typeof PALETTE_TOKENS)[number]; css: string };

/**
 * Reads the light scheme, which the workspace opens on and the exported stylesheet puts on `:root`.
 */
export function paletteSwatches(tokenSet: TokenSet): PaletteSwatch[] {
	const resolved = resolveScheme(tokenSet.schemes.light);

	return PALETTE_TOKENS.map((token) => {
		const color = resolved[token];

		// `SEMANTIC_MAP` declares all seven, so only a hand-built set reaches this.
		if (!color) throw new Error(`the token set has no semantic "${token}"`);

		return { token, css: toOklchCss(color) };
	});
}
