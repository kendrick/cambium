import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { BrandSeedSchema } from './brand-seed';
import { TokenSetSchema } from './token-set';

const ramp = Array.from({ length: 12 }, (_, i) => ({
	step: i + 1,
	l: 0.05 + i * 0.08,
	c: 0.05,
	h: 259.8,
}));
const layer = { primitives: { brand: ramp }, semantic: { border: 'brand.6' } };
const tokenSet = { ...layer, schemes: { light: layer, dark: layer } };

const seed = {
	keyColors: [
		{
			oklch: [0.62, 0.19, 259.8],
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
};

const record = {
	id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
	schemaVersion: SCHEMA_VERSION,
	images: [{ id: 'img-1', downscaled: 'data:image/webp;base64,AA', originalHash: 'sha256:abc' }],
	versions: [
		{
			createdAt: '2026-09-16T12:00:00.000Z',
			seed,
			tokenSet,
			provider: 'anthropic',
			model: 'claude-opus-5',
			promptVersion: 'seed-v3',
			scaleEngine: 'cambium-oklch-1',
			fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
			interpretation: 'balanced',
		},
	],
};

/**
 * Zod strips unknown keys by default, which is the wrong failure for a persisted shape. The
 * categories #7 derives and the `$extensions` payload #9 attaches both need slots this schema
 * does not have yet, and stripping would lose them on the way to disk without a word. These
 * schemas reject instead, so the ticket that adds them gets an error naming the file to widen.
 */
describe('schema strictness', () => {
	it('rejects a non-colour token category rather than dropping it on the way to disk', () => {
		const withRadius = { ...tokenSet, radius: { sm: '4px', md: '8px' } };

		const result = TokenSetSchema.safeParse(withRadius);

		expect(result.success).toBe(false);
	});

	it('rejects provenance attached to a ramp step rather than discarding the evidence', () => {
		const annotated = [
			{ ...ramp[0]!, provenance: 'derived', rationale: 'traces to the brand key colour' },
			...ramp.slice(1),
		];

		const result = TokenSetSchema.safeParse({
			...tokenSet,
			primitives: { brand: annotated },
			schemes: { light: { ...layer, primitives: { brand: annotated } }, dark: layer },
		});

		expect(result.success).toBe(false);
	});

	it.each([
		['BrandSeedSchema', BrandSeedSchema, seed],
		['BrandRecordSchema', BrandRecordSchema, record],
	])('%s rejects a key it does not declare', (_name, schema, value) => {
		expect(schema.safeParse({ ...value, somethingNew: true }).success).toBe(false);
	});

	it('still accepts every shape it does declare', () => {
		expect(BrandSeedSchema.safeParse(seed).success).toBe(true);
		expect(TokenSetSchema.safeParse(tokenSet).success).toBe(true);
		expect(BrandRecordSchema.safeParse(record).success).toBe(true);
	});
});
