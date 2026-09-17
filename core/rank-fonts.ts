import type {
	BrandSeed,
	ExpressiveAxis,
	FontCandidate,
	SuggestedPairing,
	TypeClassification,
} from './brand-seed';
import { canonicalFamily, collapseVariants } from './family-variants';
import {
	CATEGORY_TAGS,
	type FontTable,
	resolveCandidatePool,
	type TagName,
	TONE_TAGS,
} from './font-table';

/**
 * Which axis of the table orders a role's pool.
 *
 * - `personality` ranks on the seed's own expressive characteristics, so two brands sharing a tone
 *   get different answers. Tone alone cannot separate them: 52 of the 126 families tagged
 *   `/Sans/Neo Grotesque` score exactly 100, so every brand that shares a tone gets the same
 *   alphabetical slice of one 52-way tie.
 * - `craft` ranks on `/Quality/Spacing` and `/Quality/Wordspace`, which upstream populates for every
 *   family where the expressive axes are sparse.
 * - `model-led` seats the model's own named face first and fills the rest from `personality`.
 */
export type RankingMode = 'personality' | 'craft' | 'model-led';

type Role = keyof SuggestedPairing;

/**
 * A result rather than a nullable pairing, mirroring `ParseSeedResult`. A seed with no
 * `typeClassification` has neither a category nor a tone to filter on, so there is nothing to rank.
 * A `null` pairing would blur that into the other way a role comes back empty, which is a table
 * that matched nothing, and the two want different recoveries.
 */
export type RankFontsResult =
	| { ok: true; pairing: SuggestedPairing; error?: never }
	| { ok: false; pairing?: never; error: { kind: 'no-type-classification' } };

/** Three slots per role, the count #42 asks each mode to produce. */
const MAX_PER_ROLE = 3;

const THEME_PREFIX = '/Theme/';

const SPACING_TAG = '/Quality/Spacing';
const WORDSPACE_TAG = '/Quality/Wordspace';

/**
 * Display is the brand's expressive face, so personality ranks it. Body is read at small sizes,
 * where spacing quality decides legibility long before character does. Mono barely ranks at all.
 */
const DEFAULT_MODE = {
	display: 'personality',
	body: 'craft',
	mono: 'craft',
} as const satisfies Record<Role, RankingMode>;

type FamilyTags = Map<string, number>;

function indexByFamily(table: FontTable): Map<string, FamilyTags> {
	const index = new Map<string, FamilyTags>();

	for (const row of table) {
		const tags = index.get(row.family) ?? new Map<string, number>();
		tags.set(row.tag, row.score);
		index.set(row.family, tags);
	}

	return index;
}

/**
 * `core/font-table.ts` derives its own `/Expressive/` tag names from `ExpressiveAxisSchema` and
 * warns against a second spelling of them. This is the only place that builds one here.
 */
function expressiveTag(axis: ExpressiveAxis): TagName {
	return `/Expressive/${axis}`;
}

/** A missing row scores zero, per `Score`: the table omits anything it would rate below 40. */
function scoreOn(tags: FamilyTags | undefined, tag: string): number {
	return tags?.get(tag) ?? 0;
}

/**
 * A family's tags, read at its exact spelling first and at its canonical base second.
 *
 * Both readings have to agree about which family this is. Reading tags at the exact spelling while
 * deduping at the canonical one lets a themed face through: name `Crack Sans Thai`, and the table
 * carries no row under that spelling, so nothing can call it Distressed and it sets body copy.
 * Exact first, because a family the table carries describes itself better than its base does, then
 * the base for a variant the table only knows by its root.
 */
function tagsFor(family: string, index: Map<string, FamilyTags>): FamilyTags | undefined {
	return index.get(family) ?? index.get(canonicalFamily(family));
}

function isThemed(tags: FamilyTags | undefined): boolean {
	return [...(tags?.keys() ?? [])].some((tag) => tag.startsWith(THEME_PREFIX));
}

