import { afterEach, describe, expect, it, vi } from 'vitest';

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

const tokenSet = { ...layer, schemes: { light: layer, dark: layer } };

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
 * Stage 2 stays free of DOM and browser APIs so it can run server-side unchanged, which the
 * headless generate CLI depends on.
 *
 * The guard has to parse values that are actually valid. Feeding a schema a string fails at
 * the outer object check and never walks a single field, so a network call buried in a
 * refinement would leave the test green. `fetch` is a live global under Node, so absence
 * cannot be asserted the way it can for `document`; stubbing it to throw is what turns a
 * stray call into a failure.
 */
describe('core schema purity', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('runs where no browser global exists', () => {
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');
		expect(typeof localStorage).toBe('undefined');
	});

	it.each([
		['BrandSeedSchema', BrandSeedSchema, seed],
		['TokenSetSchema', TokenSetSchema, tokenSet],
		['BrandRecordSchema', BrandRecordSchema, record],
	])('%s parses a valid value without reaching the network', (_name, schema, value) => {
		vi.stubGlobal('fetch', () => {
			throw new Error('the pure core must not reach the network');
		});

		expect(schema.safeParse(value).success).toBe(true);
	});
});
