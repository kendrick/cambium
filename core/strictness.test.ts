import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { BrandSeedSchema } from './brand-seed';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from './token-set.fixture';
import { TokenSetSchema } from './token-set';

const ramp = Array.from({ length: 12 }, (_, i) => ({
	step: i + 1,
	l: 0.05 + i * 0.08,
	c: 0.05,
	h: 259.8,
}));
const shadow = SHADOW_FIXTURE;

const layer = { primitives: { brand: ramp }, semantic: { border: 'brand.6' }, shadow };

const tokenSet = {
	...layer,
	schemes: { light: layer, dark: layer },
	...NON_COLOR_FIXTURE,
};

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
	expressive: null,
};

const record = {
	id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
	schemaVersion: SCHEMA_VERSION,
	images: [{ id: 'img-1', downscaled: 'data:image/webp;base64,AA', originalHash: 'sha256:abc' }],
	versions: [
		{
			createdAt: '2026-09-16T12:00:00.000Z',
			ordinal: 1,
			seed,
			tokenSet,
			provider: 'anthropic',
			model: 'claude-opus-5',
			promptVersion: 'seed-v3',
			rawResponse: '{"keyColors":[{"proposedRole":"brand"}]}',
			scaleEngine: 'cambium-oklch-1',
			fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
			interpretation: 'balanced',
		},
	],
};

/**
 * Zod strips unknown keys by default, which is the wrong failure for a persisted shape. Stripping
 * would lose an unrecognised key on the way to disk without a word, so these schemas reject instead
 * and the ticket that adds the key gets an error naming the file to widen.
 *
 * #7 widened the schema for its nine non-colour categories and moved this guard onto the payload
 * #9 attaches, which is the next category of data with no slot here. The guard is only worth
 * anything while it points at something the schema has not learned yet.
 */
describe('schema strictness', () => {
	it('rejects a provenance payload rather than dropping it on the way to disk', () => {
		const withExtensions = {
			...tokenSet,
			$extensions: {
				'com.cambium': {
					provenance: 'observed',
					rationale: 'traces to the brand key colour',
					seedField: 'keyColors',
				},
			},
		};

		const result = TokenSetSchema.safeParse(withExtensions);

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
