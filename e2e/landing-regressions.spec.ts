import type { Page, Route } from '@playwright/test';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import { MAX_ENCODED_BASE64_BYTES } from '../lib/image-intake';

import { expect, test } from './fixtures';
import { makeFatPng, makePng } from './fixtures/png';

/**
 * Pins the five defects #22 shipped and `4b3f065` fixed. Each scenario below names the fix it
 * guards, and each was mutation-checked against a hand-written revert of that fix.
 * `docs/agents/testing.md` asks for that check because a regression test for a defect already fixed
 * is the easiest kind to write so that it passes for the wrong reason. Reverts 2 to 5 fail their own
 * scenario and no other. Revert 1 fails all five, because every scenario stages its images through
 * the same picker and that revert stops the picker staging anything.
 *
 * Completion is read off the URL gaining `?record=` and off IndexedDB itself, never off the saved
 * panel's copy. #24 is rewriting that outcome, and wording is not what any of these defects broke.
 */

type StoredRecordSummary = { imageCount: number; serializedLength: number };

/**
 * Every stored record, reduced to what these scenarios assert, read through raw IndexedDB calls
 * for the reason `e2e/indexeddb.spec.ts` gives for `countStoredRecords`: nothing here should
 * depend on the app's own store module agreeing with itself.
 *
 * `serializedLength` is the whole record as JSON, which bounds every data URL inside it without
 * naming the field that holds one. `images` is named, because an image count is what scenario 3
 * is about and `BrandRecordSchema` has carried that field since the first record shape.
 */
async function readStoredRecords(page: Page): Promise<StoredRecordSummary[]> {
	return page.evaluate(
		async ([databaseName, storeName]) => {
			const known = (await indexedDB.databases()).some((info) => info.name === databaseName);

			// Checked before `open`, which would otherwise create the database this only means to read.
			if (!known) return [];

			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				if (!db.objectStoreNames.contains(storeName)) return [];

				const rows = await new Promise<unknown[]>((resolve, reject) => {
					const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();

					request.addEventListener('success', () => resolve(request.result));
					request.addEventListener('error', () => reject(request.error));
				});

				return rows.map((row) => ({
					imageCount: (row as { images: unknown[] }).images.length,
					serializedLength: JSON.stringify(row).length,
				}));
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME] as const,
	);
}

/**
 * How long scenario 2 keeps reading after `?record=` appears, and what it defends against.
 *
 * With the `saving` ref in place only one `save()` gets past its first line, so under the fixed
 * code nothing more can arrive and this window only costs time. It exists for the regression: with
 * the guard reverted, all three saves run, and the URL changes once the first one has written. The
 * other two share its module imports and each has one connection and one `put` left to do, so they
 * land within milliseconds of it. A single read taken the moment the URL changed could still see
 * one record and pass.
 *
 * Bounded, where it used to read until two reads agreed and had no stated limit. With the guard
 * reverted, all three records were already there on the first read, 0 ms after the URL changed. A
 * second is wide margin over that, and it's the whole cost this adds to a green run.
 */
const DOUBLE_WRITE_WINDOW_MS = 1000;

const DOUBLE_WRITE_POLL_MS = 100;

/** Fails as soon as any read in the window sees a count other than `expected`. */
async function expectRecordCountHolds(page: Page, expected: number): Promise<void> {
	const started = Date.now();

	for (;;) {
		const elapsed = Date.now() - started;
		// oxlint-disable-next-line no-await-in-loop
		const records = await readStoredRecords(page);

		expect(records, `record count ${elapsed} ms after ?record= appeared`).toHaveLength(expected);

		if (elapsed >= DOUBLE_WRITE_WINDOW_MS) return;

		// oxlint-disable-next-line no-await-in-loop
		await page.waitForTimeout(DOUBLE_WRITE_POLL_MS);
	}
}

function pngFile(name: string, bytes: Uint8Array) {
	return { name, mimeType: 'image/png', buffer: Buffer.from(bytes) };
}

function stagedRow(page: Page, name: string) {
	return page.getByRole('listitem').filter({ hasText: name });
}

async function expectSaved(page: Page): Promise<void> {
	await expect(page).toHaveURL(/[?&]record=/);
}

