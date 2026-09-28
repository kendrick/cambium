import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import {
	type BrandRecord,
	BrandRecordSchema,
	FIRST_REVISION,
	SCHEMA_VERSION,
} from '../core/brand-record';
import type { BrandSeed } from '../core/brand-seed';
import { defaultSeedPins } from '../core/seed-pins';

import { expect, test } from './fixtures';

/**
 * Copied from `e2e/seed-rail.spec.ts` (`SEED`, `buildRecordWithSeed`, `seedWorkspaceRecord`, plus
 * the fixture images they need) rather than imported: #37's open run owns that file, and importing
 * a spec file would register its tests twice. Once #37 lands, a follow-up can fold this scenario
 * back in and drop the copy.
 */
const RECORD_PARAM = 'record';

const IMAGE_1 = {
	id: 'img-1',
	downscaled:
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	originalHash: 'sha256-fixture-1',
	tag: 'logo' as const,
};

const IMAGE_2 = {
	id: 'img-2',
	downscaled:
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	originalHash: 'sha256-fixture-2',
	tag: 'ui' as const,
};

/**
 * Ranks Display as Inter (90) and Roboto (70), gives Body Inter (90) alone, and leaves Mono empty.
 * That puts Display and Body on the select branch and Mono on the typed `FamilyInput` branch, so
 * one record reaches both.
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
		{ imageId: 'img-1', detected: 'photo' },
		{ imageId: 'img-2', detected: 'ui' },
	],
	expressive: [{ axis: 'Calm', score: 60 }],
};

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
				pins: defaultSeedPins(seed),
			},
		],
	} satisfies BrandRecord);
}

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

test("the font pairing field says it is a suggestion that isn't exported, on screen and in each control's description", async ({
	page,
}) => {
	const record = buildRecordWithSeed();
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// Spelled out rather than imported from field-editors.tsx. The criterion is about what a person
	// reads, so rewording the note should fail here and get re-approved, not pass by construction.
	const note = "This pairing is a suggestion. It isn't exported, and the preview doesn't use it.";

	const row = page.locator('[data-seed-field="suggestedPairing"]');
	await expect(row.getByText(note, { exact: true })).toBeVisible();

	// `SEED` gives Display and Body ranked candidates and Mono none, so this covers the select branch
	// and the typed-family branch. Both have to carry the description.
	await expect(row.getByLabel('Display font', { exact: true })).toHaveAccessibleDescription(note);
	await expect(row.getByLabel('Body font', { exact: true })).toHaveAccessibleDescription(note);
	await expect(row.getByLabel('Mono font', { exact: true })).toHaveAccessibleDescription(note);

	// A pick rewrites the slot's candidates. The description has to survive that.
	await row.getByLabel('Display font', { exact: true }).selectOption('1');
	await expect(row.getByLabel('Display font', { exact: true })).toHaveAccessibleDescription(note);
});
