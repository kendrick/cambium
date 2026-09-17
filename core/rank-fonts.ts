import type { BrandSeed, FontCandidate, SuggestedPairing, TypeClassification } from './brand-seed';
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

/** A missing row scores zero, per `Score`: the table omits anything it would rate below 40. */
function scoreOn(tags: FamilyTags | undefined, tag: string): number {
	return tags?.get(tag) ?? 0;
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
 */
function personalityScore(
	tags: FamilyTags | undefined,
	expressive: BrandSeed['expressive'],
): number {
	let weighted = 0;
	let weight = 0;

	for (const axis of expressive ?? []) {
		weighted += axis.score * scoreOn(tags, `/Expressive/${axis.axis}`);
		weight += axis.score;
	}

	return weight === 0 ? 0 : weighted / weight;
}

function topExpressiveAxis(
	tags: FamilyTags | undefined,
	expressive: BrandSeed['expressive'],
): { axis: string; score: number } | undefined {
	let best: { axis: string; score: number } | undefined;
	let bestContribution = 0;

	// Weighted contribution rather than raw tag score: an axis the seed barely asked for is not the
	// reason a family ranked, however high the family scores on it.
	for (const axis of expressive ?? []) {
		const score = scoreOn(tags, `/Expressive/${axis.axis}`);
		const contribution = axis.score * score;

		if (contribution > bestContribution) {
			bestContribution = contribution;
			best = { axis: axis.axis, score };
		}
	}

	return best;
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

function rationaleFor(
	tags: FamilyTags | undefined,
	seed: BrandSeed,
	category: TypeClassification['category'],
	tone: TypeClassification['tone'],
	matched: 'tone' | 'category',
	rankedOn: 'personality' | 'craft',
	fellBack: boolean,
): string {
	const placement = placementTag(tags, category, tone, matched);
	const placed =
		matched === 'tone'
			? `Scores ${placement.score} on ${placement.tag}, which is the tone classified above.`
			: `Scores ${placement.score} on ${placement.tag}; the tone matched nothing, so the whole ${category} category answered.`;

	if (rankedOn === 'craft') {
		const axes = `${scoreOn(tags, SPACING_TAG)} on ${SPACING_TAG} and ${scoreOn(tags, WORDSPACE_TAG)} on ${WORDSPACE_TAG}`;

		return fellBack
			? `${placed} Nothing in this pool carries the expressive axes the seed asked for, so the quality axes ranked it: ${axes}.`
			: `${placed} Ranked on the quality axes: ${axes}.`;
	}

	const top = topExpressiveAxis(tags, seed.expressive);

	return top
		? `${placed} Ranked on the seed's expressive characteristics, strongest at ${top.score} on /Expressive/${top.axis}.`
		: `${placed} Ranked on the seed's expressive characteristics, which this family carries no tag for.`;
}

/** Rounds to an integer, and clamps a table whose scores run outside the band the schema accepts. */
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

function rankRole(request: RoleRequest): FontCandidate[] {
	const { table, index, seed, category, tone, mode, excludeThemed, named } = request;
	const { families, matched } = resolveCandidatePool(table, category, tone);

	const pool = excludeThemed
		? families.filter((family) => !isThemed(index.get(family)))
		: [...families];

	// A pool with no expressive coverage ties at zero under personality, and a total tie is the
	// table's own order rather than a ranking. Upstream populates the quality axes for every family,
	// so falling back to craft keeps the role answering with ordered faces.
	const wantsPersonality = mode !== 'craft';
	const fellBack =
		wantsPersonality &&
		pool.every((family) => personalityScore(index.get(family), seed.expressive) === 0);
	const rankedOn = wantsPersonality && !fellBack ? 'personality' : 'craft';

	const scored = pool.map((family) => {
		const tags = index.get(family);

		return {
			family,
			tags,
			value: rankedOn === 'craft' ? craftScore(tags) : personalityScore(tags, seed.expressive),
		};
	});

	// Stable since ES2019, which is what ties rest on: equal scores keep the pool's order, and the
	// pool's order is the table's. The same seed over the same table has to produce the same tokens
	// on every machine that runs it, so nothing here may consult the clock, a random source, or a
	// locale-sensitive comparison.
	// `map` already returned a fresh array, so this sort mutates nothing anyone else can see.
	// oxlint-disable-next-line unicorn/no-array-sort
	const sorted = scored.sort((a, b) => b.value - a.value);

	// After the sort and before the slice. Collapsing first would pick a family's representative by
	// table position rather than by rank, and slicing first would let `IBM Plex Sans` and
	// `IBM Plex Sans Thai` spend two of the three slots saying the same thing.
	const collapsed = collapseVariants(sorted, (entry) => entry.family);

	const derived: FontCandidate[] = collapsed.map((entry) => ({
		provenance: 'derived',
		family: entry.family,
		score: toPercent(entry.value),
		rationale: rationaleFor(entry.tags, seed, category, tone, matched, rankedOn, fellBack),
	}));

	if (named === undefined) {
		return derived.slice(0, MAX_PER_ROLE);
	}

	const canonical = canonicalFamily(named.family);
	const invented: FontCandidate = {
		provenance: 'invented',
		family: named.family,
		score: null,
		rationale: 'Named by the model rather than ranked from the table, so it carries no score.',
	};

	return [
		invented,
		// The model's pick and a script variant of it are one answer, the same way two variants are.
		...derived.filter((candidate) => canonicalFamily(candidate.family) !== canonical),
	].slice(0, MAX_PER_ROLE);
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
	const modeFor = (role: Role): RankingMode => options.mode ?? DEFAULT_MODE[role];
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
		// families body would have dropped. The ranking stays display's, because that one face is
		// still the brand's expressive face.
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
				// of running text. The acceptance criteria in #42 have it the other way round, and the
				// issue's Proposed Behavior section and the `VT323` row in the curated table are the
				// two that agree with the code.
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
