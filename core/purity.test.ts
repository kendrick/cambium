import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { BrandSeedSchema } from './brand-seed';
import { validateDtcg } from './dtcg/validate';
import { parseSeed } from './parse-seed';
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
	expressive: null,
};

const tokenSet = { ...layer, schemes: { light: layer, dark: layer } };

const rawResponse = {
	raw: JSON.stringify(seed),
	provider: 'anthropic',
	model: 'claude-opus-5',
	promptVersion: 'seed-v3',
};

const dtcgDocument = {
	color: {
		$type: 'color',
		brand: { $value: { colorSpace: 'oklch', components: [0.62, 0.19, 259.8], alpha: 1 } },
	},
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
 * Stage 2 stays free of DOM and browser APIs so it can run server-side unchanged, which the
 * headless generate CLI depends on.
 *
 * The guard has to parse values that are actually valid. Feeding a schema a string fails at
 * the outer object check and never walks a single field, so a network call buried in a
 * refinement would leave the test green. `fetch` is a live global under Node, so absence
 * cannot be asserted the way it can for `document`; stubbing it to throw is what turns a
 * stray call into a failure.
 *
 * Nothing discovers a new entry in the table below, so a module added to the pure core is
 * guarded here only if someone adds it.
 */
describe('core purity', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('runs where no browser global exists', () => {
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');
		expect(typeof localStorage).toBe('undefined');
	});

	it.each([
		['BrandSeedSchema', () => BrandSeedSchema.safeParse(seed).success],
		['TokenSetSchema', () => TokenSetSchema.safeParse(tokenSet).success],
		['BrandRecordSchema', () => BrandRecordSchema.safeParse(record).success],
		['the DTCG format validator', () => validateDtcg(dtcgDocument).valid],
		['parseSeed', () => parseSeed(rawResponse).ok],
	])('%s parses a valid value without reaching the network', (_name, parses) => {
		vi.stubGlobal('fetch', () => {
			throw new Error('the pure core must not reach the network');
		});

		expect(parses()).toBe(true);
	});
});
