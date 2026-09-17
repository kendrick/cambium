import { describe, expect, it } from 'vitest';

import {
	type BrandSeed,
	type ExpressiveScore,
	type FontCandidate,
	type SuggestedPairing,
	SuggestedPairingSchema,
	type TypeClassification,
} from './brand-seed';
import type { FontTable } from './font-table';
import { rankFonts } from './rank-fonts';

/**
 * Hand-built from invented families, the way `core/font-table.test.ts` builds its own, so these
 * expectations describe `rankFonts` rather than whatever the curated table holds this week.
 *
 * The shape of each family is what makes a case: `Geo Sans Thai` is a script variant that outranks
 * its own base, `Crack Sans` is the themed face body has to drop, `Loud Sans` is the one that only
 * a differently-tuned seed reaches, and the slabs carry no expressive rows at all.
 */
const table: FontTable = [
	{ family: 'Geo Sans', tag: '/Sans/Geometric', score: 100 },
	{ family: 'Geo Sans', tag: '/Quality/Spacing', score: 40 },
	{ family: 'Geo Sans', tag: '/Quality/Wordspace', score: 40 },
	{ family: 'Geo Sans', tag: '/Expressive/Calm', score: 80 },
	{ family: 'Geo Sans', tag: '/Expressive/Competent', score: 40 },

	{ family: 'Geo Sans Thai', tag: '/Sans/Geometric', score: 90 },
	{ family: 'Geo Sans Thai', tag: '/Quality/Spacing', score: 100 },
	{ family: 'Geo Sans Thai', tag: '/Quality/Wordspace', score: 100 },
	{ family: 'Geo Sans Thai', tag: '/Expressive/Calm', score: 100 },

	{ family: 'Round Sans', tag: '/Sans/Superellipse', score: 80 },
	{ family: 'Round Sans', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Round Sans', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Round Sans', tag: '/Expressive/Calm', score: 40 },
	{ family: 'Round Sans', tag: '/Expressive/Competent', score: 100 },

	{ family: 'Loud Sans', tag: '/Sans/Geometric', score: 70 },
	{ family: 'Loud Sans', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Loud Sans', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Loud Sans', tag: '/Expressive/Loud', score: 100 },

	{ family: 'Crack Sans', tag: '/Sans/Geometric', score: 60 },
	{ family: 'Crack Sans', tag: '/Theme/Distressed', score: 100 },
	{ family: 'Crack Sans', tag: '/Quality/Spacing', score: 100 },
	{ family: 'Crack Sans', tag: '/Quality/Wordspace', score: 100 },
	{ family: 'Crack Sans', tag: '/Expressive/Calm', score: 90 },

	{ family: 'Old Serif', tag: '/Serif/Old Style Garalde', score: 100 },
	{ family: 'Old Serif', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Old Serif', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Old Serif', tag: '/Expressive/Calm', score: 70 },

	{ family: 'Sharp Serif', tag: '/Serif/Didone', score: 100 },
	{ family: 'Sharp Serif', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Sharp Serif', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Sharp Serif', tag: '/Expressive/Calm', score: 100 },

	{ family: 'Geo Slab', tag: '/Slab/Geometric', score: 100 },
	{ family: 'Geo Slab', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Geo Slab', tag: '/Quality/Wordspace', score: 90 },

	{ family: 'Warm Slab', tag: '/Slab/Humanist', score: 100 },
	{ family: 'Warm Slab', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Warm Slab', tag: '/Quality/Wordspace', score: 70 },

	{ family: 'Bracket Slab', tag: '/Slab/Clarendon', score: 100 },
	{ family: 'Bracket Slab', tag: '/Quality/Spacing', score: 50 },
	{ family: 'Bracket Slab', tag: '/Quality/Wordspace', score: 50 },

	{ family: 'Fixed Mono', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Fixed Mono', tag: '/Quality/Spacing', score: 100 },
	{ family: 'Fixed Mono', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Fixed Mono', tag: '/Expressive/Competent', score: 80 },

	{ family: 'Pixel Mono', tag: '/Monospace/Monospace', score: 90 },
	{ family: 'Pixel Mono', tag: '/Theme/Pixel', score: 100 },
	{ family: 'Pixel Mono', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Pixel Mono', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Pixel Mono', tag: '/Expressive/Calm', score: 100 },

	{ family: 'Slim Mono', tag: '/Monospace/Monospace', score: 80 },
	{ family: 'Slim Mono', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Slim Mono', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Slim Mono', tag: '/Expressive/Calm', score: 50 },
];

const CALM_SEED: ExpressiveScore[] = [
	{ axis: 'Calm', score: 90 },
	{ axis: 'Competent', score: 30 },
];

const LOUD_SEED: ExpressiveScore[] = [{ axis: 'Loud', score: 100 }];

const emptySeed: BrandSeed = {
	keyColors: null,
	neutralTemperature: null,
	surfacePolarity: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

function seedWith(
	classification: Partial<TypeClassification>,
	rest: Partial<BrandSeed> = {},
): BrandSeed {
	return {
		...emptySeed,
		typeClassification: {
			category: 'sans',
			tone: 'geometric',
			xHeight: 'medium',
			displayDiffersFromBody: true,
			...classification,
		},
		expressive: CALM_SEED,
		...rest,
	};
}

function pairingOf(seed: BrandSeed, mode?: Parameters<typeof rankFonts>[2]): SuggestedPairing {
	const result = rankFonts(table, seed, mode);

	expect(result.ok).toBe(true);
	expect(SuggestedPairingSchema.safeParse(result.pairing).success).toBe(true);

	return result.pairing!;
}

const familiesOf = (candidates: FontCandidate[]): string[] => candidates.map((c) => c.family);

/** A pairing carrying one model-named face, for the `model-led` mode to seat ahead of the ranking. */
const named = (family: string): SuggestedPairing => ({
	display: [{ provenance: 'derived', family, score: 92, rationale: 'The model said so.' }],
	body: [],
	mono: [],
});

describe('rankFonts', () => {
	it('refuses a seed with no type classification', () => {
		const result = rankFonts(table, emptySeed);

		expect(result.ok).toBe(false);
		expect(result.error).toEqual({ kind: 'no-type-classification' });
		expect(result.pairing).toBeUndefined();
	});

	// An empty table is a real answer, not a failure: the role has no candidate, which the seed
	// schema already distinguishes from the whole pairing being absent.
	it('ranks an empty table into three empty roles', () => {
		const result = rankFonts([], seedWith({}));

		expect(result.ok).toBe(true);
		expect(result.pairing).toEqual({ display: [], body: [], mono: [] });
	});

	it('ranks display on the seed personality and body on the quality axes', () => {
		const { display, body } = pairingOf(seedWith({}));

		expect(familiesOf(display)).toEqual(['Geo Sans', 'Crack Sans', 'Round Sans']);
		expect(familiesOf(body)).toEqual(['Round Sans', 'Loud Sans', 'Geo Sans']);
	});

	// The acceptance criteria and the planning doc both say this backwards. A face tagged
	// Distressed is a display answer that has no business under running text.
	it('drops themed families from body and keeps them in display', () => {
		const { display, body } = pairingOf(seedWith({}));

		expect(familiesOf(display)).toContain('Crack Sans');
		expect(familiesOf(body)).not.toContain('Crack Sans');
	});

	it('ranks mono from the mono pool whatever the seed category', () => {
		const { mono } = pairingOf(seedWith({ category: 'serif' }));

		expect(familiesOf(mono)).toEqual(['Fixed Mono', 'Slim Mono', 'Pixel Mono']);
	});

	it('gives display and body the same list when one face does both jobs', () => {
		const { display, body } = pairingOf(seedWith({ displayDiffersFromBody: false }));

		expect(body).toEqual(display);
		expect(familiesOf(display)).toEqual(['Geo Sans', 'Round Sans', 'Loud Sans']);
	});

	it('keeps a family to one slot per role however many script variants it has', () => {
		const { display, body } = pairingOf(seedWith({}));

		expect(familiesOf(display)).not.toContain('Geo Sans Thai');
		expect(familiesOf(body)).not.toContain('Geo Sans Thai');
	});

	it('returns at most three candidates, and fewer when the pool holds fewer', () => {
		const soloTable: FontTable = [
			{ family: 'Solo Mono', tag: '/Monospace/Monospace', score: 100 },
			{ family: 'Solo Mono', tag: '/Quality/Spacing', score: 80 },
		];
		const result = rankFonts(soloTable, seedWith({ category: 'mono' }));

		expect(result.pairing).toBeDefined();
		expect(familiesOf(result.pairing!.mono)).toEqual(['Solo Mono']);
		expect(familiesOf(result.pairing!.display)).toEqual(['Solo Mono']);
	});

	it('applies an explicit mode to every role', () => {
		const { display, body, mono } = pairingOf(seedWith({}), { mode: 'craft' });

		expect(familiesOf(display)).toEqual(['Crack Sans', 'Round Sans', 'Loud Sans']);
		expect(familiesOf(body)).toEqual(['Round Sans', 'Loud Sans', 'Geo Sans']);
		expect(familiesOf(mono)).toEqual(['Fixed Mono', 'Slim Mono', 'Pixel Mono']);
	});

	describe('model-led', () => {
		it('puts the model pairing first as an unscored invented candidate', () => {
			const { display } = pairingOf(seedWith({}, { suggestedPairing: named('Geo Sans Thai') }), {
				mode: 'model-led',
			});

			expect(display[0]).toMatchObject({
				provenance: 'invented',
				family: 'Geo Sans Thai',
				score: null,
			});
			// The model's pick and a script variant of it are one answer, so the derived `Geo Sans`
			// entry gives up its slot rather than doubling the family.
			expect(familiesOf(display)).toEqual(['Geo Sans Thai', 'Crack Sans', 'Round Sans']);
		});

		it('falls through to personality for a role the model named nothing for', () => {
			const withPairing = pairingOf(seedWith({}, { suggestedPairing: named('Geo Sans Thai') }), {
				mode: 'model-led',
			});
			const withoutPairing = pairingOf(seedWith({}), { mode: 'model-led' });

			expect(familiesOf(withPairing.mono)).toEqual(familiesOf(withoutPairing.mono));
			expect(withoutPairing.display.every((c) => c.provenance === 'derived')).toBe(true);
		});
	});

	describe('rationale', () => {
		it('names the tag and the score that placed a candidate', () => {
			const { display } = pairingOf(seedWith({}));

			expect(display[0]!.rationale).toContain('100 on /Sans/Geometric');
		});

		it('says so when the tone matched nothing and the category answered', () => {
			const { display } = pairingOf(seedWith({ category: 'serif', tone: 'grotesque' }));

			expect(familiesOf(display)).toEqual(['Sharp Serif', 'Old Serif']);
			expect(display[0]!.rationale).toContain('the whole serif category answered');
		});

		it('says so when personality fell back to the quality axes', () => {
			const { display } = pairingOf(seedWith({ category: 'slab', tone: 'grotesque' }));

			expect(display[0]!.rationale).toContain('/Quality/Spacing');
			expect(display[0]!.rationale).toMatch(/expressive/i);
		});
	});

	// The pool the slabs form carries no `/Expressive/*` row at all, which is the case the fallback
	// exists for: without it the whole pool ties at zero and the order is the table's, not a ranking.
	it('still ranks a pool with no expressive coverage', () => {
		const { display } = pairingOf(seedWith({ category: 'slab', tone: 'grotesque' }));

		expect(familiesOf(display)).toEqual(['Geo Slab', 'Warm Slab', 'Bracket Slab']);
	});

	it('produces identical lists for identical seeds over an identical table', () => {
		expect(pairingOf(seedWith({}))).toEqual(pairingOf(seedWith({})));
	});

	it('produces different lists for two seeds sharing a tone but not a personality', () => {
		const calm = pairingOf(seedWith({}));
		const loud = pairingOf(seedWith({}, { expressive: LOUD_SEED }));

		expect(familiesOf(loud.display)).toEqual(['Loud Sans', 'Geo Sans', 'Round Sans']);
		expect(familiesOf(loud.display)).not.toEqual(familiesOf(calm.display));
	});

	it('scores every derived candidate as an integer inside 0 to 100', () => {
		const { display, body, mono } = pairingOf(seedWith({}));

		for (const candidate of [...display, ...body, ...mono]) {
			if (candidate.provenance !== 'derived') continue;

			expect(Number.isInteger(candidate.score)).toBe(true);
			expect(candidate.score).toBeGreaterThanOrEqual(0);
			expect(candidate.score).toBeLessThanOrEqual(100);
		}
	});
});
