import type { Page } from '@playwright/test';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';

import { expect, test } from './fixtures';
import {
	fixtureBrandKeyColor,
	generateButton,
	generateWithFreshKey,
	imageIdFromRequest,
	mockAnthropic,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

/**
 * Set on `window` just before Generate is clicked. A reload or any full navigation starts a fresh
 * `window`, so finding it afterwards shows the seed arrived in the same document. URL equality
 * alone would pass a `location.reload()`.
 */
const NO_RELOAD_MARK = '__cambiumNoReloadMark';

type MarkedWindow = Window & Record<string, boolean | undefined>;

/** `oklch(l c h)` split into numbers, so the check compares values rather than formatter output. */
function parseOklchChannels(text: string): [number, number, number] {
	const channels = /^oklch\(([^ ]+) ([^ ]+) ([^ )]+)\)$/.exec(text);
	if (!channels) throw new Error(`unrecognised swatch text: ${text}`);
	return [Number(channels[1]), Number(channels[2]), Number(channels[3])];
}

/**
 * Reads the stored row through raw IndexedDB, so a defect in the app's own `RecordStore` can't
 * agree with itself here. `null` when no row is stored under the id.
 */
async function storedVersionCount(page: Page, recordId: string): Promise<number | null> {
	return page.evaluate(
		async ([databaseName, storeName, id]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				return await new Promise<number | null>((resolve, reject) => {
					const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
					request.addEventListener('success', () => {
						const row = request.result as { versions: unknown[] } | undefined;
						resolve(row ? row.versions.length : null);
					});
					request.addEventListener('error', () => reject(request.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, recordId] as const,
	);
}

test('a record with no versions generates its first version from the workspace, and the seed rail shows it without a reload', async ({
	page,
}) => {
	// Generation looks up the font table, and the fixture seed states a pairing. Served from the
	// committed CSV so nothing reaches jsDelivr.
	await serveFontTable(page);

	const recordId = await saveOneRecord(page);
	const workspaceUrl = new RegExp(`/workspace\\?record=${recordId}$`);

	await page.goto(`/workspace?record=${recordId}`);
	await expect(page.getByRole('complementary', { name: 'Seed and tokens' })).toBeVisible();
	await expect(page.locator('[data-seed-field]')).toHaveCount(0);

	const sent = await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));

	await waitForGenerateReady(page);
	await page.evaluate((mark) => {
		(window as unknown as MarkedWindow)[mark] = true;
	}, NO_RELOAD_MARK);

	await generateWithFreshKey(page, TEST_KEY);

	const brandSwatch = page.locator('[data-seed-field="keyColors.0"] .font-mono');
	await expect(brandSwatch).toBeVisible();

	const [l, c, h] = parseOklchChannels((await brandSwatch.textContent()) ?? '');
	const [expectedL, expectedC, expectedH] = fixtureBrandKeyColor().oklch;
	expect(l).toBeCloseTo(expectedL, 3);
	expect(c).toBeCloseTo(expectedC, 3);
	expect(h).toBeCloseTo(expectedH, 3);

	expect(sent).toHaveLength(1);
	await expect(page).toHaveURL(workspaceUrl);
	expect(
		await page.evaluate((mark) => (window as unknown as MarkedWindow)[mark], NO_RELOAD_MARK),
	).toBe(true);
	expect(await storedVersionCount(page, recordId)).toBe(1);

	// A second version from here is a #158 non-goal, so the control leaves with the empty state.
	await expect(generateButton(page)).toHaveCount(0);
	// The seed now exists, so the preset select Task 1 hid comes back.
	await expect(page.getByLabel('Interpretation')).toBeVisible();
});
