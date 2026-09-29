import { toOklchCss } from '../../../core/css/oklch-css';
import { resolveScheme } from '../../../core/resolve-scheme';
import type { TokenSet } from '../../../core/token-set';

/**
 * Surface to ink, with the brand's own colour in the middle where the eye lands. Semantic tokens
 * rather than ramp steps, because a person recognises a brand by what its colours are used for.
 * Seven is what fits in a library row at phone width.
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

/** The light scheme, since that's the one the workspace and every export open on. */
export function paletteSwatches(tokenSet: TokenSet): PaletteSwatch[] {
	const resolved = resolveScheme(tokenSet.schemes.light);

	return PALETTE_TOKENS.map((token) => {
		const color = resolved[token];

		// `SEMANTIC_MAP` declares all seven, so only a hand-built set reaches this.
		if (!color) throw new Error(`the token set has no semantic "${token}"`);

		return { token, css: toOklchCss(color) };
	});
}
