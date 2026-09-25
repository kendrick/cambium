// chroma-js's package index pulls in the whole library, about 85 kB gzipped, and took the build's
// total JS past its 450 kB budget. The deep module is in chroma-js's own `exports` map. Its `Color`
// only parses hex and exposes `rgb()` and `alpha()` once these three side-effect modules register
// them, so without them every call throws "unknown format".
import 'chroma-js/src/io/hex/index.js';
import 'chroma-js/src/io/rgb/index.js';
import 'chroma-js/src/ops/alpha.js';
import contrastAPCA from 'chroma-js/src/utils/contrastAPCA.js';

import { renderedContrast, toSrgbHex } from '../oklch';
import { resolveScheme } from '../resolve-scheme';
import { SCHEME_NAMES, type SchemeName } from '../scale-engine';
import type { TokenSet } from '../token-set';
import { CONTRAST_PAIRS } from './pairs';

/**
 * One measured pair, one scheme. Plain data rather than a class or a function closure, so an
 * interface can render it and #8's repair task can consume it without either one recomputing a
 * contrast ratio.
 */
export type ContrastEntry = {
	scheme: SchemeName;
	foreground: string;
	background: string;
	target: number;
	wcag: number;
	apca: number;
	passes: boolean;
};

/**
 * Every declared pair, measured in both schemes.
 *
 * `wcag` gates `passes`; APCA never does. #8's decisions log why: chroma-js's APCA is advisory,
 * reported for a future interface to show alongside the number that actually blocks a token set.
 *
 * Gates on `renderedContrast`, the same 8-bit-sRGB-rounded figure `core/oklch.ts` uses everywhere
 * else, rather than continuous OKLCH contrast. A pair solved a hair over target in full precision
 * can still serialize under it once both colours round to a byte grid (#72), and that byte pair is
 * what a browser actually paints.
 */
export function checkContrast(tokenSet: TokenSet): ContrastEntry[] {
	const entries: ContrastEntry[] = [];

	for (const scheme of SCHEME_NAMES) {
		const resolved = resolveScheme(tokenSet.schemes[scheme]);

		for (const pair of CONTRAST_PAIRS) {
			const foreground = resolved[pair.foreground];
			const background = resolved[pair.background];

			if (!foreground || !background) {
				throw new Error(
					`pair "${pair.foreground}"/"${pair.background}" resolves to nothing in the ${scheme} scheme`,
				);
			}

			const wcag = renderedContrast(foreground, background);

			entries.push({
				scheme,
				foreground: pair.foreground,
				background: pair.background,
				target: pair.target,
				wcag,
				// chroma-js reads the same rounded bytes WCAG gates on, so the two figures describe
				// the one pair a screen actually paints rather than two different colours.
				apca: contrastAPCA(toSrgbHex(foreground), toSrgbHex(background)),
				passes: wcag >= pair.target,
			});
		}
	}

	return entries;
}
