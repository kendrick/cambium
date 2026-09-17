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

	// The cuts that vary something other than coverage. Every one of these carries the same
	// structural tag as its base, so the tag cannot tell them apart and each has to be named.
	// `Noto Sans Mono` is the sharp one: a monospace design tagged `/Sans/Humanist` with no
	// `/Monospace/Monospace` row, so folding it onto the base loses a distinct sans answer.
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
	])('still collapses the script cut %s', (family, canonical) => {
		expect(canonicalFamily(family)).toBe(canonical);
	});

	// Not under either base, so the prefix rule never reached it. Pinned because it is the standing
	// example of the limitation recorded on `NOTO_NON_SCRIPT_CUTS`: a notation face nothing marks as
	// non-text, reaching the sans pool on its own.
	it('leaves Noto Znamenny Musical Notation alone, having never collapsed it', () => {
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
