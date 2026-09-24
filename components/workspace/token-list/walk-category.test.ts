import { describe, expect, it } from 'vitest';

import { BALANCED } from '../../../core/interpretation';
import { createOklchScaleEngine } from '../../../core/oklch-scale-engine';
import { buildTokenSet } from '../../../core/semantic-layer';
import { BrandSeedSchema } from '../../../core/brand-seed';
import { walkCategoryTokens } from './walk-category';

/**
 * A real engine-built `TokenSet` rather than a hand-shaped fixture, for the reason
 * `core/semantic-layer.test.ts`'s own `fixtureFor` gives: the seam this walker sits on is the
 * shape `buildTokenSet` actually produces, and a hand-written stand-in would let a shape the real
 * pipeline never emits pass here and a real one fail silently.
 */
function fixtureTokenSet() {
	const seed = BrandSeedSchema.parse({
		keyColors: [
			{
				oklch: [0.6, 0.15, 250],
				proposedRole: 'brand',
				sourceImageId: 'img-1',
				sourceRegion: null,
			},
		],
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
	});

	const result = createOklchScaleEngine().generate(seed, BALANCED);

	if (!result.ok)
		throw new Error(`the scale engine rejected the fixture seed: ${result.error.kind}`);

	return buildTokenSet(result.schemes, seed, BALANCED);
}

describe('walkCategoryTokens', () => {
	it('finds a bare dimension leaf at the path the override contract names', () => {
		const tokenSet = fixtureTokenSet();
		const tokens = walkCategoryTokens(tokenSet.radius.values);
		const lg = tokens.find((token) => token.path.join('.') === 'lg');

		expect(lg).toBeDefined();
		expect(lg?.leaves).toEqual([{ suffix: ['value'], value: expect.any(Number), unit: 'rem' }]);
	});

	it('finds a nested scalar leaf two levels under `values`, as the contract names it', () => {
		const tokenSet = fixtureTokenSet();
		const tokens = walkCategoryTokens(tokenSet.typography.values);
		const regularWeight = tokens.find((token) => token.path.join('.') === 'weight.regular');

		expect(regularWeight).toBeDefined();
		expect(regularWeight?.leaves).toEqual([
			{ suffix: ['value'], value: expect.any(Number), unit: undefined },
		]);
	});

	it("finds every slot of a cubic bezier's tuple, indexed the way the override contract names them", () => {
		const tokenSet = fixtureTokenSet();
		const tokens = walkCategoryTokens(tokenSet.motion.values.easing);
		const standard = tokens.find((token) => token.path.join('.') === 'standard');

		expect(standard).toBeDefined();
		expect(standard?.leaves).toEqual([
			{ suffix: ['value', 0], value: expect.any(Number), unit: undefined },
			{ suffix: ['value', 1], value: expect.any(Number), unit: undefined },
			{ suffix: ['value', 2], value: expect.any(Number), unit: undefined },
			{ suffix: ['value', 3], value: expect.any(Number), unit: undefined },
		]);
	});

	it("finds a shadow's geometry and colour leaves under the one `$extensions` the whole token shares", () => {
		const tokenSet = fixtureTokenSet();
		const tokens = walkCategoryTokens(tokenSet.schemes.light.shadow.values);
		const md = tokens.find((token) => token.path.join('.') === 'md');

		expect(md).toBeDefined();
		// One `$extensions` per shadow, not one per leaf. `ShadowSchema` carries a single provenance
		// for the whole token, so the walker has to attribute every leaf below to that one object.
		expect(md?.extensions).toBe(
			(tokenSet.schemes.light.shadow.values as Record<string, { $extensions: unknown }>).md
				.$extensions,
		);

		const suffixes = new Set(md?.leaves.map((leaf) => leaf.suffix.join('.')));
		expect(suffixes).toEqual(
			new Set([
				'color.l',
				'color.c',
				'color.h',
				'color.alpha',
				'offsetX.value',
				'offsetY.value',
				'blur.value',
				'spread.value',
			]),
		);

		// Only the dimension-shaped leaves carry a unit; a shadow's colour channels are dimensionless.
		const offsetY = md?.leaves.find((leaf) => leaf.suffix.join('.') === 'offsetY.value');
		const colorL = md?.leaves.find((leaf) => leaf.suffix.join('.') === 'color.l');
		expect(offsetY?.unit).toBe('px');
		expect(colorL?.unit).toBeUndefined();
	});

	it('produces at least one token for every non-colour category the contract lists', () => {
		const tokenSet = fixtureTokenSet();
		const categories = [
			['radius', tokenSet.radius.values],
			['typography', tokenSet.typography.values],
			['tracking', tokenSet.tracking.values],
			['spacing', tokenSet.spacing.values],
			['opacity', tokenSet.opacity.values],
			['motion', tokenSet.motion.values],
			['focusRing', tokenSet.focusRing.values],
			['zIndex', tokenSet.zIndex.values],
			['shadow', tokenSet.schemes.light.shadow.values],
		] as const;

		for (const [name, values] of categories) {
			const tokens = walkCategoryTokens(values);
			expect(tokens.length, `${name} produced no tokens`).toBeGreaterThan(0);

			// Every leaf found has to actually be the numeric value living at that path, or a caller
			// building an override from it would send a value that doesn't match what's on screen.
			for (const token of tokens) {
				for (const leaf of token.leaves) {
					const full = [...token.path, ...leaf.suffix];
					let node: unknown = values;
					for (const segment of full) node = (node as Record<string | number, unknown>)[segment];
					expect(node, `${name}.${full.join('.')}`).toBe(leaf.value);
				}
			}
		}
	});
});
