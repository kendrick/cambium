import { afterEach, describe, expect, it, vi } from 'vitest';

import { assetPath } from './asset-path';
import { BASE_PATH_ENV } from './deploy-paths';

describe('assetPath', () => {
	it('returns a root-relative path unchanged when the deploy has no base path', () => {
		expect(assetPath('/demo/fixtures/photo-window.json', '')).toBe(
			'/demo/fixtures/photo-window.json',
		);
	});

	it('prefixes the base path a subpath deploy serves the export under', () => {
		expect(assetPath('/demo/fixtures/photo-window.json', '/cambium')).toBe(
			'/cambium/demo/fixtures/photo-window.json',
		);
	});
});

// `assetPath` only works if its prefix matches the one Next routes under. These tests read both off the config Next loads, because the e2e harness has no prefixed static server.
describe('next.config', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('hands client code the same base path Next routes under', async () => {
		vi.stubEnv(BASE_PATH_ENV, 'cambium/');

		const { default: config } = await import('../next.config');

		expect(config.basePath).toBe('/cambium');
		expect(config.env?.NEXT_PUBLIC_CAMBIUM_BASE_PATH).toBe(config.basePath);
	});

	it('hands client code an empty prefix when the deploy has none', async () => {
		vi.stubEnv(BASE_PATH_ENV, '');

		const { default: config } = await import('../next.config');

		expect(config.basePath).toBeUndefined();
		expect(config.env?.NEXT_PUBLIC_CAMBIUM_BASE_PATH).toBe('');
	});
});
