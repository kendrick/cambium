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
// `toSorted` would satisfy the rule directly, but it is ES2023 and tsconfig targets ES2022 —
// the same trade lib/bundle-size.ts makes.
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
 * alone — enough for one typeface to take two of a role's three slots under a different name each
 * time. Matching the prefix collapses all 199 of them and needs no list of scripts at all.
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
 * That shared tag is exactly why collapsing the script cuts is right, and it is also why these nine
 * reach a pool and have to be named one at a time.
 *
 * `Mono` is the one worth reading twice. `Noto Sans Mono` is a monospace design carrying
 * `/Sans/Humanist` and no `/Monospace/Monospace` row — no Noto family carries that tag at all — so
 * it never reaches the mono pool and folding it onto `Noto Sans` costs a distinct sans answer
 * rather than a mono one. Its `/Quality/Spacing` is 80 against the base's 70, so a craft ranking
 * really does separate them.
 *
 * `Symbols 2` carries no structural tag, so it reaches no pool either way and is here for symmetry
 * with `Symbols` rather than to fix anything.
 *
 * Known limitation, deliberately left. Un-collapsing these means `Noto Sans Math` and friends can
 * now hold a slot of their own, and a notation face is no one's brand typeface. Nothing in the
 * table marks a face as non-text, #42 asks for no such filter, and inventing one is a judgement
 * about candidacy rather than about collapsing. `Noto Znamenny Musical Notation` shows the limit is
 * older than this set: it sits under neither base, so it never collapsed, and it has been reaching
 * the sans pool on its own all along.
 */
const NOTO_NON_SCRIPT_CUTS: ReadonlySet<string> = new Set([
	'Display',
	'Indic Siyaq Numbers',
	'Math',
	'Mayan Numerals',
	'Mono',
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
 * Keeps the first item of each canonical family and drops the rest, in input order.
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
 */
export function collapseVariants<T>(items: readonly T[], familyOf: (item: T) => string): T[] {
	const seen = new Set<string>();

	return items.filter((item) => {
		const canonical = canonicalFamily(familyOf(item));

		if (seen.has(canonical)) return false;

		seen.add(canonical);
		return true;
	});
}
