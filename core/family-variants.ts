import { CATEGORY_TAGS } from './font-table';

/**
 * The script and language suffix tokens that mark a family as a coverage variant of another.
 *
 * Excludes width and category words (`Condensed`, `Slab`, `Mono`, `Display`, `Text`, `Expanded`,
 * ...). Those name a distinct type family, not a coverage variant of one, and folding them in
 * here would collapse `Roboto` and `Roboto Slab` into a single slot.
 *
 * `SC` is absent on purpose and handled by `canonicalFamily` instead, because it is the one suffix
 * whose meaning depends on which family carries it. See `SIMPLIFIED_CHINESE_FAMILY_PREFIX`.
 */
const VARIANT_SUFFIXES: readonly string[] = [
	'Thai Looped',
	'JP',
	'KR',
	'TC',
	'HK',
	'Thai',
	'Devanagari',
	'Arabic',
	'Hebrew',
	'Armenian',
	'Georgian',
	'Bengali',
	'Gujarati',
	'Gurmukhi',
	'Kannada',
	'Khmer',
	'Lao',
	'Malayalam',
	'Myanmar',
	'Oriya',
	'Sinhala',
	'Tamil',
	'Telugu',
	'Tibetan',
	'Ethiopic',
	'Cherokee',
	'Canadian Aboriginal',
	'Syriac',
	'Thaana',
	'Adlam',
	'Balinese',
	'Javanese',
	'Sundanese',
	'Mongolian',
	"N'Ko",
	'Vai',
	'Yi',
	'Tifinagh',
	'Ogham',
	'Runic',
	'Glagolitic',
	'Coptic',
	'Samaritan',
	'Osage',
	'Osmanya',
	'Meetei Mayek',
	'Tai Viet',
	'New Tai Lue',
	'Cham',
	'Kayah Li',
	'Lepcha',
	'Limbu',
	'Mandaic',
	'Modi',
	'Rejang',
	'Saurashtra',
	'Sora Sompeng',
	'Syloti Nagri',
	'Tagbanwa',
	'Tai Le',
	'Tai Tham',
	'Wancho',
	'Warang Citi',
	'Buginese',
	'Batak',
	'Hanifi Rohingya',
];

/**
 * Suffix tokens, longest first. A greedy match against unsorted suffixes would strip `Thai` out
 * of `Noto Sans Thai Looped` and stop there, leaving the real variant name `Noto Sans Thai`
 * instead of the intended `Noto Sans`. Trying multi-token suffixes before their shorter
 * substrings avoids that.
 */
// `map` already returned a fresh array, so this sort mutates nothing anyone else can see.
// `toSorted` would satisfy the rule directly, but it is ES2023 and tsconfig targets ES2022, the
// same trade lib/bundle-size.ts makes.
const SORTED_VARIANT_SUFFIXES: readonly string[][] = [...VARIANT_SUFFIXES]
	.map((suffix) => suffix.split(' '))
	// oxlint-disable-next-line unicorn/no-array-sort
	.sort((a, b) => b.length - a.length);

/**
 * `SC` is the one suffix here that the name alone cannot resolve, and the obvious reading is the
 * wrong one. Counted against `tags/all/families.csv` at the pinned commit: 34 families end in ` SC`,
 * and 31 of those sit beside a base family the table also carries. Exactly 2 of the 31 are
 * Simplified Chinese, `Noto Sans SC` and `Noto Serif SC`. The other 29 are small-caps cuts:
 * `Cormorant SC`, `Playfair Display SC`, `Spectral SC`, `Vollkorn SC`, `Alegreya SC`,
 * `Baskervville SC`, `Marcellus SC`, the five `IM Fell` faces, and the rest. Reading every ` SC` as
 * a script variant is wrong 29 times out of 31.
 *
 * Being wrong here costs more than a discarded candidate. Small caps is a different answer from its
 * base rather than the same design reaching another script, because running text cannot be set in
 * small caps at all. Collapsing the pair and keeping whichever won on tags can return `Cormorant SC`
 * as the body recommendation and drop `Cormorant`.
 *
 * So ` SC` strips under Noto and nowhere else. Noto is a script-coverage superfamily by
 * construction, which is what makes the suffix unambiguous there. The other CJK suffixes were
 * counted the same way and need no such scoping: `TC` and `HK` have no non-Noto collisions at all,
 * and `JP` and `KR` have exactly one each, `IBM Plex Sans JP` and `IBM Plex Sans KR`, both genuine
 * coverage variants.
 *
 * Every count above is a snapshot of one commit, so a SHA bump can age it out. The rule fails
 * silently if upstream ever ships a Simplified Chinese ` SC` face outside Noto: the tests would all
 * still pass while the answer went wrong. Recount when the pin moves.
 */
