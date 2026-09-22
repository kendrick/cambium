import { type Page, expect, test as base } from '@playwright/test';

import { DATABASE_NAME } from '../app/storage/indexed-db-record-store';

/**
 * A path no route and no file uses, fulfilled from inside the browser rather than fetched.
 *
 * The wipe needs a document on the served origin, because `indexedDB` on `about:blank` belongs to
 * an opaque origin and holds nothing the app ever wrote. Fulfilling an empty document keeps the
 * origin and runs none of the app's code, so nothing can hold a connection open when the databases
 * are deleted. Wiping from the landing route instead would work only while that route keeps not
 * opening the database on mount, which is a property of `components/landing/landing-route.tsx`
 * rather than of this harness.
 *
 * Letting the request reach the server would defeat the console check below. The export has no
 * file here, `scripts/serve-out.mjs` answers 404, and Chromium logs a failed resource load as a
 * console error, so every scenario would fail teardown on a request this harness made.
 */
const BLANK_ORIGIN_PATH = '/__cambium-harness__/blank';

const BLANK_ORIGIN_GLOB = `**${BLANK_ORIGIN_PATH}`;

/**
 * Deletes every IndexedDB database the origin holds.
 *
 * Enumerating with `indexedDB.databases()` keeps the wipe independent of the app's own naming, so
 * a store added later is cleared without touching this file. `DATABASE_NAME` is still deleted by
 * name, because Firefox does not implement the enumeration call, and a fixture that silently wipes
 * nothing is worse than one that fails.
 *
 * A delete blocked by an open connection neither succeeds nor fails on its own, so this turns the
 * blocked event into a rejection. Waiting the block out would stall the scenario until the test
 * timeout and report a missing wipe as a slow page.
 */
async function wipeIndexedDb(page: Page): Promise<void> {
	await page.route(BLANK_ORIGIN_GLOB, (route) =>
		route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
	);

	try {
		await page.goto(BLANK_ORIGIN_PATH);
	} finally {
		// Unroute straight away, so the handler cannot shadow a request the scenario itself makes.
		await page.unroute(BLANK_ORIGIN_GLOB);
	}

	await page.evaluate(async (knownDatabase) => {
		const enumerated =
			typeof indexedDB.databases === 'function'
				? (await indexedDB.databases())
						.map((info) => info.name)
						.filter((name): name is string => typeof name === 'string')
				: [];

		await Promise.all(
			[...new Set([...enumerated, knownDatabase])].map(
				(name) =>
					new Promise<void>((resolve, reject) => {
						const request = indexedDB.deleteDatabase(name);

						request.addEventListener('success', () => resolve());
						request.addEventListener('error', () =>
							reject(new Error(`deleting IndexedDB "${name}" failed`)),
						);
						request.addEventListener('blocked', () =>
							reject(new Error(`deleting IndexedDB "${name}" is blocked by an open connection`)),
						);
					}),
			),
		);
	}, DATABASE_NAME);
}

/**
 * The `test` every scenario imports. Both fixtures are `auto`, so a scenario gets them by existing
 * rather than by naming them. A new spec cannot opt out of either guarantee by forgetting to ask
 * for it.
 */
export const test = base.extend<{ consoleErrors: string[]; cleanIndexedDb: void }>({
	/**
	 * Fails the scenario in teardown when the page logged a console error.
	 *
	 * The check runs after the body rather than during it, because an error logged by a late effect
	 * arrives after the last assertion has already passed. Collecting through the run and reading
	 * the list at the end catches that error too.
	 *
	 * The list is a fixture rather than a local, so a scenario that expects a console error can read
	 * the collected messages, and one that means to tolerate a console error can empty them.
	 */
	consoleErrors: [
		async ({ page }, use) => {
			const messages: string[] = [];

			page.on('console', (message) => {
				if (message.type() !== 'error') return;

				const { url, lineNumber } = message.location();
				messages.push(`${message.text()} [${url}:${lineNumber}]`);
			});

			await use(messages);

			expect(
				messages,
				`the page logged console errors:\n${messages.map((line) => `  ${line}`).join('\n')}`,
			).toEqual([]);
		},
		{ auto: true },
	],

	/**
	 * Wipes IndexedDB before the scenario body runs.
	 *
	 * Playwright gives each scenario its own context, so a spec using the default `page` starts
	 * empty whether or not this runs. The wipe is what keeps that true for a spec that overrides
	 * `page` with a shared or worker-scoped context, which inherits whatever the previous scenario
	 * wrote. A record crossing from one scenario to the next would make the second one's result
	 * depend on file order.
	 */
	cleanIndexedDb: [
		async ({ page }, use) => {
			await wipeIndexedDb(page);
			await use();
		},
		{ auto: true },
	],
});

export { expect };
