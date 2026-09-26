import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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
				// Every key colour starts pinned, the same as a freshly generated version: `saveGeneratedVersion`
				// (`app/generation/generate.ts`) applies `defaultSeedPins` to every version it writes, and
				// this fixture stands in for one.
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
 * Reads every stored row through raw IndexedDB, the same reason `writeIndexedDbRow` above bypasses
 * `RecordStore`: the store is only reachable from inside the page. Parsed through
 * `BrandRecordSchema` on the way out, so a save that wrote a shape the schema has moved past fails
 * here rather than passing a comparison that only checks the fields this spec happens to read.
 */
async function readStoredRecord(page: Page, recordId: string): Promise<BrandRecord | undefined> {
	const rows = await page.evaluate(
		async ([databaseName, storeName]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, 1);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				return await new Promise<unknown[]>((resolve, reject) => {
					const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
					request.addEventListener('success', () => resolve(request.result as unknown[]));
					request.addEventListener('error', () => reject(request.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME] as const,
	);

	const match = rows.find((row) => (row as { id?: string }).id === recordId);

	return match ? BrandRecordSchema.parse(match) : undefined;
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
	// Attached before the navigation, so it also sees the initial load's requests. Those only feed
	// the count taken just before the edit below, which stays a clean baseline however many there
	// were.
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

test("editing the disagreeing image's classification swaps the note to neutral wording, unsaved and saved alike", async ({
	page,
}) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	await page.getByLabel('Image 1 classification').selectOption('artwork');

	// The draft no longer matches what the model actually reported for this image, so crediting
	// "the model" here would pin a person's own edit on it.
	await expect(page.locator('[data-tag-disagreement="img-1"]')).toContainText(
		'Image 1: you tagged this logo; the seed has it as artwork.',
	);

	const save = page.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	await expect(save).toBeDisabled();
	await page.reload();

	// Saved as a hand edit, so the value now matches the active version too, but that version
	// carries no model reading of its own to credit, and the note stays neutral rather than
	// flipping back to "the model".
	await expect(page.locator('[data-tag-disagreement="img-1"]')).toContainText(
		'Image 1: you tagged this logo; the seed has it as artwork.',
	);
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

test('a hand-typed family in an empty slot can still be corrected by typing, and the correction survives save and reload', async ({
	page,
}) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// The seed's mono slot has no candidates (`SEED.suggestedPairing.mono`), so this starts as the
	// text-entry path rather than a select.
	const monoFont = page.getByLabel('Mono font', { exact: true });
	await expect(monoFont).toBeVisible();

	await monoFont.fill('Courier Prime');
	await monoFont.blur();
	await expect(monoFont).toHaveValue('Courier Prime');

	// The regression this guards: once a hand-entered family is the slot's only candidate, the old
	// code replaced this input with a select holding just that one pick, with no way back to typing.
	await monoFont.fill('Courier New');
	await monoFont.blur();
	await expect(monoFont).toHaveValue('Courier New');

	const save = page.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	await expect(save).toBeDisabled();

	await page.reload();

	// Still a textbox after reload, prefilled with the corrected pick, and still open to another
	// correction rather than frozen as a select.
	await expect(page.getByLabel('Mono font', { exact: true })).toHaveValue('Courier New');

	const stored = await readStoredRecord(page, record.id);
	expect(stored?.versions.at(-1)?.seed?.suggestedPairing?.mono).toEqual([
		{ provenance: 'invented', family: 'Courier New', score: null, rationale: expect.any(String) },
	]);
});

test('a checkbox toggle, a moved expressive range, and a new expressive axis all persist through save and reload', async ({
	page,
}) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const displayDiffers = page.getByLabel('Display differs from body');
	await expect(displayDiffers).not.toBeChecked();
	await displayDiffers.check();
	await expect(displayDiffers).toBeChecked();

	const expressiveRow = page.locator('[data-seed-field="expressive"]');
	const scoredAxisOrder = () =>
		expressiveRow
			.locator('input[type="range"]')
			.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));

	const calmScore = page.getByLabel('Calm score');
	await calmScore.fill('20');
	await expect(calmScore).toHaveValue('20');

	await expressiveRow.getByLabel('Add an expressive axis').selectOption('Playful');

	// `ExpressiveEditor` (components/workspace/seed-rail/field-editors.tsx) re-sorts on every change
	// through `ranked`, so Playful's default score of 50 outranks Calm's 20 and lands first, the
	// order `rankedByExpressiveScore` (core/brand-seed.ts) requires of whatever gets saved.
	await expect.poll(scoredAxisOrder).toEqual(['Playful score', 'Calm score']);
	await expect(page.getByLabel('Playful score')).toHaveValue('50');

	const save = page.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	await expect(save).toBeDisabled();

	await page.reload();

	await expect(page.getByLabel('Display differs from body')).toBeChecked();
	await expect.poll(scoredAxisOrder).toEqual(['Playful score', 'Calm score']);
	await expect(page.getByLabel('Playful score')).toHaveValue('50');
	await expect(page.getByLabel('Calm score')).toHaveValue('20');

	const stored = await readStoredRecord(page, record.id);
	const savedSeed = stored?.versions.at(-1)?.seed;

	expect(savedSeed?.typeClassification?.displayDiffersFromBody).toBe(true);
	expect(savedSeed?.expressive).toEqual([
		{ axis: 'Playful', score: 50 },
		{ axis: 'Calm', score: 20 },
	]);
});

/**
 * Clicks one Export-tab download and hands back what landed on disk. The export is the consumer
 * here: it's the DTCG and CSS a person actually takes away, so a shadow that moved shows up in
 * these bytes whatever the token set in memory claims.
 */
async function downloadedText(page: Page, filename: string): Promise<string> {
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: `Download ${filename}`, exact: true }).click(),
	]);
	const path = await download.path();

	if (path === null) throw new Error(`download of ${filename} produced no saved file`);

	return readFile(path, 'utf-8');
}