const SIMPLIFIED_CHINESE_FAMILY_PREFIX = 'Noto ';

/**
 * Noto is a script-coverage superfamily by construction: `Noto Sans Avestan` and `Noto Sans Brahmi`
 * are one design reaching another writing system, which is the definition of a coverage variant.
 *
 * Listing its scripts in `VARIANT_SUFFIXES` does not scale. Noto spans roughly 190 of them against
 * the 66 tokens that list carries, and counted against the pinned file the shortfall left 94
 * `Noto Sans` cuts standing as their own family in the `/Sans/Humanist` and `/Sans/Rounded` pool
 * alone—enough for one typeface to take two of a role's three slots under a different name each
 * time. Matching the prefix needs no list of scripts at all: of the 202 cuts under the two bases it
 * collapses 191, leaving only the ten `NOTO_NON_SCRIPT_CUTS` names below.
 *
 * Only these two bases. The other nine Noto families are separate designs rather than cuts of
 * these, `Noto Kufi Arabic` and `Noto Nastaliq Urdu` among them, and they keep their own slot.
 */
const NOTO_COVERAGE_BASES: readonly string[] = ['Noto Sans', 'Noto Serif'];

/**
 * The `Noto Sans` and `Noto Serif` cuts that vary something other than script coverage, so they
 * stay distinct for the reason `Roboto Condensed` and `Roboto Slab` do.
 *
 * The prefix rule above cannot tell a script from anything else in that position, and the structural
 * tag cannot either: counted against the pinned file, 159 of the 160 `Noto Sans` cuts and 40 of the
 * 42 `Noto Serif` cuts carry the same `/Sans/Humanist` or `/Serif/Transitional` tag as their base.
 * That shared tag is exactly why collapsing the script cuts is right, and it is also why these have
 * to be named one at a time.
 *
 * Membership is decided by what the cut is, not by what it currently reaches. "Is it a writing
 * system" is the obvious rule and it does not work: Duployan, Shavian and SignWriting are all
 * Unicode scripts, and only the first two belong on the collapsing side. The line that does hold is
 * whether the cut sets a language's running text. `Duployan` and `Shavian` do, in shorthand and in
 * a reformed alphabet, so they collapse the way `Avestan` does. The ten below do not: two are style
 * cuts, and the rest cover symbols, numerals or notation. `SignWriting` notates gesture rather than
 * running text, which is why it sits with them despite being a script.
 *
 * `Ottoman Siyaq` and `Indic Siyaq Numbers` are both siyaq numeral notation, so covering one and
 * not the other would have been an inconsistency rather than a line.
 *
 * `Mono` is the one worth reading twice. `Noto Sans Mono` is a monospace design carrying
 * `/Sans/Humanist` and no `/Monospace/Monospace` row—no Noto family carries that tag at all—so
 * it never reaches the mono pool and folding it onto `Noto Sans` costs a distinct sans answer
 * rather than a mono one. Its `/Quality/Spacing` is 80 against the base's 70, so a craft ranking
 * really does separate them.
 *
 * `Symbols 2` is the one entry that changes nothing today: it carries no structural tag, so it
 * reaches no pool and cannot fold anywhere. Nine of the ten do work now. It stays because its
 * sibling `Symbols` does carry `/Sans/Humanist`, which makes the gap look like an upstream omission
 * rather than a deliberate statement, and because one string costs nothing while the retag that
 * would make it matter needs no further action from anyone.
 *
 * Not collapsing these leaves them free to hold a candidate slot, which is a separate question and
 * recorded where it is decided, on `rankRole` in `core/rank-fonts.ts`.
 *
 * Every count here is a snapshot of one commit, and `UPSTREAM_SHA` in
 * `app/fonts/font-table-provider.ts` holds the pin they were taken at. That file carries the
 * procedure for rebuilding this set when the pin moves; `core/` cannot import it, so it cannot
 * point at it in code.
 */
