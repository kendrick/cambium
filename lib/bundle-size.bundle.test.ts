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
	it('keeps every route inside the first-load budget and the build inside the total', () => {
		if (!existsSync(new URL('index.html', outDir))) {
			throw new Error('out/index.html is missing. Run pnpm build before pnpm test:bundle.');
		}

		const measurement = measureBundle(readStaticExport(outDir));

		// Logged on a pass too, so the headroom each route has left can be read before it runs out. The
		// default reporter shows it only on a failure; `pnpm test:bundle --reporter=verbose` shows it always.
		console.info(
			[
				...measurement.routes.map(({ route, firstLoadBytes }) => `${route}: ${kB(firstLoadBytes)}`),
				`total: ${kB(measurement.totalBytes)}`,
			].join('\n'),
		);

		// Named from the app's routes rather than read back from out/, so a glob that stopped finding
		// pages fails here instead of passing over fewer of them.
		expect(measurement.routes.map(({ route }) => route)).toEqual(
			expect.arrayContaining(['/', '/workspace']),
		);

		expect([
			...measurement.routes.flatMap(({ route, firstLoadBytes }) =>
				overBudget(`first-load JS on ${route}`, firstLoadBytes, FIRST_LOAD_BUDGET_BYTES),
			),
			...overBudget('total JS', measurement.totalBytes, TOTAL_JS_BUDGET_BYTES),
		]).toEqual([]);
	});
});
