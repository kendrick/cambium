import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { RAMP_NAMES } from '../core/scale-engine';

const execFileAsync = promisify(execFile);

const CLI = fileURLToPath(new URL('./evaluate.mjs', import.meta.url));
const REGISTER = fileURLToPath(new URL('./lib/register-ts.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const OUT_FILE = fileURLToPath(new URL('../swatches/seed.html', import.meta.url));

function runCli(args: string[]) {
	return execFileAsync('node', ['--import', REGISTER, CLI, ...args]);
}

describe('evaluate harness', () => {
	afterEach(async () => {
		await rm(OUT_FILE, { force: true });
	});

	it('renders every ramp in both schemes, annotated with its step role', async () => {
		await runCli([`${FIXTURES}seed.json`]);

		const html = await readFile(OUT_FILE, 'utf8');

		expect(html).toContain('light scheme');
		expect(html).toContain('dark scheme');

		for (const ramp of RAMP_NAMES) {
			expect(html).toContain(ramp);
		}

		// A step-role name, to confirm the harness carries STEP_ROLES through rather than falling
		// back to the role-less rendering scripts/swatches.mjs uses for Radix and Tailwind.
		expect(html).toContain('subtle border');

		// The seed fixture's brand key colour, oklch(0.62 0.19 259.8), lands on step 9 unchanged in
		// both schemes (the scale engine anchors step 9 to the seed exactly). Pinning the rendered
		// l / c / h triple is what would have caught the earlier bug where hue was measured but
		// never rendered: a regression that drops h again reverts to "0.620 / 0.190" and this fails.
		expect(html).toContain('0.620 / 0.190 / 259.8');

		// A WCAG contrast ratio in the "X.XX:1" shape renderCell prints per step, so "relevant
		// contrast ratios" is pinned as more than a string this test happens not to look for.
		expect(html).toMatch(/\d+\.\d{2}:1/);
	});

	it('exits non-zero with a readable message when the seed fails schema validation', async () => {
		await expect(runCli([`${FIXTURES}seed-invalid.json`])).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('confidence'),
		});
	});
});