const NOTO_NON_SCRIPT_CUTS: ReadonlySet<string> = new Set([
	'Display',
	'Indic Siyaq Numbers',
	'Math',
	'Mayan Numerals',
	'Mono',
	'Ottoman Siyaq',
	'SignWriting',
	'Symbols',
	'Symbols 2',
	'Tamil Supplement',
]);

/**
 * Strips trailing script and language suffix tokens to the family they vary.
 *
 * This is a heuristic over names, not a lookup against a real taxonomy, so it fails in two
 * predictable ways. A family whose genuine name happens to end in one of these tokens (a
 * hypothetical "Something Arabic" that isn't a Noto/IBM Plex-style variant) loses a word it
 * should have kept. A script or language missing from `VARIANT_SUFFIXES` goes unrecognized and
 * stands as its own family. Neither failure is detectable from the output alone.
 *
 * `SC` was the first failure measured rather than imagined, which is why it now has a rule of its
 * own. Any suffix added here is worth counting against the real file the same way first.
 */
export function canonicalFamily(family: string): string {
	// Ahead of everything else, because it is the most specific rule and answers outright.
	for (const base of NOTO_COVERAGE_BASES) {
		if (!family.startsWith(`${base} `)) continue;

		const cut = family.slice(base.length + 1);

		return NOTO_NON_SCRIPT_CUTS.has(cut) ? family : base;
	}

	let words = family.split(' ');

	// Ahead of the general list, because ` SC` is always the last word and its reading decides
	// whether anything strips at all. A small-caps cut keeps its whole name: nothing further can
	// apply once the tail is refused. A Noto one drops the token and falls through, so a name
	// carrying both a script and `SC` still reduces all the way.
	if (words.length > 1 && words.at(-1) === 'SC') {
		if (!family.startsWith(SIMPLIFIED_CHINESE_FAMILY_PREFIX)) {
			return family;
		}

		words = words.slice(0, -1);
	}

	for (const suffixWords of SORTED_VARIANT_SUFFIXES) {
		// A suffix has to leave at least one word behind, so a family made only of the suffix
		// token has no base to strip to.
		if (suffixWords.length >= words.length) continue;

		const tailStart = words.length - suffixWords.length;
		const isMatch = suffixWords.every((word, i) => words[tailStart + i] === word);

		if (isMatch) {
			return words.slice(0, tailStart).join(' ');
		}
	}

	// `words` rather than `family`, so a stripped ` SC` survives a pass that matched nothing else.
	return words.join(' ');
}

