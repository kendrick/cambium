import { describe, expect, it } from 'vitest';

import { canonicalFamily, collapseVariants } from './family-variants';

describe('canonicalFamily', () => {
	it.each([
		['IBM Plex Sans', 'IBM Plex Sans'],
		['IBM Plex Sans Thai', 'IBM Plex Sans'],
		['IBM Plex Sans KR', 'IBM Plex Sans'],
		['IBM Plex Sans JP', 'IBM Plex Sans'],
		['IBM Plex Sans Devanagari', 'IBM Plex Sans'],
		['IBM Plex Sans Arabic', 'IBM Plex Sans'],
		['IBM Plex Sans Hebrew', 'IBM Plex Sans'],
		['Noto Sans', 'Noto Sans'],
		['Noto Sans JP', 'Noto Sans'],
		['Noto Sans KR', 'Noto Sans'],
		['Noto Sans SC', 'Noto Sans'],
		['Noto Sans TC', 'Noto Sans'],
		['Noto Sans HK', 'Noto Sans'],
		['Noto Sans Armenian', 'Noto Sans'],
		['Noto Serif Georgian', 'Noto Serif'],
		// The multi-token suffix has to strip as one unit. Stripping "Looped" alone first would
		// leave a family still named "Noto Sans Thai", which is itself a real variant name.
		['Noto Sans Thai Looped', 'Noto Sans'],
	])('resolves %s to %s', (family, canonical) => {
		expect(canonicalFamily(family)).toBe(canonical);
	});

	// These are the constraint this module exists to enforce: a width or category word must never
	// be read as a script/language variant, or distinct type families would wrongly collapse.
	it.each([
		'Roboto',
		'Roboto Condensed',
		'Roboto Slab',
		'Roboto Mono',
		'Archivo Expanded',
		'Archivo Black',
	])('leaves %s unchanged', (family) => {
		expect(canonicalFamily(family)).toBe(family);
	});

	// A family that is nothing but a suffix token has no base left to strip to. Guards against a
	// naive implementation that would return an empty string for a single-word input.
	it('leaves a single-word family unchanged even if that word is a suffix token', () => {
		expect(canonicalFamily('Thai')).toBe('Thai');
	});

	// Real names throughout this block, because what the upstream file actually contains is the whole
	// argument for the rule. `SIMPLIFIED_CHINESE_FAMILY_PREFIX` carries the counts and the commit
	// they were taken at; they are not repeated here, so a recount changes one place.
	it.each([
		['Noto Sans SC', 'Noto Sans'],
		['Noto Serif SC', 'Noto Serif'],
	])('strips SC from %s, where it is Simplified Chinese', (family, canonical) => {
		expect(canonicalFamily(family)).toBe(canonical);
	});

	// A small-caps cut cannot set running text, so folding it into its base can hand back the
	// small-caps face as the body answer and drop the real one.
	it.each([
		'Cormorant SC',
		'Playfair Display SC',
		'Spectral SC',
		'Vollkorn SC',
		'Alegreya SC',
		'Baskervville SC',
		'Marcellus SC',
		'IM Fell English SC',
	])('leaves %s alone, where SC is small caps', (family) => {
		expect(canonicalFamily(family)).toBe(family);
	});

	// Noto collapses by prefix rather than by an enumerated script list, which is the only way it
	// scales: Noto covers roughly 190 scripts. Real names, one per shape the prefix rule has to get
	// right.
	it.each([
		['Noto Sans Avestan', 'Noto Sans'],
		['Noto Sans Anatolian Hieroglyphs', 'Noto Sans'],
		['Noto Sans Adlam Unjoined', 'Noto Sans'],
		['Noto Sans Thai Looped', 'Noto Sans'],
		['Noto Serif Tibetan', 'Noto Serif'],
	])('collapses %s onto its coverage base', (family, canonical) => {
		expect(canonicalFamily(family)).toBe(canonical);
	});

	// The cuts that vary something other than coverage, mirroring `NOTO_NON_SCRIPT_CUTS`. That
	// docblock carries why each one is here and the counts behind it; they are not repeated, so a
	// recount changes one place.
	it.each([
		'Noto Sans Mono',
		'Noto Sans Display',
		'Noto Serif Display',
		'Noto Sans Math',
		'Noto Sans Symbols',
		'Noto Sans Symbols 2',
		'Noto Sans SignWriting',
		'Noto Sans Mayan Numerals',
		'Noto Sans Indic Siyaq Numbers',
		'Noto Serif Ottoman Siyaq',
		'Noto Sans Tamil Supplement',
	])('leaves %s alone, where the cut is not script coverage', (family) => {
		expect(canonicalFamily(family)).toBe(family);
	});

	// The rule the exceptions sit inside still has to hold, or the exception set would be doing all
	// the work. `Tamil Supplement` is excepted while plain `Tamil` collapses, which is the pair most
	// likely to be broken by a careless edit to either list.
	it.each([
		['Noto Sans Tamil', 'Noto Sans'],
		['Noto Sans Sunuwar', 'Noto Sans'],
		['Noto Serif Todhri', 'Noto Serif'],
		// Both read like notation and are real writing systems, which is where the line sits: the set
		// is about what a cut is, not about how its name sounds.
		['Noto Sans Duployan', 'Noto Sans'],
		['Noto Sans Shavian', 'Noto Sans'],
	])('still collapses the script cut %s', (family, canonical) => {
		expect(canonicalFamily(family)).toBe(canonical);
	});

	// The prefix rule's boundary: `Noto ` alone is not enough to reach it, only `Noto Sans ` and
	// `Noto Serif `. This asserts that boundary and nothing about candidacy, which is a separate
	// question and a separate module.
	it('does not reach a Noto family sitting under neither base', () => {
		expect(canonicalFamily('Noto Znamenny Musical Notation')).toBe(
			'Noto Znamenny Musical Notation',
		);
	});

	// Noto families that are their own design rather than a cut of Noto Sans or Noto Serif. The
	// prefix rule must not reach them.
	it.each(['Noto Kufi Arabic', 'Noto Nastaliq Urdu', 'Noto Color Emoji'])(
		'does not treat %s as a cut of another Noto family',
		(family) => {
			expect(canonicalFamily(family)).not.toBe('Noto Sans');
			expect(canonicalFamily(family)).not.toBe('Noto Serif');
		},
	);

	// The counted evidence for leaving the other CJK suffixes as they are: their only non-Noto
	// collisions are these two, and both are genuine coverage variants.
	it.each([
		['IBM Plex Sans JP', 'IBM Plex Sans'],
		['IBM Plex Sans KR', 'IBM Plex Sans'],
		['Noto Sans TC', 'Noto Sans'],
		['Noto Sans HK', 'Noto Sans'],
	])('still strips %s', (family, canonical) => {
		expect(canonicalFamily(family)).toBe(canonical);
	});
});

