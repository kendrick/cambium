/**
 * The script and language suffix tokens that mark a family as a coverage variant of another.
 *
 * Excludes width and category words (`Condensed`, `Slab`, `Mono`, `Display`, `Text`, `Expanded`,
 * ...). Those name a distinct type family, not a coverage variant of one, and folding them in
 * here would collapse `Roboto` and `Roboto Slab` into a single slot.
 */
export const VARIANT_SUFFIXES: readonly string[] = [
	'Thai Looped',
	'JP',
	'KR',
	'SC',
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
 * Strips trailing script and language suffix tokens to the family they vary.
 *
 * This is a heuristic over names, not a lookup against a real taxonomy, so it fails in two
 * predictable ways. A family whose genuine name happens to end in one of these tokens (a
 * hypothetical "Something Arabic" that isn't a Noto/IBM Plex-style variant) loses a word it
 * should have kept. A script or language missing from `VARIANT_SUFFIXES` goes unrecognized and
 * stands as its own family. Neither failure is detectable from the output alone.
 */
export function canonicalFamily(family: string): string {
	const words = family.split(' ');

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

	return family;
}

/**
 * Keeps one item per canonical family. Prefers the member whose family name IS the canonical
 * base; failing that, the earliest member in input order. Returns the kept items in input order.
 *
 * The ranker calls this with a score-sorted list, so "earliest in input order" is how a variant
 * with no base sibling in the pool still wins on rank alone.
 */
export function collapseVariants<T>(items: readonly T[], familyOf: (item: T) => string): T[] {
	const keptIndexByCanonical = new Map<string, number>();

	items.forEach((item, index) => {
		const family = familyOf(item);
		const canonical = canonicalFamily(family);
		const currentIndex = keptIndexByCanonical.get(canonical);

		if (currentIndex === undefined) {
			keptIndexByCanonical.set(canonical, index);
			return;
		}

		// A base form beats an earlier-ranked variant when one appears; two variants, or two
		// bases, otherwise keep whichever came first.
		const currentIsBase = familyOf(items[currentIndex]) === canonical;
		const candidateIsBase = family === canonical;

		if (!currentIsBase && candidateIsBase) {
			keptIndexByCanonical.set(canonical, index);
		}
	});

	const keptIndices = new Set(keptIndexByCanonical.values());
	return items.filter((_, index) => keptIndices.has(index));
}
