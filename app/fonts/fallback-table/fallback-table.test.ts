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
 * The pairs `resolveCandidatePool` can only answer from the category pool, because the taxonomy
 * carries no tag for them: no geometric or grotesque serif, no grotesque slab, and no tones at all
 * under monospace.
 *
 * Asserting which tier answered is what makes the count assertion mean something. `slab / humanist`
 * sits at exactly three families, so retagging one of them would drop the pair into a category pool
 * of ten, and a test that counts alone would stay green while the tone quietly stopped being
 * covered.
 */
const CATEGORY_FALLBACK_PAIRS = new Set([
	'serif/geometric',
	'serif/grotesque',
	'slab/grotesque',
	'mono/geometric',
	'mono/humanist',
	'mono/grotesque',
]);

/**
 * Measured against the shipped rows: `gzipSync(JSON.stringify(FALLBACK_FONT_TABLE), { level: 9 })`
 * comes to 2,562 bytes for the 58 families and 435 rows curated so far.
 *
 * The ceiling is 5,000 bytes, roughly double that figure. The headroom covers the families a
 * later pass adds and the ordinary tag and score corrections curation makes. It would not cover
 * growth toward the scale of the upstream taxonomy, which is out of scope for this table.
 *
 * `lib/bundle-budget.ts` leaves roughly 24 kB of headroom under the 200 kB first-load budget, and
 * this table's chunk is the largest single claim on it. `font-table-provider.ts` now imports
 * `load-fallback-table.ts` on every fetch failure, so that import is real code rather than an
 * orphan accessor, but `pnpm test:bundle` still cannot defend the headroom: no route imports the
 * provider, so Next emits no chunk for the table and a real build never touches these rows. The
 * assertion below is what holds the line.
 */
const GZIPPED_CEILING_BYTES = 5_000;

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

	it.each(pairs)('answers %s / %s from the tier that has tags for it', (category, tone) => {
		const { matched } = resolveCandidatePool(FALLBACK_FONT_TABLE, category, tone);

		expect(matched).toBe(CATEGORY_FALLBACK_PAIRS.has(`${category}/${tone}`) ? 'category' : 'tone');
	});

	// Four is the floor across the whole table rather than one per category file, because #42's
	// filter reads the tag and never asks which file a row came from. The table carries exactly
	// four, so this has no slack: removing any themed row fails here, which is the point. Curation
	// that drops one owes the table a replacement.
	it('carries four themed families or more', () => {
		const themed = [...tagsByFamily]
			.filter(([, tags]) => [...tags].some((tag) => tag.startsWith('/Theme/')))
			.map(([family]) => family);

		expect(themed.length).toBeGreaterThanOrEqual(4);
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
