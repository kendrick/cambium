import { randomUUID } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import {
	type BrandRecord,
	BrandRecordSchema,
	FIRST_REVISION,
	SCHEMA_VERSION,
} from '../core/brand-record';
import type { BrandSeed } from '../core/brand-seed';
import { defaultSeedPins } from '../core/seed-pins';

import { makePng } from './fixtures/png';

import { expect, test } from './fixtures';

/**
 * Spelled out rather than imported: `components/stored-record.tsx` owns the constant, and every
 * other spec in this tree has its own copy for the same reason. A rename should fail whichever
 * spec forgot to move with it, not silently agree with the others.
 */
const RECORD_PARAM = 'record';

/** A real PNG, so a downscaled reference image has pixels the browser actually lays out at a size worth measuring against. `makePng` is #105's byte-level generator; nothing here decodes what it writes, keeping this fixture independent of the parser the scenarios below drive through the browser. */
function pngDataUrl(width: number, height: number): string {
	return `data:image/png;base64,${Buffer.from(makePng(width, height)).toString('base64')}`;
}

const IMAGE_1 = {
	id: 'img-1',
	downscaled: pngDataUrl(240, 160),
	originalHash: 'sha256-fixture-1',
	tag: 'logo' as const,
};

const IMAGE_2 = {
	id: 'img-2',
	downscaled: pngDataUrl(180, 120),
	originalHash: 'sha256-fixture-2',
	tag: 'ui' as const,
};

/**
 * Every field stated, so each scenario below finds a live control rather than the "Not read from
 * the images" branch. Two key colours: one with a source region, to measure against, and one
 * without, for the "whole image" branch. Two images: one whose tag disagrees with the model's own
 * reading, one that agrees, so the disagreement scenario has both a positive and a negative case
 * from the same record.
 */
