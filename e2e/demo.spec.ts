import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

import photoWindow from '../app/demo/fixtures/photo-window.json' with { type: 'json' };
import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import { type BrandRecord, BrandRecordSchema, FIRST_REVISION } from '../core/brand-record';
import { checkContrast } from '../core/contrast/check';
import { withContrastRepairs } from '../core/contrast/repair';
import { serializeDtcg } from '../core/dtcg/serialize';
import { BALANCED } from '../core/interpretation';
import { createOklchScaleEngine } from '../core/oklch-scale-engine';
import { repairPinsFor } from '../core/seed-pins';
import { buildTokenSet } from '../core/semantic-layer';

import { expect, test } from './fixtures';

/**
 * Typed out rather than imported from `app/demo/demo-fixtures.ts`, so a relabel there fails here.
 * `photo-window` because its unrepaired set fails AA (guarded below), so repair has to run before
 * the Accessibility tab reads clean.
 */
const BUTTON = 'Open the Window photo demo';
const STORED_NAME = 'Window photo (demo)';
const FIXTURE: BrandRecord = BrandRecordSchema.parse(photoWindow);
const VERSION = FIXTURE.versions[0]!;
const SEED = VERSION.seed!;

if (VERSION.interpretation !== 'balanced' || VERSION.overrides.length > 0) {
	throw new Error('photo-window is no longer a plain balanced version; recompute the expected set');
}

const DERIVED = createOklchScaleEngine().generate(SEED, BALANCED);

if (!DERIVED.ok) throw new Error(`photo-window failed to derive: ${DERIVED.error.kind}`);

const BASE = buildTokenSet(DERIVED.schemes, SEED, BALANCED);
// Pinned the way the store pins a stored version (`repairPinsFor(seed, version.pins)`).
const { tokenSet: TOKEN_SET } = withContrastRepairs(BASE, {
	pinned: repairPinsFor(SEED, VERSION.pins),
});

if (checkContrast(BASE).every((entry) => entry.passes)) {
	throw new Error('photo-window no longer needs a repair; pick a fixture that does');
}

/**
 * `export.spec.ts`'s moved-step diff, copied because importing a spec file registers its tests. The
 * steps repair moved, found without the report, which DESIGN.md has to document.
 */
const MOVED_STEPS = (['light', 'dark'] as const).flatMap((scheme) =>
	Object.entries(BASE.schemes[scheme].primitives).flatMap(([ramp, steps]) =>
		steps.flatMap((before, index) => {
			const after = TOKEN_SET.schemes[scheme].primitives[ramp]![index]!;

			return before.l === after.l && before.c === after.c && before.h === after.h
				? []
				: [{ scheme, step: `${ramp}.${index + 1}` }];
		}),
	),
);

// Without a moved step the DESIGN.md loop below checks nothing and passes on an empty section.
if (MOVED_STEPS.length === 0) {
	throw new Error(
		'photo-window fails AA but repair moved no step; the DESIGN.md check would be empty',
	);
}

/** The rows under DESIGN.md's `## Contrast repairs` table, header and rule dropped, split into cells. */
function repairRows(design: string): string[][] {
	return design
		.slice(design.indexOf('## Contrast repairs'))
		.split('\n')
		.filter((line) => line.startsWith('| '))
		.slice(2)
		.map((line) => line.slice(2, -2).split(' | '));
}