function craftScore(tags: FamilyTags | undefined): number {
	return (scoreOn(tags, SPACING_TAG) + scoreOn(tags, WORDSPACE_TAG)) / 2;
}

/**
 * The seed's own score on an axis is that axis's weight, so a brand reading 90 calm and 30
 * competent is ranked mostly on calm. Dividing by the seed's total rather than by the axis count is
 * what keeps an axis the seed never mentioned from voting zero.
 *
 * `top` names the axis that contributed most, weighted the same way, for the rationale to quote.
 * It shares this loop because the two have to agree: an axis picked on its raw tag score could name
 * one the ranking barely leaned on, which would be a true sentence about the wrong reason.
 */
function expressiveReading(
	tags: FamilyTags | undefined,
	expressive: BrandSeed['expressive'],
): { score: number; top: { axis: ExpressiveAxis; score: number } | undefined } {
	let weighted = 0;
	let weight = 0;
	let top: { axis: ExpressiveAxis; score: number } | undefined;
	let topContribution = 0;

	for (const axis of expressive ?? []) {
		const score = scoreOn(tags, expressiveTag(axis.axis));
		const contribution = axis.score * score;

		weighted += contribution;
		weight += axis.score;

		if (contribution > topContribution) {
			topContribution = contribution;
			top = { axis: axis.axis, score };
		}
	}

	return { score: weight === 0 ? 0 : weighted / weight, top };
}

/**
 * The tag that put a family in the pool, for the rationale to name.
 *
 * Reads the same two constants `resolveCandidatePool` matched on. Searching wider would let the
 * rationale credit a tag that had nothing to do with the family being in this pool: a family
 * carrying both a slab row and a sans row, ranked into a sans pool, would come back explained by
 * its higher-scoring slab row.
 */
function placementTag(
	tags: FamilyTags | undefined,
	category: TypeClassification['category'],
	tone: TypeClassification['tone'],
	matched: 'tone' | 'category',
): { tag: TagName; score: number } {
	const poolTags: readonly TagName[] =
		matched === 'tone' ? TONE_TAGS[category][tone] : CATEGORY_TAGS[category];

	let best = { tag: poolTags[0]!, score: -1 };

	for (const tag of poolTags) {
		const score = scoreOn(tags, tag);

		if (score > best.score) {
			best = { tag, score };
		}
	}

	return best;
}

/**
 * Why a role's list came out in this order, which is the thing its rationale has to explain.
 *
 * Three of the four end in the quality axes and they are not the same statement. `craft` is what the
 * caller asked for. `craft-no-coverage` is a pool that was measured against the seed's axes and
 * scored zero on all of them. `craft-no-signal` is a seed with no axis worth measuring against.
 *
 * The last two have to be separated here rather than downstream, because a score cannot tell them
 * apart: both leave every family on zero. Saying the pool carries nothing when the seed asked for
 * nothing is a claim about the wrong half of the comparison.
 *
 * A seed that classifies its type and weights no axes is an ordinary input rather than an exotic
 * one. `expressive` is a required-but-nullable key so a partial seed records the gap instead of
 * hiding it, per the field-shape note on `BrandSeedSchema`, and any model that fills the type
 * classification while leaving the axes null lands here. It is not the wholly unclassified seed,
 * which `rankFonts` refuses outright before a basis is ever chosen.
 */
type RankingBasis = 'personality' | 'craft' | 'craft-no-coverage' | 'craft-no-signal';