type ShadowGroup = Record<string, { $value: unknown; $extensions?: unknown }>;

async function exportedShadows(page: Page): Promise<{
	light: ShadowGroup;
	dark: ShadowGroup;
	cssShadowLines: string[];
}> {
	const light = JSON.parse(await downloadedText(page, 'light.tokens.json')) as {
		shadow: ShadowGroup;
	};
	const dark = JSON.parse(await downloadedText(page, 'dark.tokens.json')) as {
		shadow: ShadowGroup;
	};
	const css = await downloadedText(page, 'tokens.css');

	return {
		light: light.shadow,
		dark: dark.shadow,
		cssShadowLines: css.split('\n').filter((line) => /^\s*--[\w-]*shadow[\w-]*:/.test(line)),
	};
}

const valuesOf = (group: ShadowGroup) =>
	Object.fromEntries(Object.entries(group).map(([step, token]) => [step, token.$value]));

test('setting a missing shadow character leaves every exported shadow value where it was, and the set value survives save and reload', async ({
	page,
}) => {
	const record = buildRecordWithSeed({ ...SEED, shadowCharacter: null });
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);
	await page.getByRole('tab', { name: 'Export' }).click();

	const before = await exportedShadows(page);
	// Guards the premise: an empty group would compare equal to anything.
	expect(Object.keys(before.light)).toEqual(['xs', 'sm', 'md', 'lg', 'xl']);
	expect(before.cssShadowLines.length).toBeGreaterThan(0);

	await page.getByRole('button', { name: 'Set shadow' }).click();
	// Visible is enough to know Set landed. Which spread it chose is checked after the export, so a
	// wrong default fails on the shadows it moved rather than on its name.
	await expect(page.getByLabel('Shadow spread')).toBeVisible();

	const after = await exportedShadows(page);

	expect(valuesOf(after.light)).toEqual(valuesOf(before.light));
	expect(valuesOf(after.dark)).toEqual(valuesOf(before.dark));
	expect(after.cssShadowLines).toEqual(before.cssShadowLines);
	await expect(page.getByLabel('Shadow spread')).toHaveValue('normal');

	// Provenance is the one thing Set should move: the shadow now names the field a person stated
	// rather than inheriting the page surface's, which this seed traces to `neutralTemperature`.
	expect(before.light.md!.$extensions).toMatchObject({
		'com.cambium': { seedField: 'neutralTemperature' },
	});
	expect(after.light.md!.$extensions).toMatchObject({
		'com.cambium': { provenance: 'derived', seedField: 'shadowCharacter' },
	});

	const save = page.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	await expect(save).toBeDisabled();

	await page.reload();
	await expect(page.getByLabel('Shadow spread')).toHaveValue('normal');

	const stored = await readStoredRecord(page, record.id);
	expect(stored?.versions.at(-1)?.seed?.shadowCharacter).toEqual({
		spread: 'normal',
		tintFromSurface: true,
	});
});

test('an empty classification list still offers every reference image, and a classification added to one survives save and reload', async ({
	page,
}) => {
	const record = buildRecordWithSeed({ ...SEED, imageClassifications: [] });
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const image1 = page.getByLabel('Image 1 classification');
	const image2 = page.getByLabel('Image 2 classification');
	await expect(image1).toHaveValue('');
	await expect(image2).toHaveValue('');
	// Nothing classified, so nothing can disagree with the person's tags yet.
	await expect(page.locator('[data-tag-disagreement]')).toHaveCount(0);

	await image2.selectOption('artwork');
	await expect(image2).toHaveValue('artwork');
	await expect(image1).toHaveValue('');
	// img-2 is tagged "ui", so the new entry disagrees and the note has to follow it.
	await expect(page.locator('[data-tag-disagreement="img-2"]')).toContainText(
		'Image 2: you tagged this ui; the seed has it as artwork.',
	);

	const save = page.getByRole('button', { name: 'Save', exact: true });
	await save.click();
	await expect(save).toBeDisabled();

	await page.reload();
	await expect(page.getByLabel('Image 2 classification')).toHaveValue('artwork');
	await expect(page.getByLabel('Image 1 classification')).toHaveValue('');

	const stored = await readStoredRecord(page, record.id);
	expect(stored?.versions.at(-1)?.seed?.imageClassifications).toEqual([
		{ imageId: 'img-2', detected: 'artwork' },
	]);

	// A classification added by mistake has to come back out, or Discard after a save restores it.
	await page.getByLabel('Image 2 classification').selectOption('');
	await expect(page.locator('[data-tag-disagreement="img-2"]')).toHaveCount(0);
	await save.click();
	await expect(save).toBeDisabled();

	await page.reload();
	await expect(page.getByLabel('Image 2 classification')).toHaveValue('');
	const cleared = await readStoredRecord(page, record.id);
	expect(cleared?.versions.at(-1)?.seed?.imageClassifications).toEqual([]);
});
