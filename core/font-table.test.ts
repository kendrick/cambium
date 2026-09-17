import { describe, expect, it } from 'vitest';

import { TypeClassificationSchema } from './brand-seed';
import { type FontTable, resolveCandidatePool } from './font-table';

/**
 * Hand-built rather than drawn from the fallback table, so these expectations describe
 * `resolveCandidatePool` and survive whatever the curated table holds this week.
 *
 * Every family carries a second row, because the function has to return each one once however
 * many of its tags match. Scores go unused here: ranking is #42's job.
 */
const table: FontTable = [
	{ family: 'Geo Sans', tag: '/Sans/Geometric', score: 100 },
	{ family: 'Geo Sans', tag: '/Sans/Superellipse', score: 60 },
	{ family: 'Warm Sans', tag: '/Sans/Humanist', score: 100 },
	{ family: 'Warm Sans', tag: '/Sans/Rounded', score: 40 },
	{ family: 'Plain Sans', tag: '/Sans/Neo Grotesque', score: 100 },
	{ family: 'Plain Sans', tag: '/Sans/Grotesque', score: 80 },
	{ family: 'Carved Sans', tag: '/Sans/Glyphic', score: 100 },
	{ family: 'Old Serif', tag: '/Serif/Old Style Garalde', score: 100 },
	{ family: 'Old Serif', tag: '/Serif/Humanist Venetian', score: 80 },
	{ family: 'Sharp Serif', tag: '/Serif/Didone', score: 100 },
	{ family: 'Geo Slab', tag: '/Slab/Geometric', score: 100 },
	{ family: 'Warm Slab', tag: '/Slab/Humanist', score: 100 },
	{ family: 'Bracket Slab', tag: '/Slab/Clarendon', score: 100 },
	{ family: 'Fixed Mono', tag: '/Monospace/Monospace', score: 100 },
];

type Pair = [
	category: 'serif' | 'sans' | 'slab' | 'mono',
	tone: 'geometric' | 'humanist' | 'grotesque',
	matched: 'tone' | 'category',
	families: string[],
];

/**
 * All twelve pairs, spelled out rather than generated, because the point is what each one
 * resolves to. The six that fall back are the six the taxonomy has no tag for, and they are the
 * reason `resolveCandidatePool` has a fallback at all.
 */
const pairs: Pair[] = [
	['sans', 'geometric', 'tone', ['Geo Sans']],
	['sans', 'humanist', 'tone', ['Warm Sans']],
	['sans', 'grotesque', 'tone', ['Plain Sans']],
	['serif', 'geometric', 'category', ['Old Serif', 'Sharp Serif']],
	['serif', 'humanist', 'tone', ['Old Serif']],
	['serif', 'grotesque', 'category', ['Old Serif', 'Sharp Serif']],
	['slab', 'geometric', 'tone', ['Geo Slab']],
	['slab', 'humanist', 'tone', ['Warm Slab']],
	['slab', 'grotesque', 'category', ['Geo Slab', 'Warm Slab', 'Bracket Slab']],
	['mono', 'geometric', 'category', ['Fixed Mono']],
	['mono', 'humanist', 'category', ['Fixed Mono']],
	['mono', 'grotesque', 'category', ['Fixed Mono']],
];

describe('resolveCandidatePool', () => {
	it.each(pairs)('resolves %s / %s through the %s tags', (category, tone, matched, families) => {
		expect(resolveCandidatePool(table, category, tone)).toEqual({ families, matched });
	});

	// The seed decides what a pair can be. Widening either enum without widening TONE_TAGS would
	// leave a pair with no branch to take, and the it.each above would still pass on the old twelve.
	it('covers every pair the seed can express', () => {
		const categories = TypeClassificationSchema.shape.category.options;
		const tones = TypeClassificationSchema.shape.tone.options;

		expect(pairs.length).toBe(categories.length * tones.length);
		expect(new Set(pairs.map(([category, tone]) => `${category}/${tone}`))).toEqual(
			new Set(categories.flatMap((category) => tones.map((tone) => `${category}/${tone}`))),
		);
	});

	// A family earns one place in the pool, not one per matching tag. #42 ranks the pool, and a
	// family listed twice would take two of the three slots a role gets.
	it('returns each family once however many of its tags match', () => {
		const { families } = resolveCandidatePool(table, 'sans', 'geometric');

		expect(families).toEqual(['Geo Sans']);
		expect(new Set(families).size).toBe(families.length);
	});

	// The keyless demo runs with no network, so an empty table is a real state rather than a
	// defensive case. It has to come back empty instead of throwing.
	it('comes back empty over an empty table', () => {
		expect(resolveCandidatePool([], 'sans', 'geometric')).toEqual({
			families: [],
			matched: 'category',
		});
	});
});
