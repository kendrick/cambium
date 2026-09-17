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

	// Real names from `tags/all/families.csv`, because the whole point of the SC rule is what the
	// actual file contains: 31 of the 34 ` SC` families collide with a base, and only the two Noto
	// ones mean Simplified Chinese.
	it.each([
		['Noto Sans SC', 'Noto Sans'],
		['Noto Serif SC', 'Noto Serif'],
	])('strips SC from %s, where it is Simplified Chinese', (family, canonical) => {
		expect(canonicalFamily(family)).toBe(canonical);
	});

	// The other 29. A small-caps cut cannot set running text, so folding it into its base can hand
	// back the small-caps face as the body answer and drop the real one.
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