const SEED: BrandSeed = {
	keyColors: [
		{
			oklch: [0.6231, 0.188, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: { x: 0.2, y: 0.15, width: 0.3, height: 0.4 },
		},
		{
			oklch: [0.55, 0.15, 30],
			proposedRole: 'accent',
			sourceImageId: 'img-2',
			sourceRegion: null,
		},
	],
	neutralTemperature: { hue: 250, chroma: 0.01 },
	radiusCharacter: { base: 8, progression: 'soft' },
	shadowCharacter: { spread: 'tight', tintFromSurface: false },
	trackingFeel: 'normal',
	typeClassification: {
		category: 'sans',
		tone: 'grotesque',
		xHeight: 'medium',
		displayDiffersFromBody: false,
	},
	suggestedPairing: {
		display: [
			{ provenance: 'derived', family: 'Inter', score: 90, rationale: 'Matches the sans tone.' },
			{ provenance: 'derived', family: 'Roboto', score: 70, rationale: 'A safe fallback.' },
		],
		body: [
			{ provenance: 'derived', family: 'Inter', score: 90, rationale: 'Matches the sans tone.' },
		],
		mono: [],
	},
	typeScaleRatio: 1.25,
	imageClassifications: [
		// Tagged "logo", read as "photo": the disagreement scenario's positive case.
		{ imageId: 'img-1', detected: 'photo' },
		// Tagged "ui", read as "ui": the negative case, from the same record.
		{ imageId: 'img-2', detected: 'ui' },
	],
	expressive: [{ axis: 'Calm', score: 60 }],
};

/**
 * A record holding one version whose seed derives real tokens. Parsed through `BrandRecordSchema`
 * before anything writes it to IndexedDB, the same guard the other specs' builders apply, so a
 * shape the schema has moved past fails here rather than as a silent mismatch on read-back. The
 * literal is also held to `BrandRecord` at compile time: `parse` takes `unknown`, so without that a
 * new required field only surfaces once a browser run trips over it.
 */
function buildRecordWithSeed(seed: BrandSeed = SEED): BrandRecord {
	const createdAt = new Date().toISOString();

	return BrandRecordSchema.parse({
		id: randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl: null,
		images: [IMAGE_1, IMAGE_2],
		versions: [
			{
				createdAt,
				ordinal: 1,
				seed,
				tokenSet: null,
				provider: 'cambium-e2e-fixture',
				model: 'cambium-e2e-fixture',
				promptVersion: 'cambium-e2e-fixture',
				rawResponse: 'raw model output held by the e2e fixture',
				scaleEngine: 'cambium-oklch-1',
				fontTable: { source: 'cambium-e2e-fixture', version: '1' },
				interpretation: 'balanced',
				overrides: [],
				// Every key colour starts pinned, the same as a freshly generated version: `defaultSeedPins`
				// is the store's own rule for what a version from generation carries, and this fixture
				// stands in for one.
				pins: defaultSeedPins(seed),
			},
		],
	} satisfies BrandRecord);
}

/**
 * Writes one row straight into the `records` object store, bypassing `RecordStore` entirely, the
 * same mechanism the other specs use and for the same reason: IndexedDB is scoped to the page's
 * origin, not to this Node process, so the write has to run inside the page.
 */
async function writeIndexedDbRow(page: Page, value: unknown): Promise<void> {
	await page.evaluate(
		async ([databaseName, storeName, storedValue]) => {
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
					tx.objectStore(storeName).put(storedValue);
					tx.addEventListener('complete', () => resolve());
					tx.addEventListener('error', () => reject(tx.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, value] as const,
	);
}

async function seedWorkspaceRecord(page: Page, record: BrandRecord): Promise<void> {
	await writeIndexedDbRow(page, record);
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

/** A geometry check within a pixel, the same tolerance the workspace's own layout scenarios use for a box built from CSS percentages rather than an exact number. */
function expectWithinOnePixel(actual: number, expected: number, label: string): void {
	expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(1);
}

type Rgb = readonly [number, number, number];

/**
 * The pixel at the centre of whatever `target` covers on screen, decoded from a real screenshot.
 * A computed style is only what the cascade declared; the screenshot is what the compositor
 * actually produced onto the page, which is the consumer whose units this repaint scenario has to
 * measure in.
 */
async function paintedCentre(target: Locator): Promise<Rgb> {
	const png = PNG.sync.read(await target.screenshot({ animations: 'disabled' }));
	const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;

	return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

/** The largest per-channel gap between two paints. Two renders of one colour can land a unit apart after rounding, so a scenario allows 1. */
function paintDistance(actual: Rgb, expected: Rgb): number {
	return Math.max(...actual.map((channel, index) => Math.abs(channel - expected[index]!)));
}

test("editing the brand key colour's lightness repaints the preview's primary action, with no network request", async ({
	page,
}) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	const requestUrls: string[] = [];
	// Attached before the navigation, so it also catches the initial load's own requests; those are
	// only read for their count, never asserted against, which is what makes the count taken right
	// before the edit below a clean baseline regardless of how many of them there were.
	page.on('request', (request) => requestUrls.push(request.url()));

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// `components/workspace/preview/app-screen.tsx` marks this button as the sample screen's own
	// primary action; its colour comes from the same `--primary` custom property the token list's
	// swatch reads, which resolves to the brand ramp's step 9, which is exactly the step a key
	// colour's own OKLCH values land on.
	const primaryAction = page.locator('[data-preview-part="primary-action"]');
	await expect(primaryAction).toBeVisible();

	const before = await paintedCentre(primaryAction);
	const requestsBeforeEdit = requestUrls.length;

	await page.getByRole('button', { name: 'Edit brand key colour' }).click();

	const lightness = page.getByLabel('brand key colour lightness value', { exact: true });
	await lightness.fill('0.25');
	await lightness.blur();

	await page.keyboard.press('Escape');

	await expect
		.poll(async () => paintDistance(await paintedCentre(primaryAction), before))
		.toBeGreaterThan(1);

	expect(requestUrls.length).toBe(requestsBeforeEdit);
});

test('a pin toggled without saving reverts on reload, and holds once saved', async ({ page }) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const radiusPin = () => page.getByRole('button', { name: 'Pin radius' });
	await expect(radiusPin()).toHaveAttribute('aria-pressed', 'false');

	await radiusPin().click();
	await expect(radiusPin()).toHaveAttribute('aria-pressed', 'true');

	// Never saved: the toggle is uncommitted draft state, so a fresh load reads back the saved
	// version's own pins, which never included this one.
	await page.reload();
	await expect(radiusPin()).toHaveAttribute('aria-pressed', 'false');

	await radiusPin().click();
	await expect(radiusPin()).toHaveAttribute('aria-pressed', 'true');

	const save = page.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	// A pin toggle alone doesn't hand-edit the seed, so this commit needs no provenance and settles
	// straight to "not dirty"—disabled again, with its label back to "Save" rather than "Saving…".
	await expect(save).toBeDisabled();

	await page.reload();
	await expect(radiusPin()).toHaveAttribute('aria-pressed', 'true');
});

test("a pinned field's value is unchanged by a preset switch", async ({ page }) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const radiusPin = page.getByRole('button', { name: 'Pin radius' });
	await radiusPin.click();
	await expect(radiusPin).toHaveAttribute('aria-pressed', 'true');

	const radiusBase = page.getByLabel('Radius base', { exact: true });
	await expect(radiusBase).toHaveValue('8');

	// `PRESET_PARAMS` maps every preset to the same `BALANCED` params until #37, so no preset moves a
	// seed value today; the pin's guarantee is structural rather than observable through a value that
	// actually changes. The switch itself still has to complete and the control still has to keep
	// reading the same number, which is what these assertions check.
	await page.getByLabel('Interpretation').selectOption('faithful');
	await expect(page.getByLabel('Interpretation')).toHaveValue('faithful');
	await expect(radiusBase).toHaveValue('8');
	await expect(radiusPin).toHaveAttribute('aria-pressed', 'true');

	await page.getByLabel('Interpretation').selectOption('balanced');
	await expect(page.getByLabel('Interpretation')).toHaveValue('balanced');
	await expect(radiusBase).toHaveValue('8');
});

test("showing a key colour's source draws the region box at the stored fraction, and a colour with no region shows the whole image", async ({
	page,
}) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	await page.getByRole('button', { name: 'Show source of brand key colour' }).click();

	const image = page.locator('[data-source-image] img');
	const region = page.locator('[data-source-region]');
	await expect(image).toBeVisible();
	await expect(region).toBeVisible();

	const imageBox = await requireBox(image);
	const regionBox = await requireBox(region);
	const stored = SEED.keyColors![0]!.sourceRegion!;

	expectWithinOnePixel(regionBox.x, imageBox.x + stored.x * imageBox.width, 'region left');
	expectWithinOnePixel(regionBox.y, imageBox.y + stored.y * imageBox.height, 'region top');
	expectWithinOnePixel(regionBox.width, stored.width * imageBox.width, 'region width');
	expectWithinOnePixel(regionBox.height, stored.height * imageBox.height, 'region height');

	await page.getByRole('button', { name: 'Close' }).click();
	await expect(region).toHaveCount(0);

	await page.getByRole('button', { name: 'Show source of accent key colour' }).click();
	await expect(
		page.getByText(
			'The model named this image but recorded no region, so the whole image is shown.',
		),
	).toBeVisible();
	await expect(page.locator('[data-source-region]')).toHaveCount(0);
});

test('an image whose tag disagrees with the model shows both readings, and one that agrees shows nothing', async ({
	page,
}) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// Only img-1 (tagged logo, read as photo) disagrees; img-2 (tagged ui, read as ui) agrees and
	// renders nothing at all, per `TagDisagreements`' early return for an empty list.
	await expect(page.locator('[data-tag-disagreement]')).toHaveCount(1);
	await expect(page.locator('[data-tag-disagreement="img-1"]')).toContainText(
		'Image 1: you tagged this logo; the model read it as photo.',
	);
	await expect(page.locator('[data-tag-disagreement="img-2"]')).toHaveCount(0);
});