interface Candidate {
	family: string;
	score: number;
}

const byFamily = (candidate: Candidate) => candidate.family;

describe('collapseVariants', () => {
	it('keeps one entry per canonical family', () => {
		const candidates: Candidate[] = [
			{ family: 'IBM Plex Sans', score: 90 },
			{ family: 'IBM Plex Sans Thai', score: 85 },
			{ family: 'IBM Plex Sans KR', score: 80 },
		];

		const kept = collapseVariants(candidates, byFamily);

		expect(kept).toEqual([{ family: 'IBM Plex Sans', score: 90 }]);
	});

	// The ranker sorts by score before calling, so the first member of a group is its best. Keeping
	// the bare base name instead would hand the group the base's score and the base's place in the
	// order, which demotes a family below faces its strongest member beat.
	it('keeps the highest-ranked member even when the base form ranks below it', () => {
		const candidates: Candidate[] = [
			{ family: 'IBM Plex Sans Thai', score: 95 },
			{ family: 'IBM Plex Sans', score: 70 },
		];

		expect(collapseVariants(candidates, byFamily)).toEqual([
			{ family: 'IBM Plex Sans Thai', score: 95 },
		]);
	});

	it('keeps the earliest member when no base form is present', () => {
		const candidates: Candidate[] = [
			{ family: 'Noto Sans JP', score: 88 },
			{ family: 'Noto Sans KR', score: 92 },
		];

		expect(collapseVariants(candidates, byFamily)).toEqual([{ family: 'Noto Sans JP', score: 88 }]);
	});

	// Width and category siblings are distinct type families, not coverage variants of one
	// another, so all four have to survive as their own slots.
	it('keeps Roboto, Roboto Condensed, Roboto Slab, and Roboto Mono as four entries', () => {
		const candidates: Candidate[] = [
			{ family: 'Roboto', score: 100 },
			{ family: 'Roboto Condensed', score: 90 },
			{ family: 'Roboto Slab', score: 80 },
			{ family: 'Roboto Mono', score: 70 },
		];

		expect(collapseVariants(candidates, byFamily)).toEqual(candidates);
	});

	it('keeps a lone script variant under its own name when no sibling is present', () => {
		const candidates: Candidate[] = [
			{ family: 'Noto Sans JP', score: 88 },
			{ family: 'Roboto', score: 100 },
		];

		expect(collapseVariants(candidates, byFamily)).toEqual(candidates);
	});

	// The output preserves the input's own order, which for a score-sorted input is rank order.
	// This function never sorts.
	it('returns kept items in input order across interleaved groups', () => {
		const candidates: Candidate[] = [
			{ family: 'Noto Sans JP', score: 88 },
			{ family: 'IBM Plex Sans Thai', score: 95 },
			{ family: 'Noto Sans KR', score: 92 },
			{ family: 'IBM Plex Sans', score: 70 },
		];

		expect(collapseVariants(candidates, byFamily)).toEqual([
			{ family: 'Noto Sans JP', score: 88 },
			{ family: 'IBM Plex Sans Thai', score: 95 },
		]);
	});

	// The regression in the form it would reach a user: `Cormorant SC` outranks `Cormorant` on tags,
	// and collapsing them would return the small-caps cut as the body answer with the real face gone.
	it('keeps a small-caps cut and its base as two answers', () => {
		const candidates: Candidate[] = [
			{ family: 'Cormorant SC', score: 95 },
			{ family: 'Cormorant', score: 70 },
		];

		expect(collapseVariants(candidates, byFamily)).toEqual(candidates);
	});

	it('still keeps a Noto script variant and its base to one slot', () => {
		const candidates: Candidate[] = [
			{ family: 'Noto Sans SC', score: 95 },
			{ family: 'Noto Sans', score: 70 },
		];

		expect(collapseVariants(candidates, byFamily)).toEqual([{ family: 'Noto Sans SC', score: 95 }]);
	});

	it('returns an empty array over an empty input', () => {
		expect(collapseVariants([], byFamily)).toEqual([]);
	});
});

