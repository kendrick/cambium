import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { checkContrast } from '../core/contrast/check';
import { RAMP_NAMES } from '../core/scale-engine';
import { TokenSetSchema } from '../core/token-set';

const execFileAsync = promisify(execFile);

const CLI = fileURLToPath(new URL('./generate.mjs', import.meta.url));
const REGISTER = fileURLToPath(new URL('./lib/register-ts.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function runCli(args: string[]) {
	return execFileAsync('node', ['--import', REGISTER, CLI, ...args]);
}

describe('generate CLI', () => {
	it('round-trips a valid seed fixture into a token set on stdout', async () => {
		const { stdout } = await runCli([`${FIXTURES}seed.json`]);
		const tokenSet = JSON.parse(stdout);

		// Asserting shape rather than the full token set: Lane A is widening TokenSetSchema with
		// derived categories elsewhere, and this CLI prints whatever buildTokenSet returns without
		// enumerating categories, so this test shouldn't either.
		for (const ramp of RAMP_NAMES) {
			expect(tokenSet.primitives[ramp]).toHaveLength(12);
			expect(tokenSet.schemes.light.primitives[ramp]).toHaveLength(12);
			expect(tokenSet.schemes.dark.primitives[ramp]).toHaveLength(12);
		}

		expect(Object.keys(tokenSet.semantic).length).toBeGreaterThan(0);
	});

	// Read back off stdout, the only thing a CLI consumer gets, so this fails if the CLI ever prints
	// the raw derived set again: `seed.json` misses AA on `primary-foreground` and
	// `muted-foreground` before repair (#8).
	it('prints a token set whose declared pairs all pass AA in both schemes', async () => {
		const { stdout } = await runCli([`${FIXTURES}seed.json`]);
		const failing = checkContrast(TokenSetSchema.parse(JSON.parse(stdout))).filter(
			(entry) => !entry.passes,
		);

		expect(failing).toEqual([]);
	});

	// The acceptance criterion is "exits non-zero with a readable message"; readable is what a
	// schema-rejection test has to check, since a wrong exit code alone would still pass a CLI
	// that printed a raw Zod error dump.
	it('exits non-zero with a readable message when the seed fails schema validation', async () => {
		await expect(runCli([`${FIXTURES}seed-invalid.json`])).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('confidence'),
		});
	});

	it('exits non-zero with a readable message when the file does not exist', async () => {
		await expect(runCli([`${FIXTURES}does-not-exist.json`])).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('does-not-exist.json'),
		});
	});

	it('exits non-zero with usage when called without a seed path', async () => {
		await expect(runCli([])).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('usage'),
		});
	});
});
