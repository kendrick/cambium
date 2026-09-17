import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { FontTableRefSchema } from '../../../core/brand-record';
import { TypeClassificationSchema } from '../../../core/brand-seed';
import { CATEGORY_TAGS, resolveCandidatePool } from '../../../core/font-table';
import { FALLBACK_FONT_TABLE, FALLBACK_FONT_TABLE_REF } from './index';

type Category = (typeof TypeClassificationSchema.shape.category.options)[number];
type Tone = (typeof TypeClassificationSchema.shape.tone.options)[number];

const categories: Category[] = [...TypeClassificationSchema.shape.category.options];
const tones: Tone[] = [...TypeClassificationSchema.shape.tone.options];

const pairs: [Category, Tone][] = categories.flatMap((category) =>
	tones.map((tone): [Category, Tone] => [category, tone]),
);

const tagsByFamily = new Map<string, Set<string>>();
for (const row of FALLBACK_FONT_TABLE) {
	const tags = tagsByFamily.get(row.family) ?? new Set<string>();
	tags.add(row.tag);
	tagsByFamily.set(row.family, tags);
}

const categoryOfTag = new Map<string, Category>();
for (const category of categories) {
	for (const tag of CATEGORY_TAGS[category]) {
		categoryOfTag.set(tag, category);
	}
}

function distinct(families: readonly string[]): number {
	return new Set(families).size;
}

/**
 * PLACEHOLDER, replaced with a measured figure once the rows land.
 *
 * `lib/bundle-budget.ts` leaves roughly 24 kB of headroom under the 200 kB first-load budget, and
 * the table's own chunk is the largest single claim on it. Measure the real number, then set this
 * to that figure plus stated headroom so a row added later fails here rather than on a page load.
 */
const GZIPPED_CEILING_BYTES = 8_000;

/**
 * The claim this suite makes is coverage: no seed a Brand Seed can express comes back with an
 * empty pool, monospace included. That is the table's only job, and eighty excellent sans families
 * with no serif among them would fail it.
 *
 * One thing no test here can check is that the rows are Cambium's own rather than copied from
 * Google's `tags/all/families.csv`. That file is not in the repo and fetching it inside a test
 * would break the offline rule ADR-0001 rests on. Two things stand in for the test: the ten-point
 * score grid, coarse enough that recall would show up as suspiciously exact agreement with
 * upstream, and a human spot-check recorded in the pull request.
 */
describe('the in-repo fallback font table', () => {
	it.each(pairs)('offers three families or more for %s / %s', (category, tone) => {
		const { families } = resolveCandidatePool(FALLBACK_FONT_TABLE, category, tone);

		expect(distinct(families)).toBeGreaterThanOrEqual(3);
	});

	// Called out on its own because monospace is the category most likely to be curated last and
	// noticed never: it has no tone tags upstream, so all three of its pairs resolve through the
	// same category fallback and fail or pass together.
	it('offers three families or more for monospace', () => {
		const { families } = resolveCandidatePool(FALLBACK_FONT_TABLE, 'mono', 'humanist');

		expect(distinct(families)).toBeGreaterThanOrEqual(3);
	});

	// #42 ranks on the seed's expressive axes, so a family tagged on tone alone parses fine and then
	// never places. Three is the floor because a seed ranks its axes and a consumer reads the top of
	// that list: a family tagged on one axis only answers the seeds that happen to lead with it.
	it('tags every family on both quality axes and three expressive axes or more', () => {
		expect(tagsByFamily.size).toBeGreaterThan(0);

		const underTagged = [...tagsByFamily]
			.filter(([, tags]) => {
				const expressive = [...tags].filter((tag) => tag.startsWith('/Expressive/'));

				return (
					!tags.has('/Quality/Spacing') || !tags.has('/Quality/Wordspace') || expressive.length < 3
				);
			})
			.map(([family]) => family);

		expect(underTagged).toEqual([]);
	});

	// Two rows for one family and tag are two opinions about the same thing, and the table has no
	// rule for which wins.
	it('holds one row per family and tag', () => {
		const seen = new Set<string>();
		const duplicates: string[] = [];

		for (const row of FALLBACK_FONT_TABLE) {
			const key = `${row.family} ${row.tag}`;

			if (seen.has(key)) {
				duplicates.push(key);
			}

			seen.add(key);
		}

		expect(duplicates).toEqual([]);
	});

	// A family tagged across two category namespaces would be returned by both categories'
	// fallbacks, which lets one face satisfy a coverage floor it was never curated for. It also
	// means two authoring agents each hold a row for it and neither knows.
	it('files every family under one category', () => {
		const crossFiled = [...tagsByFamily]
			.filter(([, tags]) => {
				const filed = new Set([...tags].map((tag) => categoryOfTag.get(tag)).filter(Boolean));

				return filed.size !== 1;
			})
			.map(([family]) => family);

		expect(crossFiled).toEqual([]);
	});

	// The `Score` union already enforces the grid at build time. This asserts it about the shipped
	// data instead, which is what #42 reads and what a hand-edited row could drift from.
	it('scores every row on the ten-point grid', () => {
		const offGrid = FALLBACK_FONT_TABLE.filter(
			(row) => row.score % 10 !== 0 || row.score < 40 || row.score > 100,
		);

		expect(offGrid).toEqual([]);
	});

	// A record that fell back has to say so, because it ranked the same seed differently from one
	// that fetched the full taxonomy. The literal is load-bearing: fixtures across the core tests
	// already spell it this way.
	it('carries the identity a version records', () => {
		expect(FontTableRefSchema.safeParse(FALLBACK_FONT_TABLE_REF).success).toBe(true);
		expect(FALLBACK_FONT_TABLE_REF).toEqual({ source: 'in-repo', version: 'cambium-curated-1' });
	});

	// Level 9 to match lib/bundle-size.ts, so this figure and the budget's are comparable. This
	// measures the rows rather than the built chunk, which is what makes it useful before #42
	// imports the table and gives `pnpm test:bundle` something to weigh.
	it('gzips under the ceiling its chunk has to live within', () => {
		const bytes = gzipSync(JSON.stringify(FALLBACK_FONT_TABLE), { level: 9 }).byteLength;

		expect(bytes).toBeLessThanOrEqual(GZIPPED_CEILING_BYTES);
	});
});