function chooseBasis(
	mode: RankingMode,
	pool: readonly string[],
	index: Map<string, FamilyTags>,
	expressive: BrandSeed['expressive'],
): RankingBasis {
	if (mode === 'craft') {
		return 'craft';
	}

	// Total weight rather than a count of entries, and read off the seed rather than off any score.
	// `ExpressiveScoreSchema` allows a score of 0, so `[{ axis: 'Calm', score: 0 }]` names an axis
	// and still weights nothing. `expressiveReading` divides by that total, so it returns zero for
	// every family exactly as an empty list does. Counting entries would send that seed to
	// `craft-no-coverage` to be told the pool carries nothing, which can be flatly false: the pool
	// may be full of `/Expressive/Calm`.
	const weight = (expressive ?? []).reduce((total, axis) => total + axis.score, 0);

	if (weight === 0) {
		return 'craft-no-signal';
	}

	// A pool with no expressive coverage ties at zero under personality, and a total tie is the
	// table's own order rather than a ranking. Upstream populates the quality axes for every family,
	// so falling back to craft keeps the role answering with ordered faces.
	const noCoverage = pool.every(
		(family) => expressiveReading(index.get(family), expressive).score === 0,
	);

	return noCoverage ? 'craft-no-coverage' : 'personality';
}

function rationaleFor(
	tags: FamilyTags | undefined,
	expressive: BrandSeed['expressive'],
	category: TypeClassification['category'],
	tone: TypeClassification['tone'],
	matched: 'tone' | 'category',
	basis: RankingBasis,
): string {
	const placement = placementTag(tags, category, tone, matched);

	// Two different things reach the category pool, and saying both the same way misreports one of
	// them. Six of the twelve pairs a seed can express have no tag in the taxonomy at all, monospace
	// being all three of its own, so their rationale must not claim a match was attempted and failed.
	// The other route is a tone that does have tags and found no family carrying them in this table.
	const toneIsTagged = TONE_TAGS[category][tone].length > 0;
	const placed =
		matched === 'tone'
			? `Scores ${placement.score} on ${placement.tag}, which is the tone classified above.`
			: toneIsTagged
				? `Scores ${placement.score} on ${placement.tag}; no family here carries the ${tone} tags, so the whole ${category} category answered.`
				: `Scores ${placement.score} on ${placement.tag}; the taxonomy has no ${tone} ${category}, so the whole category answered.`;

	if (basis === 'personality') {
		const { top } = expressiveReading(tags, expressive);

		// Reaching here means the seed weighted at least one axis above zero, because `chooseBasis`
		// routes every other seed to `craft-no-signal` before a score is read. So a missing `top` is
		// this family carrying no tag on axes the seed really did ask for, which is what this says.
		return top
			? `${placed} Ranked on the seed's expressive characteristics, strongest at ${top.score} on ${expressiveTag(top.axis)}.`
			: `${placed} Ranked on the seed's expressive characteristics, which this family carries no tag for.`;
	}

	const axes = `${scoreOn(tags, SPACING_TAG)} on ${SPACING_TAG} and ${scoreOn(tags, WORDSPACE_TAG)} on ${WORDSPACE_TAG}`;

	// Switched rather than chained, so adding a basis is a type error here instead of a sentence that
	// quietly inherits the wrong explanation. That is the failure this whole union exists to stop.
	switch (basis) {
		case 'craft':
			return `${placed} Ranked on the quality axes: ${axes}.`;
		case 'craft-no-coverage':
			return `${placed} Nothing in this pool carries the expressive axes the seed asked for, so the quality axes ranked it: ${axes}.`;
		case 'craft-no-signal':
			return `${placed} The seed gives no expressive characteristic any weight, so the quality axes ranked it: ${axes}.`;
		default: {
			const unhandled: never = basis;

			throw new Error(`unhandled ranking basis: ${String(unhandled)}`);
		}
	}
}

/** Clamps as well as rounds, because a fetched table can carry a score outside the band the schema accepts. */
function toPercent(value: number): number {
	return Math.min(100, Math.max(0, Math.round(value)));
}

interface RoleRequest {
	table: FontTable;
	index: Map<string, FamilyTags>;
	seed: BrandSeed;
	category: TypeClassification['category'];
	tone: TypeClassification['tone'];
	mode: RankingMode;
	excludeThemed: boolean;
	named: FontCandidate | undefined;
}

