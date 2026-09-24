import { randomUUID } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import {
	type BrandRecord,
	BrandRecordSchema,
	FIRST_REVISION,
	SCHEMA_VERSION,
} from '../core/brand-record';

import { expect, test } from './fixtures';

/**
 * Spelled out rather than imported from `components/stored-record.tsx`. The address is a contract
 * with every link and bookmark already out there, so a rename of that constant should fail here
 * rather than move this test along with it.
 */
const RECORD_PARAM = 'record';

/**
 * One key color is the minimum `core/oklch-scale-engine.ts` needs to produce a non-error
 * `ScaleEngineResult`, matching the seed `core/oklch-scale-engine.test.ts` builds for the same
 * reason. Every other field stays null, which `BrandSeedSchema` accepts, because this scenario
 * suite only needs a token list with rows in it, not a particular brand.
 */
const FIXTURE_SEED = {
	keyColors: [
		{
			oklch: [0.6231, 0.188, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	surfacePolarity: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

/**
 * A record holding one version whose seed derives real tokens, for every scenario below except the
 * landing-to-workspace link, which needs a record the app itself produced.
 *
 * Parsed through `BrandRecordSchema` before anything writes it to IndexedDB, so a shape this schema
 * has moved past fails here, loudly, rather than as a silent mismatch the app's own read-back trips
 * over later. `sourceImageId` on the seed's one key color has to name an id this record's `images`
 * actually carries, or the same schema's refinement rejects the fixture outright.
 */
function buildRecordWithOneVersion(): BrandRecord {
	const createdAt = new Date().toISOString();

	return BrandRecordSchema.parse({
		id: randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		images: [
			{ id: 'img-1', downscaled: 'data:image/png;base64,AAAA', originalHash: 'sha256-fixture' },
		],
		versions: [
			{
				createdAt,
				ordinal: 1,
				seed: FIXTURE_SEED,
				tokenSet: null,
				provider: 'cambium-e2e-fixture',
				model: 'cambium-e2e-fixture',
				promptVersion: 'cambium-e2e-fixture',
				rawResponse: 'raw model output held by the e2e fixture',
				scaleEngine: 'cambium-oklch-1',
				fontTable: { source: 'cambium-e2e-fixture', version: '1' },
				interpretation: 'balanced',
			},
		],
	});
}

/**
 * Writes a record straight into the `records` object store, bypassing `RecordStore` and the app's
 * own save path entirely. `open`'s dynamic import of `app/storage/indexed-db-record-store` only
 * ever calls `openDB` without a version, so this opens at the same version `DATABASE_VERSION`
 * names, `1`, and creates the store the same way `createIndexedDbRecordStore`'s `upgrade` callback
 * does, so an app-side open right after this finds a database already at the version it expects
 * rather than one negotiating a bump.
 *
 * Runs through `page.evaluate` because IndexedDB is scoped to a page's origin, not to this Node
 * process. It has to be called only once `page` already sits on the served origin, which every
 * scenario below gets for free from `cleanIndexedDb` in `./fixtures.ts`, an `auto` fixture that has
 * already navigated there and back before the scenario body starts.
 */
async function seedWorkspaceRecord(page: Page, record: BrandRecord): Promise<void> {
	await page.evaluate(
		async ([databaseName, storeName, storedRecord]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, 1);

				request.addEventListener('upgradeneeded', () => {
					request.result.createObjectStore(storeName, { keyPath: 'id' });
				});
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(storeName, 'readwrite');
					tx.objectStore(storeName).put(storedRecord);
					tx.addEventListener('complete', () => resolve());
					tx.addEventListener('error', () => reject(tx.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, record] as const,
	);
}

/**
 * `Locator.boundingBox()` types its result nullable for an element that isn't rendered, which each
 * geometry scenario below has already ruled out with a `toBeVisible()` wait. This gives that
 * guarantee a type the comparisons can read without repeating the null check at every call.
 */
async function requireBox(
	locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await locator.boundingBox();
	if (!box) throw new Error('expected the element to have a bounding box');
	return box;
}

test('the seed section sits above a non-empty token list in the left rail', async ({ page }) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const seedSection = page.getByRole('region', { name: 'Seed' });
	const tokensSection = page.getByRole('region', { name: 'Tokens' });
	const tokenRows = tokensSection.getByRole('listitem');

	await expect(tokenRows.first()).toBeVisible();
	expect(await tokenRows.count()).toBeGreaterThan(0);

	const seedBox = await requireBox(seedSection);
	const tokensBox = await requireBox(tokensSection);

	// Both sections live in the same flex column, so a smaller top offset is what "above" comes
	// down to for two boxes that never overlap in that column.
	expect(seedBox.y).toBeLessThan(tokensBox.y);
});

test('the output column exposes preview, accessibility and export as tabs', async ({ page }) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	await expect(page.getByRole('tablist')).toBeVisible();

	for (const name of ['Preview', 'Accessibility', 'Export']) {
		const tab = page.getByRole('tab', { name });

		await tab.click();

		await expect(tab).toHaveAttribute('aria-selected', 'true');
		// Scoped by the same name as the tab, not just role: base-ui's exit transition leaves the
		// previous panel in the DOM, `inert` but not yet `hidden`, for as long as its own animation
		// runs, so an unscoped `getByRole('tabpanel')` can resolve to two elements mid-switch. Each
		// panel's `aria-labelledby` points at its own tab, so its accessible name is that tab's name.
		await expect(page.getByRole('tabpanel', { name })).toBeVisible();
	}
});

test('switching the interpretation preset re-derives tokens and makes no network request', async ({
	page,
}) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	const requestUrls: string[] = [];
	// Attached before the navigation that follows, so it also catches the initial load's own
	// requests; those are only read for their count, never asserted against, which is what makes the
	// count taken right before the switch below a clean baseline regardless of how many of them
	// there were.
	page.on('request', (request) => requestUrls.push(request.url()));

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const tokenRows = page.getByRole('region', { name: 'Tokens' }).getByRole('listitem');
	await expect(tokenRows.first()).toBeVisible();

	const requestsBeforeSwitch = requestUrls.length;

	// `PRESET_PARAMS` in `app/state/workspace-store.ts` maps every preset to the same `BALANCED`
	// params until #37, so this proves the re-derive path stays offline rather than proving the two
	// presets disagree.
	await page.getByLabel('Interpretation').selectOption('faithful');

	await expect(tokenRows.first()).toBeVisible();
	expect(await tokenRows.count()).toBeGreaterThan(0);

	// `selectPreset` recomputes synchronously, so nothing async should still be in flight after a
	// short wait; this only gives a stray request room to show up before the count is read.
	await page.waitForTimeout(300);

	expect(requestUrls.length).toBe(requestsBeforeSwitch);
});

test('the raw response sits closed at the bottom of the page, below both columns', async ({
	page,
}) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// `components/workspace/raw-response.tsx` renders one `<details>` with no `open` attribute.
	// Located by tag rather than by role: HTML's own accessibility mapping for `<details>` is not a
	// stable enough target, where the `open` DOM property is.
	const details = page.locator('details');
	const rail = page.getByRole('complementary', { name: 'Seed and tokens' });
	const output = page.getByRole('region', { name: 'Output' });

	await expect(details).toBeVisible();
	await expect(details).toHaveJSProperty('open', false);

	// The issue puts it "at the bottom", apart from the rail's two sections, so its top edge has to
	// clear the bottom of both columns at either width. Inside the rail it would start above the
	// rail's bottom edge, and inside the output column above that column's.
	for (const width of [1280, 375]) {
		await page.setViewportSize({ width, height: 900 });

		const detailsBox = await requireBox(details);
		const railBox = await requireBox(rail);
		const outputBox = await requireBox(output);

		expect(detailsBox.y).toBeGreaterThanOrEqual(railBox.y + railBox.height - 1);
		expect(detailsBox.y).toBeGreaterThanOrEqual(outputBox.y + outputBox.height - 1);
	}
});

test('the layout collapses to one column narrow and sits side by side from md up', async ({
	page,
}) => {
	const record = buildRecordWithOneVersion();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const rail = page.getByRole('complementary', { name: 'Seed and tokens' });
	const output = page.getByRole('region', { name: 'Output' });

	await expect(rail).toBeVisible();
	await expect(output).toBeVisible();

	// Below Tailwind's `md` breakpoint (768px), `components/workspace/shell.tsx`'s grid is
	// `grid-cols-1`, so the two boxes stack.
	await page.setViewportSize({ width: 375, height: 900 });
	const narrowRail = await requireBox(rail);
	const narrowOutput = await requireBox(output);

	expect(narrowOutput.y).toBeGreaterThanOrEqual(narrowRail.y + narrowRail.height - 1);

	// At 1280px the grid switches to `md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]`, so the columns
	// sit beside each other: the output box starts at or after the rail's right edge, and the two
	// boxes share vertical space rather than one starting where the other ends.
	await page.setViewportSize({ width: 1280, height: 900 });
	const wideRail = await requireBox(rail);
	const wideOutput = await requireBox(output);

	expect(wideOutput.x).toBeGreaterThanOrEqual(wideRail.x + wideRail.width - 1);
	expect(wideOutput.y).toBeLessThan(wideRail.y + wideRail.height);
	expect(wideRail.y).toBeLessThan(wideOutput.y + wideOutput.height);
});

/** A minimal valid PNG, the same single black pixel `e2e/indexeddb.spec.ts` inlines for the same reason: `prepareReferenceImage` decodes through the browser's real `createImageBitmap`, which only real PNG bytes satisfy. */
const ONE_PIXEL_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('a saved record links to its workspace, which opens reporting no versions yet', async ({
	page,
}) => {
	await page.goto('/');

	await page.getByLabel('Reference images').setInputFiles({
		name: 'brand.png',
		mimeType: 'image/png',
		buffer: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
	});

	// State, not copy: `components/landing/upload-form.tsx` disables the submit button until a
	// picked file has decoded, so waiting on that state is what proves the image landed without
	// reading anything the button says.
	const saveButton = page.getByRole('button', { name: 'Save these references' });
	await expect(saveButton).toBeEnabled();
	await saveButton.click();

	// `components/landing/landing-route.tsx` calls `router.replace` with the saved id once the
	// write's read-back resolves, so the address bar is where "the saved id" comes from, independent
	// of anything the found outcome then renders.
	await expect(page).toHaveURL(new RegExp(`[?&]${RECORD_PARAM}=`));
	const savedId = new URL(page.url()).searchParams.get(RECORD_PARAM);
	if (!savedId) throw new Error('expected a record id in the address bar after saving');

	// Located by its `href`, never by the link's text: Task 3's own decision says browser checks
	// assert where this link points, not what it says.
	const workspaceLink = page.locator(`a[href*="/workspace?${RECORD_PARAM}="]`);
	await expect(workspaceLink).toHaveAttribute('href', new RegExp(`${RECORD_PARAM}=${savedId}$`));

	await workspaceLink.click();

	await expect(page).toHaveURL(new RegExp(`${RECORD_PARAM}=${savedId}$`));

	// No versions yet: `components/workspace/seed-rail.tsx` renders no `<dl>` when the seed is null,
	// `components/workspace/token-list.tsx` renders no list rows when `derived` is null, and
	// `components/workspace/shell.tsx` renders no `RawResponse` at all when there is no active
	// version. Each is a presence check, not a reading of what any of them say.
	await expect(page.locator('dl')).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Tokens' }).getByRole('listitem')).toHaveCount(0);
	await expect(page.locator('details')).toHaveCount(0);
});
