import type { ExpressiveAxis, TypeClassification } from './brand-seed';

/**
 * A row in whichever font table resolved. Both land in this shape: the taxonomy fetched from
 * jsDelivr at runtime and the small table Cambium authors itself for when that fetch fails.
 * #42 ranks over one of them without knowing which, so nothing here can be a fact about only
 * one source.
 *
 * `tag` stays a bare string because the fetched table's parser reads whatever upstream carries,
 * including names added after this file was written.
 */
export interface FontTableRow {
	family: string;
	tag: string;
	score: number;
}

export type FontTable = readonly FontTableRow[];

/**
 * `ExpressiveAxisSchema` is the source of these twenty names. #53 closed that enum at the seed's
 * trust boundary, and a second spelling of the names here would let a row tag a family with an axis
 * no seed can ever ask for.
 */
type ExpressiveTag = `/Expressive/${ExpressiveAxis}`;

/**
 * Cambium's subset of the tag vocabulary, not a mirror of Google's taxonomy. The file this
 * resembles is the one ADR-0001 forbids copying, and every name below is here because the Brand
 * Seed's `typeClassification` can reach it.
 *
 * Narrowing is safe because it constrains authoring alone. #42 excludes `/Theme/*` by prefix, so
 * a fetched table carrying the other ten upstream theme tags still behaves. What the union buys
 * is that `/Sans/Geometrik` fails typecheck for the agent who typed it, instead of failing the
 * coverage test hours later for someone else.
 */
export type TagName =
	| '/Sans/Geometric'
	| '/Sans/Glyphic'
	| '/Sans/Grotesque'
	| '/Sans/Humanist'
	| '/Sans/Neo Grotesque'
	| '/Sans/Rounded'
	| '/Sans/Superellipse'
	| '/Serif/Didone'
	| '/Serif/Fat Face'
	| '/Serif/Humanist Venetian'
	| '/Serif/Modern'
	| '/Serif/Old Style Garalde'
	| '/Serif/Scotch'
	| '/Serif/Transitional'
	| '/Slab/Clarendon'
	| '/Slab/Geometric'
	| '/Slab/Humanist'
	| '/Monospace/Monospace'
	| '/Quality/Spacing'
	| '/Quality/Wordspace'
	| '/Theme/Blackletter'
	| '/Theme/Distressed'
	| '/Theme/Wacky'
	| '/Theme/Pixel'
	| '/Theme/Stencil'
	| ExpressiveTag;

/**
 * How strongly a family reads as one tag, on multiples of ten:
 *
 * - 100: a canonical exemplar. Someone teaching the tag would reach for this face.
 * - 80: strongly this, with something else also going on.
 * - 60: present and legible in the design, not the first thing you would say about it.
 * - 40: a weak reading. Defensible, arguable.
 *
 * The values between those rungs are for a face that sits between two of them. Anything below 40
 * is a missing row rather than a low score.
 *
 * Tens rather than every integer, because no test can prove a row was not copied from upstream:
 * the file is not here, and fetching it inside a test would break the offline rule. A ten-point
 * grid is coarse enough that matching an upstream score is coincidence rather than recall, and
 * still fine enough to separate a pool of fifteen families under #42's ranking.
 */
export type Score = 40 | 50 | 60 | 70 | 80 | 90 | 100;

/**
 * One row as the four category modules write it. Assigns straight into `FontTableRow`, so
 * assembling the authored table costs no conversion.
 *
 * The narrow field types are the whole point. Four agents author rows in parallel against one
 * closed vocabulary, and a misspelled tag or an off-grid score has to stop the build rather than
 * survive as a row nothing ever matches.
 */
export interface AuthoredRow {
	family: string;
	tag: TagName;
	score: Score;
}

/** Every tag under a category's namespace, and the pool a tone falls back to. */
export const CATEGORY_TAGS = {
	sans: [
		'/Sans/Geometric',
		'/Sans/Glyphic',
		'/Sans/Grotesque',
		'/Sans/Humanist',
		'/Sans/Neo Grotesque',
		'/Sans/Rounded',
		'/Sans/Superellipse',
	],
	serif: [
		'/Serif/Didone',
		'/Serif/Fat Face',
		'/Serif/Humanist Venetian',
		'/Serif/Modern',
		'/Serif/Old Style Garalde',
		'/Serif/Scotch',
		'/Serif/Transitional',
	],
	slab: ['/Slab/Clarendon', '/Slab/Geometric', '/Slab/Humanist'],
	mono: ['/Monospace/Monospace'],
} as const satisfies Record<TypeClassification['category'], readonly TagName[]>;

/**
 * The tags that read as a given tone inside a category.
 *
 * Six of the twelve pairs a `TypeClassification` can express are empty here, and deliberately so:
 * the taxonomy has no geometric or grotesque serif, no grotesque slab, and no tones at all under
 * monospace. A seed can still name any of the twelve, because tone and category are independent
 * enums in `TypeClassificationSchema`. `CATEGORY_TAGS` is what answers those six.
 */
export const TONE_TAGS = {
	sans: {
		geometric: ['/Sans/Geometric', '/Sans/Superellipse'],
		humanist: ['/Sans/Humanist', '/Sans/Rounded'],
		grotesque: ['/Sans/Grotesque', '/Sans/Neo Grotesque'],
	},
	serif: {
		geometric: [],
		humanist: ['/Serif/Humanist Venetian', '/Serif/Old Style Garalde'],
		grotesque: [],
	},
	slab: {
		geometric: ['/Slab/Geometric'],
		humanist: ['/Slab/Humanist'],
		grotesque: [],
	},
	mono: {
		geometric: [],
		humanist: [],
		grotesque: [],
	},
} as const satisfies Record<
	TypeClassification['category'],
	Record<TypeClassification['tone'], readonly TagName[]>
>;

function familiesTagged(table: FontTable, tags: readonly TagName[]): string[] {
	const wanted = new Set<string>(tags);
	const families = new Set<string>();

	for (const row of table) {
		if (wanted.has(row.tag)) {
			families.add(row.family);
		}
	}

	// A Set keeps first-seen order, so the pool comes back in the table's own order and this
	// function imposes none of its own. Identical seeds have to produce identical tokens, and that
	// needs the order to be stable across runs rather than sorted into any particular shape.
	return [...families];
}

/**
 * The families worth ranking for a seed's `typeClassification`. Matches the tone first and falls
 * back to the whole category when the tone matches nothing.
 *
 * `matched` is what lets #42's rationale say the tone found nothing and the category answered
 * instead. That is a different statement from a face merely ranking low, and the rationale would be
 * wrong to present one as the other.
 *
 * Returns what the table holds instead of padding to three. Three families per pair is the
 * fallback table's obligation, asserted in its own test; over an arbitrary table, the fetched one
 * included, no function here can promise it.
 */
export function resolveCandidatePool(
	table: FontTable,
	category: TypeClassification['category'],
	tone: TypeClassification['tone'],
): { families: readonly string[]; matched: 'tone' | 'category' } {
	const byTone = familiesTagged(table, TONE_TAGS[category][tone]);

	if (byTone.length > 0) {
		return { families: byTone, matched: 'tone' };
	}

	return { families: familiesTagged(table, CATEGORY_TAGS[category]), matched: 'category' };
}