/**
 * Known limitation, deliberately left. Some faces that reach a pool are nobody's brand typeface:
 * `Noto Sans Math`, `Noto Sans Mayan Numerals`, `Noto Znamenny Musical Notation`. They carry a
 * structural tag like any text face, `NOTO_NON_SCRIPT_CUTS` in `core/family-variants.ts` stops them
 * folding onto a base, and so they can hold a slot of their own.
 *
 * The table does not answer this. Its `/Special use/*` namespace looks like the filter and is not:
 * 25 families carry one, only `Noto Sans Symbols` and `Datatype` also carry a structural tag and so
 * reach a pool at all, `Datatype` is a real neo-grotesque mono no filter should drop, and the tag
 * never touches `Math`, `Mayan Numerals` or `Znamenny`.
 *
 * Excluding non-text faces would therefore mean inventing a judgement the table does not record,
 * and #42 asks for no such filter: its criteria condition candidacy on tags and provenance, never
 * on a face being text. Written down rather than implied, as #42 asks for this layer's known
 * failures. A filter, if one is ever wanted, belongs here beside the themed exclusion.
 */
function rankRole(request: RoleRequest): FontCandidate[] {
	const { table, index, seed, category, tone, mode, excludeThemed, named } = request;
	const { families, matched } = resolveCandidatePool(table, category, tone);

	const pool = excludeThemed
		? families.filter((family) => !isThemed(index.get(family)))
		: [...families];

	const basis = chooseBasis(mode, pool, index, seed.expressive);

	const scored = pool.map((family) => {
		const tags = index.get(family);

		return {
			family,
			tags,
			value:
				basis === 'personality' ? expressiveReading(tags, seed.expressive).score : craftScore(tags),
		};
	});

	// Stable since ES2019, which is what ties rest on: equal scores keep the pool's order, and the
	// pool's order is the table's. The same seed over the same table has to produce the same tokens
	// on every machine that runs it, so nothing here may consult the clock, a random source, or a
	// locale-sensitive comparison.
	// `map` already returned a fresh array, so this sort mutates nothing anyone else can see.
	// oxlint-disable-next-line unicorn/no-array-sort
	const sorted = scored.sort((a, b) => b.value - a.value);

	// Collapsing before the sort would pick a family's representative by table position rather than
	// by rank, and slicing before it would let `IBM Plex Sans` and `IBM Plex Sans Thai` spend two of
	// the three slots saying the same thing.
	//
	// The tags go in because the second collapsing rule cannot work without them: `Cascadia Code`
	// beside `Cascadia Mono` and `Roboto` beside `Roboto Mono` look alike as names and want opposite
	// answers.
	const collapsed = collapseVariants(
		sorted,
		(entry) => entry.family,
		(entry) => entry.tags?.keys(),
	);

	const derived: FontCandidate[] = collapsed.map((entry) => ({
		provenance: 'derived',
		family: entry.family,
		score: toPercent(entry.value),
		rationale: rationaleFor(entry.tags, seed.expressive, category, tone, matched, basis),
	}));

	return named === undefined
		? derived.slice(0, MAX_PER_ROLE)
		: seatNamedCandidate(derived, named, index, excludeThemed);
}

/**
 * Puts the face the model named at the head of a role's list, under `model-led`.
 */
