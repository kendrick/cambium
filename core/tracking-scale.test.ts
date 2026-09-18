import { describe, expect, it } from 'vitest';

import { CAMBIUM_NAMESPACE } from './provenance';
import { trackingScale } from './tracking-scale';

const STEPS = ['tighter', 'tight', 'normal', 'wide', 'wider'] as const;

/** Tailwind's own tracking values, which a `normal` feel reproduces exactly. */
const CONTRACT_EM = [-0.05, -0.025, 0, 0.025, 0.05];

/** How far a `tight` or `wide` feel moves the whole scale. Half a step, so the steps stay recognisable. */
const FEEL_SHIFT = 0.0125;

function valuesOf(feel: Parameters<typeof trackingScale>[0]) {
	const { values } = trackingScale(feel);

	return STEPS.map((step) => values[step]!.value);
}

describe('trackingScale', () => {
	/**
	 * `em` rather than `rem`, because letter-spacing has to scale with the size it applies to. DTCG's
	 * `dimension` type accepts px and rem only, so the DTCG adapter has a conversion to make here
	 * rather than a value to copy. Issue #7 records that for the adapter ticket.
	 */
	it('emits five steps in em', () => {
		const { source, values } = trackingScale('normal');

		expect(Object.keys(values)).toEqual([...STEPS]);
		expect(source).toBe('derived');
		expect(STEPS.every((step) => values[step]!.unit === 'em')).toBe(true);
	});

	it('reproduces the vendored tracking values under a normal feel', () => {
		valuesOf('normal').forEach((value, i) => {
			expect(value).toBeCloseTo(CONTRACT_EM[i]!, 10);
		});
	});

	it('falls back to a normal feel when the seed measured none', () => {
		expect(valuesOf(null)).toEqual(valuesOf('normal'));
	});

	/**
	 * The feel moves the anchor and leaves the step spacing alone. Respacing the steps instead would
	 * make `tighter` under a wide feel collide with `normal` under a tight one, and the five names
	 * would stop meaning the same distance apart in every theme.
	 */
	it.each([
		['tight', -FEEL_SHIFT],
		['wide', FEEL_SHIFT],
	] as const)('shifts the whole scale by %s without respacing it', (feel, shift) => {
		valuesOf(feel).forEach((value, i) => {
			expect(value).toBeCloseTo(CONTRACT_EM[i]! + shift, 10);
		});
	});

	it.each(['tight', 'normal', 'wide'] as const)('keeps the steps in order under %s', (feel) => {
		const values = valuesOf(feel);

		expect(values.every((value, i) => i === 0 || value > values[i - 1]!)).toBe(true);
	});

	it('produces the same scale from the same feel', () => {
		expect(trackingScale('wide')).toEqual(trackingScale('wide'));
	});

	/**
	 * `feel` is the module's only argument, so seeing whether it was stated costs nothing extra.
	 * `source` on the category stays `derived` regardless, so the split lives on each step's own
	 * payload rather than on the discriminator a category-level read would reach for.
	 */
	it.each(['tight', 'normal', 'wide'] as const)(
		'tags every step derived on trackingFeel when the seed stated %s',
		(feel) => {
			const { values } = trackingScale(feel);

			STEPS.forEach((step) => {
				expect(values[step]!.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
					provenance: 'derived',
					seedField: 'trackingFeel',
				});
			});
		},
	);

	it('tags every step invented with a null seed field when the seed measured no feel', () => {
		const { values } = trackingScale(null);

		STEPS.forEach((step) => {
			expect(values[step]!.$extensions[CAMBIUM_NAMESPACE]).toMatchObject({
				provenance: 'invented',
				seedField: null,
			});
		});
	});
});