/** Every row in the records store, read raw rather than through the app's own store. */
async function readStoredRows(page: Page): Promise<BrandRecord[]> {
	return page.evaluate(
		async ([databaseName, storeName]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);

				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				return await new Promise<BrandRecord[]>((resolve, reject) => {
					const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();

					request.addEventListener('success', () => resolve(request.result as BrandRecord[]));
					request.addEventListener('error', () => reject(request.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME] as const,
	);
}

async function openDemo(page: Page): Promise<string> {
	await page.goto('/');
	await page
		.locator('[data-library-first-run]')
		.getByRole('button', { name: BUTTON, exact: true })
		.click();
	await page.waitForURL(/\/workspace\?record=/);

	const id = new URL(page.url()).searchParams.get('record');

	if (!id) throw new Error('the demo opened no record');

	return id;
}

async function editKeyColorLightness(page: Page, label: string, value: string): Promise<void> {
	await page.getByRole('button', { name: `Edit ${label}` }).click();
	const lightness = page.getByLabel(`${label} lightness value`, { exact: true });
	await lightness.fill(value);
	await lightness.blur();
	await page.keyboard.press('Escape');
}

test('a keyless visitor opens a demo from the landing route and downloads its archive', async ({
	page,
}) => {
	const requests: string[] = [];
	page.on('request', (request) => requests.push(request.url()));

	const id = await openDemo(page);

	expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

	// Loaded from the committed fixture: one fresh record, the fixture's content under a new id.
	const rows = await readStoredRows(page);

	expect(rows).toHaveLength(1);
	expect(rows[0]!.id).toBe(id);
	expect(id).not.toBe(FIXTURE.id);
	expect(rows[0]!.revision).toBe(FIRST_REVISION);
	expect(rows[0]!.name).toBe(STORED_NAME);
	expect(rows[0]!.images).toEqual(FIXTURE.images);
	expect(rows[0]!.versions).toEqual(FIXTURE.versions);
	expect(rows[0]!.incarnation).toMatch(/^[0-9a-f-]{36}$/);

	// Repair ran: this fixture's unrepaired set fails AA (guarded above).
	await page.getByRole('tab', { name: 'Accessibility' }).click();
	await expect(page.getByText('Every declared pair passes AA in both schemes.')).toBeVisible();

	await page.getByRole('tab', { name: 'Export' }).click();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download export.zip', exact: true }).click(),
	]);
	const path = await download.path();

	if (path === null) throw new Error('the archive download produced no saved file');

	const unzipped = unzipSync(new Uint8Array(await readFile(path)));

	expect(strFromU8(unzipped['tokens/light.tokens.json']!)).toBe(
		`${JSON.stringify(serializeDtcg(TOKEN_SET).light, null, 2)}\n`,
	);

	const design = strFromU8(unzipped['DESIGN.md']!);
	const repairTable = repairRows(design);

	expect(design).not.toContain('No repairs were applied.');

	for (const { scheme, step } of MOVED_STEPS) {
		expect(
			repairTable.some(([rowScheme, , moved]) => rowScheme === scheme && moved === step),
			`${scheme} ${step}`,
		).toBe(true);
	}

	const origin = new URL(page.url()).origin;

	expect(requests.filter((url) => url.includes('anthropic'))).toEqual([]);
	expect(requests.filter((url) => !url.startsWith(origin) && !/^(blob|data):/.test(url))).toEqual(
		[],
	);
});

test('preset switching, seed editing and pinning work on a demo record, and a commit to it persists', async ({
	page,
}) => {
	await openDemo(page);

	const danger = page.locator('[data-token="primitive.danger.9"] [data-swatch-value]');
	await expect(danger).toBeVisible();
	const balancedDanger = await danger.textContent();

	// BALANCED holds harmonization at 0 and EXPRESSIVE at 0.15 (core/interpretation.ts), which
	// rotates danger.9 toward the brand hue.
	await page.getByLabel('Interpretation').selectOption('expressive');
	await expect.poll(() => danger.textContent()).not.toBe(balancedDanger);

	const brand = page.locator('[data-token="primitive.brand.9"] [data-swatch-value]');
	const brandBefore = await brand.textContent();

	await editKeyColorLightness(page, 'brand key colour', '0.4');
	await expect.poll(() => brand.textContent()).not.toBe(brandBefore);

	const pin = page.getByRole('button', { name: 'Pin brand key colour' });

	await expect(pin).toHaveAttribute('aria-pressed', 'true');
	await pin.click();
	await expect(pin).toHaveAttribute('aria-pressed', 'false');

	const save = page.getByRole('button', { name: 'Save', exact: true });

	await save.click();
	await expect(save).toBeDisabled();
	await page.reload();

	await expect(pin).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByLabel('Interpretation')).toHaveValue('expressive');

	// Storage took a commit on the record the demo minted, incarnation and all.
	const [row] = await readStoredRows(page);

	expect(row!.versions).toHaveLength(2);
	expect(row!.revision).toBe(FIRST_REVISION + 1);
});

test('the demo entry shows only in the empty library, and the opened demo lists as a saved brand', async ({
	page,
}) => {
	const id = await openDemo(page);

	await page.goto('/');

	await expect(page.locator(`[data-library-row="${id}"]`)).toContainText(STORED_NAME);
	await expect(page.locator('[data-library-first-run]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: BUTTON, exact: true })).toHaveCount(0);
});