interface TaggedCandidate extends Candidate {
	tags: string[];
}

const taggedFamily = (candidate: TaggedCandidate) => candidate.family;
const taggedTags = (candidate: TaggedCandidate) => candidate.tags;

const MONO = ['/Monospace/Monospace', '/Quality/Spacing'];
const SLAB = ['/Slab/Humanist', '/Quality/Spacing'];
const GEOMETRIC_SANS = ['/Sans/Geometric', '/Quality/Spacing'];
const NEO_GROTESQUE_SANS = ['/Sans/Neo Grotesque', '/Quality/Spacing'];
const HUMANIST_SANS = ['/Sans/Humanist', '/Quality/Spacing'];

/**
 * The cut rule, which #61 specifies. Real Google Fonts names throughout, because which families
 * upstream actually publishes is the whole argument for where the line sits.
 */
describe('collapseVariants over cut variants', () => {
	// Optical size. One design cut for a rendering size, and Google publishes the two separately so
	// a reader picks by size rather than by taste.
	it('keeps Slabo 13px and Slabo 27px to one slot', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Slabo 27px', score: 95, tags: SLAB },
			{ family: 'Slabo 13px', score: 70, tags: SLAB },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual([
			{ family: 'Slabo 27px', score: 95, tags: SLAB },
		]);
	});

	// Feature set. `Cascadia Code` is `Cascadia Mono` with programming ligatures switched on, and
	// neither is the base: the group has to form without one.
	it('keeps Cascadia Code and Cascadia Mono to one slot', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Cascadia Code', score: 90, tags: MONO },
			{ family: 'Cascadia Mono', score: 80, tags: MONO },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual([
			{ family: 'Cascadia Code', score: 90, tags: MONO },
		]);
	});

	// The same shape one family over, so the rule is not reading `Cascadia` in particular.
	it('keeps Fira Code and Fira Mono to one slot while sparing Fira Sans', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Fira Code', score: 90, tags: MONO },
			{ family: 'Fira Mono', score: 85, tags: MONO },
			{ family: 'Fira Sans', score: 80, tags: HUMANIST_SANS },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual([
			{ family: 'Fira Code', score: 90, tags: MONO },
			{ family: 'Fira Sans', score: 80, tags: HUMANIST_SANS },
		]);
	});

	// Whichever member won the ranking keeps its own name and score, matching what the script rule
	// already does. The ranker sorts before calling, so the first member of a group is its best.
	it('returns the higher-ranked member of a cut group with its own score', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Cascadia Mono', score: 95, tags: MONO },
			{ family: 'Cascadia Code', score: 60, tags: MONO },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual([
			{ family: 'Cascadia Mono', score: 95, tags: MONO },
		]);
	});

	// Width. `Roboto Condensed` is a distinct voice a brand may want on purpose, which is the case
	// the whole rule is shaped around: a name-only reading cannot tell it from `Cascadia Mono`.
	it('keeps Roboto and Roboto Condensed as two candidates', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Roboto', score: 100, tags: NEO_GROTESQUE_SANS },
			{ family: 'Roboto Condensed', score: 90, tags: NEO_GROTESQUE_SANS },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual(candidates);
	});

	// `Mono` is a cut token, so only the structural tags separate these two. Upstream tags `Roboto`
	// a sans and `Roboto Mono` a monospace, which is the whole signal.
	it('keeps Roboto and Roboto Mono as two candidates even with tags in hand', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Roboto', score: 100, tags: NEO_GROTESQUE_SANS },
			{ family: 'Roboto Mono', score: 90, tags: MONO },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual(candidates);
	});

	// The decision #61 asks to be made either way: `Google Sans Flex` is a variable-axis superset of
	// the same drawing, so it collapses. `CUT_SUFFIXES` carries why `Flex` is in and `Condensed` is
	// not.
	it('keeps Google Sans and Google Sans Flex to one slot', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Google Sans Flex', score: 95, tags: GEOMETRIC_SANS },
			{ family: 'Google Sans', score: 90, tags: GEOMETRIC_SANS },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual([
			{ family: 'Google Sans Flex', score: 95, tags: GEOMETRIC_SANS },
		]);
	});

	// Three real families under one base, and the structural tags have to split them two ways:
	// `Google Sans Code` is the monospace cut, so it is a different answer rather than the same one
	// with more axes.
	it('folds Google Sans Flex onto Google Sans while sparing Google Sans Code', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Google Sans', score: 95, tags: GEOMETRIC_SANS },
			{ family: 'Google Sans Flex', score: 90, tags: GEOMETRIC_SANS },
			{ family: 'Google Sans Code', score: 85, tags: MONO },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual([
			{ family: 'Google Sans', score: 95, tags: GEOMETRIC_SANS },
			{ family: 'Google Sans Code', score: 85, tags: MONO },
		]);
	});

	// `canonicalFamily` already refused this pair on purpose, and the cut rule must not reopen it.
	// Upstream tags `Noto Sans Mono` `/Sans/Humanist` like its base, so the structural tags agree and
	// the Noto guard is the only thing holding them apart.
	it('keeps Noto Sans and Noto Sans Mono as two candidates', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Noto Sans', score: 90, tags: HUMANIST_SANS },
			{ family: 'Noto Sans Mono', score: 80, tags: HUMANIST_SANS },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual(candidates);
	});

	// Two monospace designs that share neither a drawing nor a base name.
	it('keeps two unrelated mono families apart', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'JetBrains Mono', score: 90, tags: MONO },
			{ family: 'Space Mono', score: 80, tags: MONO },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual(candidates);
	});

	// A cut token has to leave a base behind, the same guard `canonicalFamily` applies to its own
	// suffixes. Without it every single-word cut name would strip to nothing and match every other.
	it('keeps single-word families that are nothing but a cut token', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Mono', score: 90, tags: MONO },
			{ family: 'Code', score: 80, tags: MONO },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual(candidates);
	});

	// A family the table carries no structural row for cannot be shown to be the same kind of face
	// as anything, so the rule declines rather than guessing.
	it('leaves a cut pair alone when one member carries no structural tag', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Cascadia Code', score: 90, tags: MONO },
			{ family: 'Cascadia Mono', score: 80, tags: ['/Quality/Spacing'] },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual(candidates);
	});

	// The accessor is optional, and without it the cut rule has nothing to read. A caller that knows
	// names and no tags gets the script rule alone.
	it('cannot fire without the tag accessor', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Cascadia Code', score: 90, tags: MONO },
			{ family: 'Cascadia Mono', score: 80, tags: MONO },
		];

		expect(collapseVariants(candidates, taggedFamily)).toEqual(candidates);
	});

	// Both rules over one list. `Noto Sans JP` folds onto `Noto Sans` by script, `Cascadia Mono`
	// onto `Cascadia Code` by cut, and the output stays in the input's order.
	it('applies the script rule and the cut rule over one list', () => {
		const candidates: TaggedCandidate[] = [
			{ family: 'Cascadia Code', score: 95, tags: MONO },
			{ family: 'Noto Sans', score: 90, tags: HUMANIST_SANS },
			{ family: 'Cascadia Mono', score: 85, tags: MONO },
			{ family: 'Noto Sans JP', score: 80, tags: HUMANIST_SANS },
		];

		expect(collapseVariants(candidates, taggedFamily, taggedTags)).toEqual([
			{ family: 'Cascadia Code', score: 95, tags: MONO },
			{ family: 'Noto Sans', score: 90, tags: HUMANIST_SANS },
		]);
	});
});