/**
 * The trailing words that name how one drawing was cut, rather than what the drawing is.
 *
 * Two axes sit here, and #61 argues both are safe because neither pair ever represents a choice of
 * character. `Code` and `Mono` are a feature set: `Cascadia Code` is `Cascadia Mono` with
 * programming ligatures switched on, and `Fira Code` and `Fira Mono` repeat the shape one family
 * over. `Flex` is a variable-axis superset: `Google Sans Flex` and `Roboto Flex` are their bases
 * with more axes to interpolate, which puts them nearer the optical-size case than the width one.
 *
 * Width and category words stay out, for the reason `VARIANT_SUFFIXES` keeps them out. `Roboto
 * Condensed` is a voice a brand may want on purpose, and `Roboto Slab` is a different type family
 * wearing the same first word. Nothing in a name separates `Condensed` from `Mono`, which is why
 * the structural tags have to decide and this list alone cannot.
 *
 * A word list rather than a list of pairs, which is what #61 rules out. No family is named here:
 * `Cascadia Code` and `Cascadia Mono` fold because they share a base, one of them ends in a word
 * above, and the table places both as monospace. `Fira Code` and `Fira Mono` fold on the same three
 * facts without anyone having noticed them.
 *
 * Three known failures, none of them detectable from the output:
 *
 * `Playfair` and `Playfair Display` are an optical-size pair this misses. `Display` names an
 * optical cut on some families and a distinct voice on others—`DM Serif Display` has no base to
 * fold onto—so adding it would collapse faces that should stand apart. Missing a pair costs a
 * duplicated slot; collapsing a wrong one costs a candidate the brand should have seen, so the
 * rule takes the cheaper failure.
 *
 * A family whose real name ends in one of these words, sitting beside an unrelated sibling of the
 * same structural kind under the same base, folds wrongly. Unlike the ` SC` rule above, this one was
 * reasoned from the pairs #61 reports rather than counted against `tags/all/families.csv`: ADR-0001
 * keeps that file out of the repo, and the test suite runs offline. So read the argument here as an
 * argument, not as a measurement. Counting it at the pin in `app/fonts/font-table-provider.ts` is
 * the check that would turn it into one.
 *
 * What the curated table does prove is narrower and still worth having: over its 58 families the
 * rule collapses nothing the script rule did not already collapse, which is #61's last criterion.
 *
 * `Flex` is the token most likely to age badly. It is a naming fashion rather than a typographic
 * term, so a future family could carry it meaning something else entirely.
 */
const CUT_SUFFIXES: ReadonlySet<string> = new Set(['Code', 'Flex', 'Mono']);

/**
 * An optical-size cut names its rendering size: `Slabo 13px` and `Slabo 27px` are one design cut
 * twice, and Google publishes them separately so a reader picks by size rather than by taste.
 *
 * A pattern rather than the two names, because #61 asks the rule to read a property of the family
 * rather than an enumerated pair list. `Slabo` is the only family known to carry it, so the pattern
 * buys nothing today beyond refusing to hardcode the pair—which is the point.
 */
const OPTICAL_SIZE_CUT = /^\d+px$/;

/**
 * The tags that say what kind of face a family is, which is the only question the cut rule asks of
 * them.
 *
 * `CATEGORY_TAGS` rather than a second list: these are the rows `resolveCandidatePool` matches to
 * build a pool, so a family carrying one has been placed as a sans, a serif, a slab or a monospace
 * by the same evidence the ranker used. `/Quality/*`, `/Expressive/*` and `/Theme/*` describe how a
 * face reads rather than what it is, and two cuts of one drawing routinely disagree on all three.
 */
const STRUCTURAL_TAGS: ReadonlySet<string> = new Set<string>(
	Object.values(CATEGORY_TAGS).flatMap((tags) => tags),
);

/** What the cut rule needs to know about a family it has already kept. */
interface CutReading {
	/** The name with its cut word removed, or the whole name when it carries none. */
	base: string;
	isCut: boolean;
	structural: ReadonlySet<string>;
}

/**
 * The base a cut word hangs off, or `undefined` for a name carrying none.
 */
function cutBase(canonical: string): string | undefined {
	// `canonicalFamily` owns every cut of these two bases outright, and has already ruled that
	// `Noto Sans Mono` keeps its own slot. The structural gate below cannot re-derive that ruling:
	// upstream tags `Noto Sans Mono` `/Sans/Humanist` like its base and gives it no
	// `/Monospace/Monospace` row at all, so the tags agree and the pair would fold. One rule per
	// family, and for these two bases it is the one above.
	if (NOTO_COVERAGE_BASES.some((base) => canonical.startsWith(`${base} `))) return undefined;

	const words = canonical.split(' ');

	// A cut word has to leave a base behind, the same guard the suffix loop applies. Otherwise every
	// family named only `Mono` would strip to nothing and match every other one that did.
	if (words.length < 2) return undefined;

	const last = words[words.length - 1]!;

	if (!CUT_SUFFIXES.has(last) && !OPTICAL_SIZE_CUT.test(last)) return undefined;

	return words.slice(0, -1).join(' ');
}

