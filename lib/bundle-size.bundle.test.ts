import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FIRST_LOAD_BUDGET_BYTES, TOTAL_JS_BUDGET_BYTES } from './bundle-budget';
import { measureBundle, readStaticExport } from './bundle-size';

const outDir = new URL('../out/', import.meta.url);

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

function overBudget(label: string, actual: number, budget: number): string[] {
	if (actual <= budget) return [];

	return [
		`${label} is ${kB(actual)} against a ${kB(budget)} budget, over by ${kB(actual - budget)}`,
	];
}

/**
 * Runs against a real static export, which is why it sits in its own Vitest project behind
 * `pnpm test:bundle` rather than in the default run.
 *
 * A missing `out/` fails rather than skips. A skip that nobody notices turns a green run into a
 * statement about nothing, and this check has one job.
 */
describe('the shipped bundle', () => {
	it('stays inside both budgets', () => {
		if (!existsSync(new URL('index.html', outDir))) {
			throw new Error('out/index.html is missing. Run pnpm build before pnpm test:bundle.');
		}

		const measurement = measureBundle(readStaticExport(outDir));

		expect([
			...overBudget('first-load JS', measurement.firstLoadBytes, FIRST_LOAD_BUDGET_BYTES),
			...overBudget('total JS', measurement.totalBytes, TOTAL_JS_BUDGET_BYTES),
		]).toEqual([]);
	});
});
