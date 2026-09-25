import { SEMANTIC_MAP, type SemanticToken } from '../semantic-map';

/** WCAG 2.2 SC 1.4.3: normal text needs 4.5:1 against its surface. */
const TEXT_TARGET = 4.5;

/** WCAG 2.2 SC 1.4.11: non-text visual information identifying a component's state needs 3:1. */
const NON_TEXT_TARGET = 3;

const FOREGROUND_SUFFIX = '-foreground';

/** One declared pair: a foreground token, the surface it sits on, and the ratio it owes that surface. */
export type DeclaredPair = {
	foreground: SemanticToken;
	background: SemanticToken;
	target: number;
};

/**
 * Three tokens `SEMANTIC_MAP` renders as foreground without spelling `-foreground` in their name,
 * so the suffix walk below cannot find them. Each is named in `semantic-map.ts`'s own comments
 * rather than invented here:
 *
 * - `destructive` has no `--destructive-foreground` in the vendored shadcn contract, so
 *   `components/ui/button.tsx` paints it as body text over the page itself (`semantic-map.ts:107-121,
 *   155-157`). It owes the page the same 4.5:1 every other foreground owes its surface.
 * - `ring` and `sidebar-ring` are a focus ring's visual information rather than a surface/foreground
 *   pair, so SC 1.4.11's 3:1 applies instead of SC 1.4.3's 4.5:1 (`semantic-map.ts:53-65`).
 *
 * `border` and `input` sit below 3:1 on purpose (`semantic-map.ts:42-48`) and are deliberately absent
 * here rather than omitted by oversight.
 */
const NON_SUFFIX_PAIRS: readonly DeclaredPair[] = [
	{ foreground: 'destructive', background: 'background', target: TEXT_TARGET },
	{ foreground: 'ring', background: 'background', target: NON_TEXT_TARGET },
	{ foreground: 'sidebar-ring', background: 'background', target: NON_TEXT_TARGET },
];

/**
 * `X-foreground` pairs with `X`, for every `X` that is itself a declared token: `card-foreground`
 * strips to `card`, `sidebar-accent-foreground` to `sidebar-accent`. The bare `foreground` key is
 * the one name the suffix can't strip anything from — `''` names no token — and it is also the root
 * pair the rest of the naming scheme is built on, so it resolves to `background` directly rather
 * than through the strip.
 */
function backgroundFor(foreground: SemanticToken): SemanticToken | undefined {
	if (foreground === 'foreground') return 'background';
	if (!foreground.endsWith(FOREGROUND_SUFFIX)) return undefined;

	return foreground.slice(0, -FOREGROUND_SUFFIX.length) as SemanticToken;
}

/**
 * Every `SEMANTIC_MAP` key that names a foreground, paired with the surface its name promises,
 * walked off the map rather than typed out a second time. A token `SEMANTIC_MAP` adds later joins
 * this list the moment it is declared; `check.test.ts`'s coverage test is what proves that rather
 * than this comment.
 */
function suffixPairs(): DeclaredPair[] {
	const pairs: DeclaredPair[] = [];

	for (const key of Object.keys(SEMANTIC_MAP) as SemanticToken[]) {
		const background = backgroundFor(key);

		if (!background) continue;

		if (!(background in SEMANTIC_MAP)) {
			throw new Error(`"${key}" names no matching "${background}" in SEMANTIC_MAP`);
		}

		pairs.push({ foreground: key, background, target: TEXT_TARGET });
	}

	return pairs;
}

/** Every pair `checkContrast` gates, derived from `SEMANTIC_MAP` rather than hand-listed. */
export const CONTRAST_PAIRS: readonly DeclaredPair[] = [...suffixPairs(), ...NON_SUFFIX_PAIRS];
