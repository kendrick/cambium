import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EngineError, loadSchemes } from './cli.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

describe('loadSchemes', () => {
	it('runs a valid seed through the scale engine', async () => {
		const schemes = await loadSchemes(`${FIXTURES}seed.json`);

		expect(schemes.light.brand).toHaveLength(12);
		expect(schemes.dark.brand).toHaveLength(12);
	});

	// The scale engine rejects a seed with no key colours the same way it rejects an unreachable
	// contrast floor: a result the caller has to handle, never a throw. This is the path
	// describeEngineError exists for, and it had no fixture exercising it until now.
	it('rejects a seed with no key colours, readably', async () => {
		await expect(loadSchemes(`${FIXTURES}seed-no-colors.json`)).rejects.toThrow(EngineError);
		await expect(loadSchemes(`${FIXTURES}seed-no-colors.json`)).rejects.toThrow(/key colours/);
	});
});