function seatNamedCandidate(
	derived: readonly FontCandidate[],
	named: FontCandidate,
	index: Map<string, FamilyTags>,
	excludeThemed: boolean,
): FontCandidate[] {
	const namedTags = tagsFor(named.family, index);

	// The theme filter is a hard constraint, not a preference, so it does not care who named the
	// face. A Blackletter or Stencil cut cannot set a paragraph at all, which is a different kind of
	// statement from one face ranking above another, and `model-led` seats a face rather than
	// ranking it. On the roles that drop themed families, a named one goes the same way.
	//
	// A family neither spelling finds has no tags to read, so `isThemed` says false and it stays.
	// That is the ordinary case for a face the model invented rather than picked off the table.
	if (excludeThemed && isThemed(namedTags)) {
		return derived.slice(0, MAX_PER_ROLE);
	}

	// The seed's own entry may arrive marked `derived` with a score, because the model writes that
	// field itself. Nothing derived it from a table, so it is re-stamped here rather than trusted:
	// #42 wants a mixed list to stay honest about which entries a ranking placed. This is the one
	// candidate that names no tag and carries no score, which is #42's `invented` contract winning
	// over its "family name, a score, and a rationale" line—no table placed this face.
	const invented: FontCandidate = {
		provenance: 'invented',
		family: named.family,
		score: null,
		rationale: 'Named by the model rather than ranked from the table, so it carries no score.',
	};

	// Seated at the head and then collapsed, rather than filtered by canonical name: the model's
	// pick and a script variant of it are one answer, and so are its pick and another cut of the
	// same drawing. Running the same function the ranking runs is what keeps the two lists agreeing
	// about what counts as one family.
	return collapseVariants(
		[invented, ...derived],
		(candidate) => candidate.family,
		(candidate) => tagsFor(candidate.family, index)?.keys(),
	).slice(0, MAX_PER_ROLE);
}

/**
 * Ranks up to three font candidates for each of the three roles, from a font table and a seed.
 *
 * Pure, per ADR-0001. The table arrives as an argument because one client may have fetched the full
 * taxonomy while another fell back to the in-repo table, and the record has to name which one
 * answered.
 */
export function rankFonts(
	table: FontTable,
	seed: BrandSeed,
	options: { mode?: RankingMode } = {},
): RankFontsResult {
	const classification = seed.typeClassification;

	if (classification === null) {
		return { ok: false, error: { kind: 'no-type-classification' } };
	}

	const { category, tone, displayDiffersFromBody } = classification;
	const index = indexByFamily(table);
	// `xHeight` and `trackingFeel` are the seed's other type fields and neither ranks anything here.
	// The taxonomy carries no metric for either, so #42 ranks on the tags that exist; sizing them is
	// the type-scale work, not this.
	//
	// One mode per call rather than one per role. #42 asks for a mode that is "selectable per call",
	// and a caller wanting to mix them can rank twice and take the roles it wants from each.
	const modeFor = (role: Role): RankingMode => options.mode ?? DEFAULT_MODE[role];

	// Only the first face the model named for a role. The rest of its list is the model's own
	// ranking of a pool it never saw, which is the guess #42 exists to replace.
	const namedFor = (role: Role): FontCandidate | undefined =>
		modeFor(role) === 'model-led' ? seed.suggestedPairing?.[role][0] : undefined;

	const display = rankRole({
		table,
		index,
		seed,
		category,
		tone,
		mode: modeFor('display'),
		// One face doing both jobs still has to set body copy, so the shared list drops the themed
		// families body would have dropped. The ranking stays display's, and the asymmetry is the
		// point: the filter is a hard constraint, since a Blackletter face cannot set a paragraph at
		// all, while the mode is only a preference between faces that all can. Excluding what is
		// unusable and then ranking the rest on brand character is a different call from ranking
		// everything on spacing, and a brand that gets one face should still get a face with
		// character.
		excludeThemed: !displayDiffersFromBody,
		named: namedFor('display'),
	});

	const body = displayDiffersFromBody
		? rankRole({
				table,
				index,
				seed,
				category,
				tone,
				mode: modeFor('body'),
				// `/Theme/*` marks a face display-only, not body-only: a family tagged Blackletter,
				// Distressed, or Wacky is a legitimate headline and has no business under a paragraph
				// of running text. #42's Proposed Behavior, its acceptance criteria and the `VT323` row
				// in the curated table all say so.
				excludeThemed: true,
				named: namedFor('body'),
			})
		: [...display];

	const mono = rankRole({
		table,
		index,
		seed,
		// A brand classified serif still sets its code in a monospace face, so the seed's category
		// never reaches this pool.
		category: 'mono',
		tone,
		mode: modeFor('mono'),
		excludeThemed: false,
		named: namedFor('mono'),
	});

	return { ok: true, pairing: { display, body, mono } };
}