test('discard restores every edited field and pin to the active version', async ({ page }) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const discard = page.getByRole('button', { name: 'Discard' });
	const save = page.getByRole('button', { name: 'Save', exact: true });
	await expect(discard).toBeDisabled();
	await expect(save).toBeDisabled();

	const radiusBase = page.getByLabel('Radius base', { exact: true });
	const ratio = page.getByLabel('Type scale ratio', { exact: true });
	const radiusPin = page.getByRole('button', { name: 'Pin radius' });

	await radiusBase.fill('20');
	await radiusBase.blur();
	await ratio.fill('1.5');
	await ratio.blur();
	await radiusPin.click();

	await expect(radiusBase).toHaveValue('20');
	await expect(ratio).toHaveValue('1.5');
	await expect(radiusPin).toHaveAttribute('aria-pressed', 'true');
	await expect(discard).toBeEnabled();
	await expect(save).toBeEnabled();

	await discard.click();

	await expect(radiusBase).toHaveValue('8');
	await expect(ratio).toHaveValue('1.25');
	await expect(radiusPin).toHaveAttribute('aria-pressed', 'false');
	await expect(discard).toBeDisabled();
	await expect(save).toBeDisabled();
});

test('choosing a display font puts it first as an invented pick, which survives save and reload', async ({
	page,
}) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const select = page.getByLabel('Display font', { exact: true });
	const selectedOptionText = () =>
		select.evaluate(
			(element) => (element as HTMLSelectElement).selectedOptions[0]?.textContent ?? '',
		);

	// The seed ranks Inter (90) ahead of Roboto (70), and the model's own order is what an untouched
	// control should show first.
	expect(await selectedOptionText()).toContain('Inter');

	// Option values are candidate indices (`components/workspace/seed-rail/field-editors.tsx`), so
	// "1" is Roboto, the second-ranked candidate, before this pick moves it.
	await select.selectOption('1');

	await expect.poll(selectedOptionText).toContain('Roboto');
	expect(await selectedOptionText()).toContain('your pick');

	const save = page.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	await expect(save).toBeDisabled();

	await page.reload();

	await expect(page.getByLabel('Display font', { exact: true })).toBeVisible();
	await expect.poll(selectedOptionText).toContain('Roboto');
	expect(await selectedOptionText()).toContain('your pick');
});
