/**
 * chroma-js 3.2.0 ships no TypeScript declarations for any entry point, and no `@types/chroma-js`
 * is installed. Declaring only `contrastAPCA`, the one export `check.ts` imports, keeps this from
 * becoming a second, unmaintained copy of a library's full surface: widen it when a call site here
 * needs more of chroma-js, not in anticipation of one.
 *
 * Two hex strings in, one signed Lc figure out. chroma-js's `Color` constructor also accepts an
 * `Oklch`-shaped object, but `check.ts` hands it the same rendered 8-bit sRGB hex `renderedContrast`
 * gates on, so both figures describe the one pair a screen actually paints.
 */
declare module 'chroma-js' {
	export function contrastAPCA(text: string, background: string): number;
}
