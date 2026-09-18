import { describe, expect, it } from 'vitest';

import { CAMBIUM_NAMESPACE } from './provenance';
import { radiusScale } from './radius-scale';

/**
 * The names and the anchor come from `app/globals.css`, which is the Tailwind v4 theme this repo
 * vendors. An adapter writing `--radius-xl` has to land on a name Tailwind already resolves, so the
 * step set is a contract rather than a preference.
 */
const STEPS = ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;

/** `--radius: 0.625rem` in `app/globals.css`, and the value a seed that measured nothing falls back to. */
const CONTRACT_ANCHOR = 0.625;

/** The multipliers `app/globals.css` declares against `--radius`, in step order. */
const CONTRACT_MULTIPLIERS = [0.6, 0.8, 1, 1.4, 1.8, 2.2, 2.6];

const soft = { base: 16, progression: 'soft' } as const;

function valuesOf(character: Parameters<typeof radiusScale>[0]) {
	const { values } = radiusScale(character);

	return STEPS.map((step) => values[step]!.value);
}

describe('radiusScale', () => {
	it('emits the seven steps the vendored theme declares, in rem', () => {
		const { source, values } = radiusScale(soft);

		expect(Object.keys(values)).toEqual([...STEPS]);
		expect(source).toBe('derived');
		expect(STEPS.every((step) => values[step]!.unit === 'rem')).toBe(true);
	});

	// The seed states a corner radius the way a model reads one off an image, which is in pixels.
	it('anchors lg on the seed base, converted from px to rem', () => {
		expect(radiusScale(soft).values.lg!.value).toBeCloseTo(1, 10);
	});

	/**
	 * `soft` is the progression that reproduces the contract exactly. Without this anchor the three
	 * multiplier tables are three sets of numbers nobody can check, and the one that has an external
	 * authority behind it is the one the repo already ships.
	 */
	it('reproduces the vendored radius scale under a soft progression at the contract anchor', () => {
		const values = valuesOf({ base: CONTRACT_ANCHOR * 16, progression: 'soft' });

		values.forEach((value, i) => {
			expect(value).toBeCloseTo(CONTRACT_ANCHOR * CONTRACT_MULTIPLIERS[i]!, 10);
		});
	});

	it('falls back to the contract anchor and a soft progression when the seed measured nothing', () => {
		expect(valuesOf(null)).toEqual(valuesOf({ base: CONTRACT_ANCHOR * 16, progression: 'soft' }));
	});

	it.each(['sharp', 'soft', 'pill'] as const)(
		'climbs without ever reversing under %s',
		(progression) => {
			const values = valuesOf({ base: 16, progression });

			expect(values.every((value, i) => i === 0 || value > values[i - 1]!)).toBe(true);
		},
	);

	/**
	 * The progression is the only knob that separates the three characters, so the whole claim it
	 * makes is that a sharper brand climbs more slowly. Comparing the top step is what falsifies a
	 * table someone edits into the wrong order.
	 */
	it('spreads the scale further as the character softens', () => {
		const top = (progression: 'sharp' | 'soft' | 'pill') =>
			valuesOf({ base: 16, progression })[STEPS.length - 1]!;

		expect(top('sharp')).toBeLessThan(top('soft'));
		expect(top('soft')).toBeLessThan(top('pill'));
	});

	// Every step is a multiple of the anchor, so a base of zero is a brand with square corners
	// rather than a division by zero or a scale that starts climbing from nowhere.
	it('gives a zero base a scale of zeroes rather than inventing one', () => {
		expect(valuesOf({ base: 0, progression: 'soft' })).toEqual(STEPS.map(() => 0));
	});

	/**
	 * A model reading a rounded card off a hero image can report a radius in the hundreds. Left
	 * unclamped that reaches an export as a 4xl step wider than most components, and the resulting
	 * theme looks broken rather than expressive.
	 */
	it('clamps a base no interface would use', () => {
		expect(radiusScale({ base: 400, progression: 'soft' }).values.lg!.value).toBeCloseTo(2, 10);
	});

	it('produces the same scale from the same character', () => {
		expect(radiusScale(soft)).toEqual(radiusScale({ base: 16, progression: 'soft' }));
	});

	/**
	 * `character` is the module's only argument, so whether it was stated is a fact this function
	 * can see without learning anything new. `source` stays `derived` either way — it says the
	 * category itself came from a category-level derivation, not whether this particular call had
	 * a stated field to work from — so the split has to be read off the per-step payload instead.
	 */
	it('tags every step derived on radiusCharacter when the seed stated one', () => {
		const { values } = radiusScale(soft);

		STEPS.forEach((step) => {
			expect(values[step]!.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
				provenance: 'derived',
				seedField: 'radiusCharacter',
			});
		});
	});

	it('tags every step invented with a null seed field when the seed measured no character', () => {
		const { values } = radiusScale(null);

		STEPS.forEach((step) => {
			expect(values[step]!.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
				provenance: 'invented',
				seedField: null,
			});
		});
	});
});
