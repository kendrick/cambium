/**
 * chroma-js 3.2.0 ships no TypeScript declarations, and no `@types/chroma-js` is installed. This
 * declares only the deep module `check.ts` imports, so it can't drift into a second, unmaintained
 * copy of the library's surface. Widen it when a call site needs more.
 *
 * Two hex strings in, one signed Lc figure out.
 */
declare module 'chroma-js/src/utils/contrastAPCA.js' {
	export default function contrastAPCA(text: string, background: string): number;
}
