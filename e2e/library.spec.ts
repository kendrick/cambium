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

/**
 * Seeds rows through raw IndexedDB, after the library has opened the database, so the app's own
 * upgrade creates the store rather than this file. Raw because a palette needs a version with a
 * seed, and producing one through the interface means a mocked generation per scenario.
 */
async function seedRows(page: Page, rows: unknown[]): Promise<void> {
	await page.goto('/');
	await expect(library(page)).toBeVisible();

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

	await page.reload();
	await expect(library(page)).toBeVisible();
}

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
