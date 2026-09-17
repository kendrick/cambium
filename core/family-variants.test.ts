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
});

interface Candidate {
	family: string;
	score: number;
}

const byFamily = (candidate: Candidate) => candidate.family;

describe('collapseVariants', () => {
	it('keeps one entry per canonical family, named for the canonical base', () => {
		const candidates: Candidate[] = [
			{ family: 'IBM Plex Sans', score: 90 },
			{ family: 'IBM Plex Sans Thai', score: 85 },
			{ family: 'IBM Plex Sans KR', score: 80 },
		];

		const kept = collapseVariants(candidates, byFamily);

		expect(kept).toEqual([{ family: 'IBM Plex Sans', score: 90 }]);
	});

	// Order in the input does not decide the winner when a base form is present: the base wins
	// even when a variant was ranked first, because the ranker sorts by score before calling this.
	it('prefers the base form over a higher-ranked variant', () => {
		const candidates: Candidate[] = [
			{ family: 'IBM Plex Sans Thai', score: 95 },
			{ family: 'IBM Plex Sans', score: 70 },
		];

		expect(collapseVariants(candidates, byFamily)).toEqual([
			{ family: 'IBM Plex Sans', score: 70 },
		]);
	});

	it('falls back to the earliest member in input order when no base form is present', () => {
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

	// The output preserves the input's own order across groups, not the order canonical families
	// were first seen or any score order: this function does not sort.
	it('returns kept items in input order across interleaved groups', () => {
		const candidates: Candidate[] = [
			{ family: 'Noto Sans JP', score: 88 },
			{ family: 'IBM Plex Sans Thai', score: 95 },
			{ family: 'Noto Sans KR', score: 92 },
			{ family: 'IBM Plex Sans', score: 70 },
		];

		// Noto Sans JP survives as the earliest of its ungrouped-by-base pair; IBM Plex Sans wins
		// its group over the Thai variant despite ranking lower. Both keep their original slots.
		expect(collapseVariants(candidates, byFamily)).toEqual([
			{ family: 'Noto Sans JP', score: 88 },
			{ family: 'IBM Plex Sans', score: 70 },
		]);
	});

	it('returns an empty array over an empty input', () => {
		expect(collapseVariants([], byFamily)).toEqual([]);
	});
});
