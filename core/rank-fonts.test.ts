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

/**
 * A second table for the cut-variant rule #61 added. Separate from the one above so the families
 * that exercise it cannot shift any other expectation: `Fixed Code` and `Fixed Mono` are one
 * drawing cut twice, and `Slim Mono` is the unrelated face the role should still reach.
 */
const cutTable: FontTable = [
	{ family: 'Fixed Code', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Fixed Code', tag: '/Quality/Spacing', score: 100 },
	{ family: 'Fixed Code', tag: '/Quality/Wordspace', score: 100 },

	{ family: 'Fixed Mono', tag: '/Monospace/Monospace', score: 90 },
	{ family: 'Fixed Mono', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Fixed Mono', tag: '/Quality/Wordspace', score: 60 },

	{ family: 'Slim Mono', tag: '/Monospace/Monospace', score: 80 },
	{ family: 'Slim Mono', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Slim Mono', tag: '/Quality/Wordspace', score: 80 },
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
function named(family: string, role: keyof SuggestedPairing = 'display'): SuggestedPairing {
	// Marked `derived` with a score on purpose: that is how the model writes the field, and the
	// ranker is supposed to re-stamp it rather than trust it.
	const candidate: FontCandidate = {
		provenance: 'derived',
		family,
		score: 92,
		rationale: 'The model said so.',
	};

	return {
		display: role === 'display' ? [candidate] : [],
		body: role === 'body' ? [candidate] : [],
		mono: role === 'mono' ? [candidate] : [],
	};
}

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

		// `Geo Sans Thai` leads both, on different grounds: the calm seed reads its /Expressive/Calm
		// 100, and body reads its 100/100 quality pair. `Crack Sans` places second on personality and
		// is absent from body, which is the themed exclusion.
		expect(familiesOf(display)).toEqual(['Geo Sans Thai', 'Crack Sans', 'Round Sans']);
		expect(familiesOf(body)).toEqual(['Geo Sans Thai', 'Round Sans', 'Loud Sans']);
	});

	// A face tagged Distressed is a display answer that has no business under running text.
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
		// Display's mode over body's exclusion: ranked on personality, with themed `Crack Sans` gone.
		expect(familiesOf(display)).toEqual(['Geo Sans Thai', 'Round Sans', 'Loud Sans']);
	});

	// Which member of the group wins is the ranking's business; that only one of them takes a slot
	// is #42's requirement. Asserting the count rather than a name is what keeps this test about the
	// requirement.
	it('keeps a family to one slot per role however many script variants it has', () => {
		const { display, body, mono } = pairingOf(seedWith({}));
		const geoSans = (candidates: FontCandidate[]) =>
			familiesOf(candidates).filter((family) => family.startsWith('Geo Sans'));

		expect(geoSans(display)).toHaveLength(1);
		expect(geoSans(body)).toHaveLength(1);
		expect(geoSans(mono)).toHaveLength(0);
	});

	// One family cannot take two of a role's slots under two script names, per #42, and #61 says the
	// same of one drawing cut twice. `Fixed Code` is `Fixed Mono` with a typographic feature switched
	// on, so the role answers with it and the unrelated `Slim Mono`.
	it('keeps a cut variant pair to one slot in a role', () => {
		const result = rankFonts(cutTable, seedWith({ category: 'mono' }));

		expect(familiesOf(result.pairing!.mono)).toEqual(['Fixed Code', 'Slim Mono']);
	});

	// The bug this pins: the group used to inherit the bare base's score and place in the order, so
	// `Geo Sans` at 40/40 replaced `Geo Sans Thai` at 100/100 and sank to the bottom of body.
	it('ranks a variant group where its strongest member ranked', () => {
		const { body } = pairingOf(seedWith({}));

		expect(body[0]).toMatchObject({ family: 'Geo Sans Thai', score: 100 });
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

		expect(familiesOf(display)).toEqual(['Geo Sans Thai', 'Crack Sans', 'Round Sans']);
		expect(familiesOf(body)).toEqual(['Geo Sans Thai', 'Round Sans', 'Loud Sans']);
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

		// The theme filter is a hard constraint, so seating a face rather than ranking it does not get
		// round it. `Crack Sans` carries /Theme/Distressed and cannot set a paragraph however it got
		// into the list.
		it('drops a themed face the model named for body', () => {
			const { body } = pairingOf(seedWith({}, { suggestedPairing: named('Crack Sans', 'body') }), {
				mode: 'model-led',
			});

			expect(familiesOf(body)).not.toContain('Crack Sans');
			expect(body.every((candidate) => candidate.provenance === 'derived')).toBe(true);
		});

		it('drops a themed named face from the shared list when one face does both jobs', () => {
			const { display, body } = pairingOf(
				seedWith({ displayDiffersFromBody: false }, { suggestedPairing: named('Crack Sans') }),
				{ mode: 'model-led' },
			);

			expect(familiesOf(display)).not.toContain('Crack Sans');
			expect(body).toEqual(display);
		});

		// Scoped to the roles that exclude themed faces, and no wider: a display face is exactly
		// where a Distressed cut belongs.
		it('keeps a themed face the model named for display', () => {
			const { display } = pairingOf(seedWith({}, { suggestedPairing: named('Crack Sans') }), {
				mode: 'model-led',
			});

			expect(display[0]).toMatchObject({ provenance: 'invented', family: 'Crack Sans' });
		});

		// The bypass the exact-name lookup left open: `Crack Sans Thai` has no row of its own, so the
		// theme check found nothing while the dedupe below still read it as `Crack Sans`.
		it('drops a themed face the model named under a script-variant spelling', () => {
			const { body } = pairingOf(
				seedWith({}, { suggestedPairing: named('Crack Sans Thai', 'body') }),
				{ mode: 'model-led' },
			);

			expect(familiesOf(body)).not.toContain('Crack Sans Thai');
			expect(body.every((candidate) => candidate.provenance === 'derived')).toBe(true);
		});

		// A family the table never heard of has no tags to read, so nothing can call it themed. That
		// is the ordinary case for a face the model invented rather than picked.
		it('keeps a named face absent from the table even on a role that drops themed faces', () => {
			const { body } = pairingOf(
				seedWith({}, { suggestedPairing: named('Invented Face', 'body') }),
				{ mode: 'model-led' },
			);

			expect(body[0]).toMatchObject({ provenance: 'invented', family: 'Invented Face' });
		});

		// The model's pick and another cut of the same drawing are one answer, the same way its pick
		// and a script variant of it are. The derived `Fixed Code` gives up its slot rather than
		// handing the role the same face twice.
		it('drops a derived cut variant of the face the model named', () => {
			const result = rankFonts(
				cutTable,
				seedWith({ category: 'mono' }, { suggestedPairing: named('Fixed Mono', 'mono') }),
				{ mode: 'model-led' },
			);

			expect(familiesOf(result.pairing!.mono)).toEqual(['Fixed Mono', 'Slim Mono']);
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

			expect(display[0]!.rationale).toContain('Scores 90 on /Sans/Geometric');
		});

		// Two routes reach the category pool and the rationale has to tell them apart. There is no
		// grotesque serif in the taxonomy at all, so claiming a match was attempted would be false.
		it('says the taxonomy has no such tone when the pair carries no tag', () => {
			const { display } = pairingOf(seedWith({ category: 'serif', tone: 'grotesque' }));

			expect(familiesOf(display)).toEqual(['Sharp Serif', 'Old Serif']);
			expect(display[0]!.rationale).toContain('the taxonomy has no grotesque serif');
		});

		// The other route: humanist sans is a real pair with real tags, and this table carries no
		// family on either of them.
		it('says the tone found no family when the pair is tagged but unmatched', () => {
			const { display } = pairingOf(seedWith({ tone: 'humanist' }));

			expect(display[0]!.rationale).toContain('no family here carries the humanist tags');
			expect(display[0]!.rationale).toContain('the whole sans category answered');
		});

		// A seed that weighted no axes and a pool that carries none of the ones it did weight both
		// score zero everywhere, and they used to share a sentence only ever true of the second.
		// `null` and `[]` are both real shapes: `expressive` is a required-but-nullable key, and a
		// partial seed says so by leaving it null. Note this needs a seed that classifies its type
		// and names no axes, not the wholly unclassified seed above, which never gets this far.
		// `[{ axis: 'Calm', score: 0 }]` is the third shape and the one that reads like a signal until
		// you total it: the schema allows a zero score, and a seed that weights every axis at zero has
		// named nothing to rank on. `Geo Sans` carries /Expressive/Calm at 80, so the no-coverage
		// sentence would be flatly false about this pool.
		it.each([
			['null', null],
			['an empty array', []],
			['every axis weighted zero', [{ axis: 'Calm' as const, score: 0 }]],
		])('says the seed weighted nothing when expressive is %s', (_label, expressive) => {
			const { display } = pairingOf(seedWith({}, { expressive }));

			for (const candidate of display) {
				expect(candidate.rationale).toContain(
					'The seed gives no expressive characteristic any weight',
				);
				expect(candidate.rationale).not.toContain('the expressive axes the seed asked for');
			}
		});

		// The other side of the same split, kept distinct: this seed did name an axis, and the slab
		// pool carries no expressive row at all.
		it('still says the pool carries nothing when the seed did name axes', () => {
			const { display } = pairingOf(seedWith({ category: 'slab', tone: 'grotesque' }));

			expect(display[0]!.rationale).toContain(
				'Nothing in this pool carries the expressive axes the seed asked for',
			);
			expect(display[0]!.rationale).not.toContain('gives no expressive characteristic any weight');
		});

		// Monospace has no tone subdivision whatever the seed's tone, so every mono candidate takes
		// the no-tag route rather than reporting a match that failed.
		it('never tells a mono candidate its tone matched nothing', () => {
			const { mono } = pairingOf(seedWith({ category: 'mono' }));

			for (const candidate of mono) {
				expect(candidate.rationale).not.toContain('no family here carries');
				expect(candidate.rationale).toContain('the taxonomy has no');
			}
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

	// A seed that classified its type and weighted no axes still has to come back with ranked faces,
	// ordered by the quality axes rather than left in the table's own order. Not the colours-only
	// seed, which carries no type classification and is refused before any of this runs.
	it.each([
		['null', null],
		['an empty array', []],
		['every axis weighted zero', [{ axis: 'Calm' as const, score: 0 }]],
	])('ranks on the quality axes when expressive is %s', (_label, expressive) => {
		const { display, body } = pairingOf(seedWith({}, { expressive }));

		expect(familiesOf(display)).toEqual(['Geo Sans Thai', 'Crack Sans', 'Round Sans']);
		expect(familiesOf(body)).toEqual(['Geo Sans Thai', 'Round Sans', 'Loud Sans']);
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
