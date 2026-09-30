import type { Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';

import photoWindow from '../app/demo/fixtures/photo-window.json' with { type: 'json' };
import uiWikipedia from '../app/demo/fixtures/ui-wikipedia.json' with { type: 'json' };
import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';

import { expect, test } from './fixtures';
import { serveFontTable } from './keyed-flow';

type Row = { id: string } & Record<string, unknown>;

/** A demo fixture under a fresh id, so no two scenarios share one. */
function stored(
	fixture: typeof photoWindow | typeof uiWikipedia,
	fields: Record<string, unknown> = {},
): Row {
	return { ...structuredClone(fixture), id: crypto.randomUUID(), ...fields };
}

const library = (page: Page) => page.getByRole('region', { name: 'Your brands' });
const row = (page: Page, id: string) => page.locator(`[data-library-row="${id}"]`);

/** Writes rows through raw IndexedDB, over whatever the store already holds under their ids. */
async function writeRows(page: Page, rows: unknown[]): Promise<void> {
	await page.evaluate(
		async ([databaseName, storeName, values]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(storeName, 'readwrite');
					for (const value of values) tx.objectStore(storeName).put(value);
					tx.addEventListener('complete', () => resolve());
					tx.addEventListener('error', () => reject(tx.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, rows] as const,
	);
}

/**
 * Seeds rows through raw IndexedDB, after the library has opened the database, so the app's own
 * upgrade creates the store rather than this file. Raw because a palette needs a version with a
 * seed, and producing one through the interface means a mocked generation per scenario.
 */
async function seedRows(page: Page, rows: unknown[]): Promise<void> {
	await page.goto('/');
	await expect(library(page)).toBeVisible();
	await writeRows(page, rows);
	await page.reload();
	await expect(library(page)).toBeVisible();
}

/** Every row IndexedDB holds, read without the app's own store module. */
async function readRows(page: Page): Promise<Row[]> {
	return page.evaluate(
		async ([databaseName, storeName]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				return await new Promise<Row[]>((resolve, reject) => {
					const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
					request.addEventListener('success', () => resolve(request.result as Row[]));
					request.addEventListener('error', () => reject(request.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME] as const,
	);
}

const bytesHeld = (rows: Row[]) => rows.reduce((sum, held) => sum + JSON.stringify(held).length, 0);

/** The composited pixel at a swatch's centre, which is what a person sees. */
async function centrePixel(target: Locator): Promise<[number, number, number]> {
	const png = PNG.sync.read(await target.screenshot({ animations: 'disabled' }));
	const at = (png.width * Math.floor(png.height / 2) + Math.floor(png.width / 2)) * 4;

	return [png.data[at]!, png.data[at + 1]!, png.data[at + 2]!];
}

test('an empty library shows a first-run state above the upload form', async ({ page }) => {
	await page.goto('/');

	await expect(library(page)).toBeVisible();
	await expect(library(page).locator('[data-library-first-run]')).toContainText(
		'No brands are saved in this browser yet',
	);
	await expect(page.getByRole('button', { name: 'Save these references' })).toBeVisible();
});

test('the library lists every saved record with a thumbnail, a name and a palette strip', async ({
	page,
}) => {
	const named = stored(photoWindow, { name: 'Zinc Works' });
	const unnamed = stored(uiWikipedia, { brandUrl: 'acme.com' });
	const unreadable = { ...stored(photoWindow), schemaVersion: 10 };
	await seedRows(page, [named, unnamed, unreadable]);

	const rows = library(page).locator('[data-library-row]');
	await expect(rows).toHaveCount(3);

	// Label order, unreadable last.
	await expect(rows.nth(0)).toHaveAttribute('data-library-row', unnamed.id);
	await expect(rows.nth(1)).toHaveAttribute('data-library-row', named.id);
	await expect(rows.nth(2)).toHaveAttribute('data-library-row', unreadable.id);

	for (const [record, label] of [
		[named, 'Zinc Works'],
		[unnamed, 'acme.com'],
	] as const) {
		const item = row(page, record.id);
		await expect(item.locator('[data-library-name]')).toHaveText(label);

		// A src attribute proves nothing on its own. A non-zero naturalWidth means the browser decoded it.
		const thumbnail = item.getByRole('img', { name: `First reference image for ${label}` });
		const images = record.images as { downscaled: string }[];
		await expect(thumbnail).toHaveAttribute('src', images[0]!.downscaled);
		expect(await thumbnail.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(
			0,
		);

		await expect(item.locator('[data-swatch]')).toHaveCount(7);
	}

	await expect(row(page, unreadable.id)).toContainText("can't read");
});

test('the palette strip paints the record’s current primary, override included', async ({
	page,
}) => {
	// sRGB red as OKLCH. The expected pixel comes from the colour chosen, not from the pipeline.
	const red = { l: 0.627955, c: 0.257683, h: 29.2339 };
	const record = stored(photoWindow, { name: 'Red Primary' });
	const versions = record.versions as Record<string, unknown>[];
	versions[0] = {
		...versions[0],
		overrides: [{ kind: 'primitive', scheme: 'light', ramp: 'brand', step: 9, ...red }],
	};
	await seedRows(page, [record]);

	const [r, g, b] = await centrePixel(row(page, record.id).locator('[data-swatch="primary"]'));

	expect(r).toBeGreaterThanOrEqual(253);
	expect(g).toBeLessThanOrEqual(2);
	expect(b).toBeLessThanOrEqual(2);
});

test('opening a record from the library loads it into the workspace', async ({ page }) => {
	await serveFontTable(page);
	const record = stored(photoWindow, { name: 'Window Studio' });
	await seedRows(page, [record]);

	await page.getByRole('link', { name: 'Open Window Studio' }).click();

	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${record.id}$`));
	await expect(page.getByRole('heading', { name: 'Tokens' })).toBeVisible();
});

test('the library shows the storage figure the browser reports', async ({ page }) => {
	await seedRows(page, [stored(photoWindow, { name: 'Window Studio' })]);

	const usage = library(page).locator('[data-storage-usage]');
	await expect(usage).toHaveText(
		/^Cambium is using [\d.,]+ (bytes?|kB|MB|GB) of the [\d.,]+ (kB|MB|GB) this browser allows it\.$/,
	);

	// Nothing writes between the listing and this read, so the two figures agree.
	const reported = Number(await usage.getAttribute('data-storage-usage'));
	const measured = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
	expect(reported).toBe(measured);
});

test('a record can be named and renamed', async ({ page }) => {
	const record = stored(uiWikipedia, { brandUrl: 'wikipedia.org' });
	await seedRows(page, [record]);
	const item = row(page, record.id);

	await item.getByRole('button', { name: 'Rename wikipedia.org' }).click();
	await item.getByRole('textbox', { name: 'Name for wikipedia.org' }).fill('  Encyclopedia  ');
	await item.getByRole('button', { name: 'Save name' }).click();
	await expect(item.locator('[data-library-name]')).toHaveText('Encyclopedia');

	// Checked in storage, as written. The seeded row carried no incarnation, so this write is also
	// the one that gives it one.
	const [named] = await readRows(page);
	expect(named).toMatchObject({ name: 'Encyclopedia', schemaVersion: 1, revision: 2 });
	expect(named!.incarnation).toMatch(/^[0-9a-f-]{36}$/);

	await item.getByRole('button', { name: 'Rename Encyclopedia' }).click();
	await item.getByRole('textbox', { name: 'Name for Encyclopedia' }).fill('Free Knowledge');
	await item.getByRole('button', { name: 'Save name' }).click();
	await expect(item.locator('[data-library-name]')).toHaveText('Free Knowledge');
	await page.reload();
	await expect(row(page, record.id).locator('[data-library-name]')).toHaveText('Free Knowledge');

	// Blanking the field clears the name, so the key goes and the label falls back to the brand site.
	// The field gets spaces, because an empty one clears even with no trim in `rename`, and the schema
	// refuses a name of spaces.
	await row(page, record.id).getByRole('button', { name: 'Rename Free Knowledge' }).click();
	await row(page, record.id).getByRole('textbox', { name: 'Name for Free Knowledge' }).fill('   ');
	await row(page, record.id).getByRole('button', { name: 'Save name' }).click();
	await expect(row(page, record.id).locator('[data-library-name]')).toHaveText('wikipedia.org');
	expect((await readRows(page))[0]).not.toHaveProperty('name');
});

test('a rename built on a copy another tab overtook is refused and the list refreshed', async ({
	page,
}) => {
	const record = stored(uiWikipedia, { name: 'Listed' });
	await seedRows(page, [record]);
	const item = row(page, record.id);

	// Another writer lands after this page listed the record, at the next revision.
	const [held] = await readRows(page);
	await writeRows(page, [{ ...held, name: 'Elsewhere', revision: 2 }]);

	await item.getByRole('button', { name: 'Rename Listed' }).click();
	await item.getByRole('textbox', { name: 'Name for Listed' }).fill('Mine');
	await item.getByRole('button', { name: 'Save name' }).click();

	// The form stays open over the refreshed copy, so the person can save again from what is stored.
	await expect(item.getByRole('alert')).toContainText('changed in another tab');
	await expect(item.getByRole('textbox', { name: 'Name for Elsewhere' })).toBeVisible();
	await item.getByRole('button', { name: 'Cancel' }).click();
	await expect(item.locator('[data-library-name]')).toHaveText('Elsewhere');
	expect((await readRows(page))[0]).toMatchObject({ name: 'Elsewhere', revision: 2 });
});

test('a rename of a record another tab deleted says so outside the removed row', async ({
	page,
}) => {
	// An incarnation, because only a copy carrying one is refused as a deleted record's.
	const record = stored(uiWikipedia, { name: 'Doomed', incarnation: crypto.randomUUID() });
	await seedRows(page, [record]);
	const item = row(page, record.id);

	await item.getByRole('button', { name: 'Rename Doomed' }).click();
	await item.getByRole('textbox', { name: 'Name for Doomed' }).fill('Too late');

	const other = await page.context().newPage();
	await other.goto('/');
	await other.getByRole('button', { name: 'Delete Doomed' }).click();
	await other.getByRole('dialog').getByRole('button', { name: 'Delete brand' }).click();
	await expect(row(other, record.id)).toHaveCount(0);
	await other.close();

	await item.getByRole('button', { name: 'Save name' }).click();

	await expect(item).toHaveCount(0);
	await expect(library(page)).toContainText('deleted in another tab');
	await expect(library(page).getByRole('heading', { name: 'Your brands' })).toBeFocused();
	expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
	expect(await readRows(page)).toHaveLength(0);
});

test('deleting a record removes it from the library and frees what it held', async ({ page }) => {
	const kept = stored(uiWikipedia, { name: 'Kept' });
	const removed = stored(photoWindow, { name: 'Removed' });
	await seedRows(page, [kept, removed]);
	const before = await readRows(page);
	const removedBytes = JSON.stringify(before.find((held) => held.id === removed.id)).length;

	// Cancelling deletes nothing.
	await page.getByRole('button', { name: 'Delete Removed' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(await readRows(page)).toHaveLength(2);

	await page.getByRole('button', { name: 'Delete Removed' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete brand' }).click();

	await expect(row(page, removed.id)).toHaveCount(0);
	await expect(library(page).getByRole('heading', { name: 'Your brands' })).toBeFocused();

	const after = await readRows(page);
	expect(after.map((held) => held.id)).toEqual([kept.id]);
	expect(bytesHeld(after)).toBe(bytesHeld(before) - removedBytes);

	// Nothing writes between the refresh the delete triggered and this read, so the two agree.
	const usage = library(page).locator('[data-storage-usage]');
	const measured = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
	await expect(usage).toHaveAttribute('data-storage-usage', String(measured));
});

type EstimateHold = { armed: boolean; held: boolean; release: (() => void) | null };

/**
 * Wraps `StorageManager.prototype.estimate` so that, once `estimateHold.armed` is set, the next call
 * stays pending until the scenario calls `estimateHold.release`. Every library refresh awaits that
 * call, so holding one lets a scenario make an earlier refresh settle after a later one.
 */
async function installEstimateHold(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const proto = StorageManager.prototype;
		const original = proto.estimate;
		const hold: EstimateHold = { armed: false, held: false, release: null };
		(window as unknown as { estimateHold: EstimateHold }).estimateHold = hold;

		proto.estimate = function (this: StorageManager) {
			const answer = original.call(this);
			if (!hold.armed) return answer;

			hold.armed = false;
			hold.held = true;
			return new Promise((resolve) => {
				hold.release = () => resolve(answer);
			});
		};
	});
}

const estimateHeld = (page: Page) =>
	page.evaluate(() => (window as unknown as { estimateHold: EstimateHold }).estimateHold.held);

test('a refresh overtaken by a later one leaves a deleted record deleted', async ({ page }) => {
	await installEstimateHold(page);
	const renamed = stored(uiWikipedia, { name: 'Alpha' });
	const deleted = stored(photoWindow, { name: 'Bravo' });
	await seedRows(page, [renamed, deleted]);

	await page.evaluate(() => {
		(window as unknown as { estimateHold: EstimateHold }).estimateHold.armed = true;
	});

	// The rename's write lands, then its refresh reads both rows and stalls on the held estimate.
	const item = row(page, renamed.id);
	await item.getByRole('button', { name: 'Rename Alpha' }).click();
	await item.getByRole('textbox', { name: 'Name for Alpha' }).fill('Alpha Two');
	await item.getByRole('button', { name: 'Save name' }).click();
	await expect.poll(() => estimateHeld(page)).toBe(true);

	await page.getByRole('button', { name: 'Delete Bravo' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete brand' }).click();
	await expect(row(page, deleted.id)).toHaveCount(0);

	await page.evaluate(() =>
		(window as unknown as { estimateHold: EstimateHold }).estimateHold.release?.(),
	);

	// The rename form closes only once its refresh has settled, so from here the stale result has
	// either landed or been dropped.
	await expect(item.getByRole('textbox')).toHaveCount(0);
	await expect(row(page, deleted.id)).toHaveCount(0);
	await expect(item.locator('[data-library-name]')).toHaveText('Alpha Two');
	expect((await readRows(page)).map((held) => held.id)).toEqual([renamed.id]);
});

test('deleting the last record brings back the first-run state', async ({ page }) => {
	const only = stored(photoWindow, { name: 'Only' });
	await seedRows(page, [only]);

	await page.getByRole('button', { name: 'Delete Only' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete brand' }).click();

	await expect(library(page).locator('[data-library-first-run]')).toBeVisible();
	expect(await readRows(page)).toEqual([]);
});

test('an unreadable record can be deleted too', async ({ page }) => {
	const unreadable = { ...stored(photoWindow), schemaVersion: 10 };
	await seedRows(page, [unreadable]);

	await row(page, unreadable.id).getByRole('button', { name: 'Delete unreadable brand' }).click();
	await expect(page.getByRole('dialog')).toContainText("can't open");
	await page.getByRole('dialog').getByRole('button', { name: 'Delete brand' }).click();

	await expect(library(page).locator('[data-library-first-run]')).toBeVisible();
	expect(await readRows(page)).toEqual([]);
});
