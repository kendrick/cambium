import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSeed, SeedLoadError } from './seed.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

describe('loadSeed', () => {
	it('parses a valid seed file into a BrandSeed', async () => {
		const seed = await loadSeed(`${FIXTURES}seed.json`);

		expect(seed.keyColors?.[0]?.proposedRole).toBe('brand');
	});

	it('rejects a missing file with the path in the message', async () => {
		await expect(loadSeed(`${FIXTURES}does-not-exist.json`)).rejects.toThrow(SeedLoadError);
		await expect(loadSeed(`${FIXTURES}does-not-exist.json`)).rejects.toThrow(
			/does-not-exist\.json/,
		);
	});

	it('rejects text that is not JSON', async () => {
		// package.json is a real file but not a BrandSeed, which exercises the JSON.parse success /
		// schema rejection path rather than this one; this test wants a file that is not JSON at all.
		const notJson = fileURLToPath(new URL('./register-ts.mjs', import.meta.url));

		await expect(loadSeed(notJson)).rejects.toThrow(/not valid JSON/);
	});

	it('rejects JSON that fails BrandSeedSchema, naming the offending field', async () => {
		await expect(loadSeed(`${FIXTURES}seed-invalid.json`)).rejects.toThrow(/confidence/);
	});
});