test('a picked file is staged although the handler clears the input after reading it', async ({
	page,
}) => {
	await page.goto('/');

	// Guards the copy out of `event.target.files` ahead of `event.target.value = ''`. The list is a
	// live view of the input, so clearing first empties it and the pick lands nothing.
	await page.getByLabel('Reference images').setInputFiles(pngFile('live.png', makePng(2, 2)));

	await expect(stagedRow(page, 'live.png')).toBeVisible();
});

test('three submits in one tick write exactly one record', async ({ page }) => {
	await page.goto('/');

	await page.getByLabel('Reference images').setInputFiles(pngFile('once.png', makePng(2, 2)));
	await expect(stagedRow(page, 'once.png')).toBeVisible();

	// One `evaluate`, so all three land before React renders `busy`. That is the window the
	// synchronous `saving` ref closes and a guard reading state cannot.
	await page.locator('form').evaluate((form: HTMLFormElement) => {
		form.requestSubmit();
		form.requestSubmit();
		form.requestSubmit();
	});

	await expectSaved(page);

	await expectRecordCountHolds(page, 1);
});

test('Remove during a held save leaves the list as the record will store it', async ({ page }) => {
	await page.goto('/');

	await page
		.getByLabel('Reference images')
		.setInputFiles([pngFile('first.png', makePng(2, 2)), pngFile('second.png', makePng(3, 3))]);

	const rows = page.getByRole('listitem');
	await expect(rows).toHaveCount(2);

	// Installed after the page has loaded, so it catches only what `save()` fetches on demand: the
	// chunks behind its dynamic imports. Holding them keeps the save parked at that `await`, which
	// is where the list used to stay editable.
	const held: Route[] = [];
	let released = false;
	await page.route('**/_next/static/chunks/**', async (route) => {
		if (released) await route.continue();
		else held.push(route);
	});

	await page.getByRole('button', { name: 'Save these references' }).click();

	// Without this, a chunk served from cache would let the scenario pass having held nothing.
	await expect.poll(() => held.length).toBeGreaterThan(0);

	// `dispatchEvent` rather than `click`, because `click` waits for a disabled button to enable and
	// the fix is exactly that it stays disabled.
	await rows.first().getByRole('button', { name: 'Remove' }).dispatchEvent('click');
	await expect(rows).toHaveCount(2);

	released = true;
	await Promise.all(held.map((route) => route.continue()));

	await expectSaved(page);

	const records = await readStoredRecords(page);
	expect(records).toHaveLength(1);
	expect(records[0]!.imageCount).toBe(2);
});

test('a malformed brand URL does not block the save', async ({ page }) => {
	await page.goto('/');

	await page.getByLabel('Reference images').setInputFiles(pngFile('brand.png', makePng(2, 2)));
	await expect(stagedRow(page, 'brand.png')).toBeVisible();

	// `type="url"` put native constraint validation on an optional field nothing stores, and a
	// failed constraint cancels the submit before `save` ever runs.
	await page.getByLabel(/Brand site/).fill('not a url');
	await page.getByRole('button', { name: 'Save these references' }).click();

	await expectSaved(page);

	expect(await readStoredRecords(page)).toHaveLength(1);
});

test('a small PNG carrying a 12 MB ancillary chunk is re-encoded rather than stored whole', async ({
	page,
}) => {
	await page.goto('/');

	// 400x300 sits inside the pixel cap, so the cap alone passed these bytes through untouched. The
	// byte ceiling sends it to the encoder, which keeps the pixels and drops the chunk.
	await page
		.getByLabel('Reference images')
		.setInputFiles(pngFile('fat.png', makeFatPng(12_000_000)));

	await expect(stagedRow(page, 'fat.png')).toBeVisible();
	// Scoped to the form, because Next's route announcer is a `role="alert"` of its own.
	await expect(page.locator('form').getByRole('alert')).toHaveCount(0);

	await page.getByRole('button', { name: 'Save these references' }).click();
	await expectSaved(page);

	// Measured on what IndexedDB holds, against the per-image base64 limit the stored image is later
	// sent under. Stored whole, this file's data URL alone would run to about 16 MB.
	const records = await readStoredRecords(page);
	expect(records).toHaveLength(1);
	expect(records[0]!.serializedLength).toBeLessThan(MAX_ENCODED_BASE64_BYTES);
});