function structuralTagsOf(tags: Iterable<string> | undefined): ReadonlySet<string> {
	const structural = new Set<string>();

	for (const tag of tags ?? []) {
		if (STRUCTURAL_TAGS.has(tag)) structural.add(tag);
	}

	return structural;
}

/**
 * Whether two families are one drawing cut two ways.
 *
 * Three conditions, and the second is the one worth reading twice. A family carrying no cut word
 * never joins a group formed by one, so `Roboto` and `Roboto Mono` are held apart by their names
 * before their tags are consulted at all—and `Google Sans` and `Google Sans Flex` are not, because
 * one of the two does carry a cut word. Requiring a cut word on both sides instead would have split
 * that pair; requiring one on neither would have folded `Roboto`.
 *
 * The structural test is the third condition and the load-bearing one. `Roboto` reads
 * `/Sans/Neo Grotesque` while `Roboto Mono` reads `/Monospace/Monospace`, which is the difference no
 * reading of the two names can recover. Sharing one tag rather than matching the whole set, so a
 * secondary row on one member does not break a real pair; a family with no structural row at all
 * shares nothing and so collapses with nobody, which is what makes the rule inert when the caller
 * passes no tags.
 */
function areCutVariants(a: CutReading, b: CutReading): boolean {
	if (a.base !== b.base) return false;
	if (!a.isCut && !b.isCut) return false;

	return [...a.structural].some((tag) => b.structural.has(tag));
}

/**
 * Keeps the first item of each family and drops the rest, in input order.
 *
 * The ranker calls this with a score-sorted list, so first means best-ranked, and the group lands
 * exactly where its strongest member ranked.
 *
 * An earlier version preferred the bare base name over a higher-ranked variant, which read well
 * and ranked wrong: the group inherited the base's position and score, so a family whose Thai
 * variant carried the pool's best spacing could be demoted below faces it beat, or pushed out of
 * the role entirely. Naming the base while reporting the variant's score is the other way to lose,
 * since the rationale would then credit tags the named family does not carry. Whichever member
 * actually won keeps its own name, score, and tags.
 *
 * Two rules decide what counts as one family. `canonicalFamily` folds script and language coverage
 * variants by name alone. The cut rule folds one drawing cut for an optical size or a feature set,
 * and it needs `tagsOf` to do it: `Cascadia Code` beside `Cascadia Mono` and `Roboto` beside
 * `Roboto Mono` are the same shape as names and opposite answers, and only the structural tags
 * separate them. A caller that knows names and no tags omits `tagsOf` and gets the script rule
 * alone.
 *
 * `tagsOf` is read once per item, so an accessor handing back a one-shot iterator is safe.
 */
export function collapseVariants<T>(
	items: readonly T[],
	familyOf: (item: T) => string,
	tagsOf?: (item: T) => Iterable<string> | undefined,
): T[] {
	const seen = new Set<string>();
	// Grouped by base rather than scanned linearly. A sans pool runs to hundreds of families, and
	// comparing every candidate against every kept one would be quadratic for a rule that fires on a
	// handful of them.
	const keptByBase = new Map<string, CutReading[]>();

	return items.filter((item) => {
		const canonical = canonicalFamily(familyOf(item));

		if (seen.has(canonical)) return false;

		const cut = cutBase(canonical);
		const reading: CutReading = {
			base: cut ?? canonical,
			isCut: cut !== undefined,
			structural: structuralTagsOf(tagsOf?.(item)),
		};
		const group = keptByBase.get(reading.base) ?? [];

		if (group.some((other) => areCutVariants(reading, other))) return false;

		seen.add(canonical);
		group.push(reading);
		keptByBase.set(reading.base, group);

		return true;
	});
}
