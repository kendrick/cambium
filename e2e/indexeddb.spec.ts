import type { Page } from '@playwright/test';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';

import { expect, test as base } from './fixtures';

/**
 * Shared across both scenarios below, worker-scoped instead of the default per-test page. A fresh
 * `page` starts every test with empty storage on its own — that is `./fixtures.ts`'s own point
 * about the default fixture — which would let the second scenario below pass whether or not
 * `cleanIndexedDb` actually ran. One page for the whole file is what makes the wipe the real
 * reason the second scenario finds nothing, rather than context isolation doing that job for free.
 *
 * `page` itself stays declared at test scope — Playwright's types refuse to widen a fixture the
 * base test already fixed at that scope — and is overridden only to hand back the one page
 * `sharedPage` created. Every fixture that asks for `page`, including `cleanIndexedDb` and
 * `consoleErrors` from `./fixtures.ts`, resolves to that same shared page as a result.
 */
const test = base.extend<object, { sharedPage: Page }>({
	sharedPage: [
		async ({ browser }, use) => {
			const page = await browser.newPage();
			await use(page);
			await page.close();
		},
		{ scope: 'worker' },
	],
	page: async ({ sharedPage }, use) => {
		await use(sharedPage);
	},
});

// If the write in the first scenario fails, letting the second one still run would read an empty
// store for the wrong reason and report a false pass.
test.describe.configure({ mode: 'serial' });

/**
 * Counts rows in the `records` object store through raw IndexedDB calls, never through
 * `core/brand-record` or the app's own store module. Both scenarios below need only a count, and
 * reading it this way keeps this file untied to whatever shape a stored record holds — #78 is
 * about to add a required field and bump `SCHEMA_VERSION`, and a count does not care.
 *
 * A missing database counts as zero rather than an error: `cleanIndexedDb` in `./fixtures.ts`
 * deletes the database outright rather than leaving an empty store behind, so "after the wipe" is
 * exactly this case. The existence check has to come before `open`, because `open` creates a
 * database that is not there. Counting without it would leave an empty database behind on an
 * origin this function is only supposed to read.
 *
 * `indexedDB.databases()` is called outright rather than feature-detected, for the reason
 * `wipeIndexedDb` in `./fixtures.ts` gives: one Chromium project, and a browser without the call
 * should fail loudly rather than answer from a fallback nobody exercises.
 */
async function countStoredRecords(page: Page): Promise<number> {
	return page.evaluate(
		async ([databaseName, storeName]) => {
			const known = (await indexedDB.databases()).some((info) => info.name === databaseName);

			if (!known) return 0;

			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				if (!db.objectStoreNames.contains(storeName)) return 0;

				return await new Promise<number>((resolve, reject) => {
					const countRequest = db.transaction(storeName, 'readonly').objectStore(storeName).count();

					countRequest.addEventListener('success', () => resolve(countRequest.result));
					countRequest.addEventListener('error', () => reject(countRequest.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME] as const,
	);
}

/**
 * A minimal valid PNG, a single black pixel, inlined rather than checked in as a fixture file.
 * `prepareReferenceImage` decodes through the browser's real `createImageBitmap`, which a
 * fabricated or truncated signature cannot satisfy, so this has to be bytes a real decoder accepts.
 */
const ONE_PIXEL_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('writing a record through the upload form leaves it in the store', async ({ page }) => {
	await page.goto('/');

	// Driven through the form rather than built as a literal `BrandRecord`: the id, schema version,
	// and every image field come from the app's own code, so this scenario stays correct across a
	// shape change like #78's rather than silently drifting from what `save()` actually writes.
	await page.getByLabel('Reference images').setInputFiles({
		name: 'brand.png',
		mimeType: 'image/png',
		buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
	});

	// `acceptFiles` decodes asynchronously; this row only renders once the picked image has landed
	// in state, which is what the click below needs to be true.
	await expect(page.getByText('brand.png', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Save these references' }).click();

	// This text renders only from the `found` branch in `components/landing/landing-route.tsx`,
	// once the read-back that follows `router.replace` has resolved — proof the write landed, not
	// just that the click happened.
	await expect(page.getByText(/^Saved\./)).toBeVisible();

	expect(await countStoredRecords(page)).toBe(1);
});

test('a following scenario observes an empty store', async ({ page }) => {
	await page.goto('/');

	// Passing here on the shared page above, after a record was just written, is what proves
	// `cleanIndexedDb`'s wipe ran between these two scenarios rather than storage starting fresh on
	// its own.
	expect(await countStoredRecords(page)).toBe(0);
});
