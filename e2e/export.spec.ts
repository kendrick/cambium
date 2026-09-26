import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Download, Page } from '@playwright/test';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import {
	type BrandRecord,
	BrandRecordSchema,
	FIRST_REVISION,
	SCHEMA_VERSION,
} from '../core/brand-record';
import type { BrandSeed } from '../core/brand-seed';
import { withContrastRepairs } from '../core/contrast/repair';
import { toStylesheet } from '../core/css/stylesheet';
import { serializeDtcg } from '../core/dtcg/serialize';
import { exportArtifacts, type ExportArtifact } from '../core/export/artifacts';
import { BALANCED } from '../core/interpretation';
import { createOklchScaleEngine } from '../core/oklch-scale-engine';
import { defaultSeedPins } from '../core/seed-pins';
import { buildTokenSet } from '../core/semantic-layer';
import { applyOverrides, type TokenOverride } from '../core/token-overrides';

import { expect, test } from './fixtures';

/**
 * Spelled out rather than imported from `components/stored-record.tsx`: `workspace.spec.ts` and
 * `token-list.spec.ts` each keep their own copy of this constant for the same reason, so a rename
 * of the query param fails whichever spec forgot to move with it.
 */
const RECORD_PARAM = 'record';

/** `workspace.spec.ts`'s `FIXTURE_SEED`, copied because importing a spec file registers its tests. */
const SEED: BrandSeed = {
	keyColors: [
		{
			oklch: [0.6231, 0.188, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

const DERIVED = createOklchScaleEngine().generate(SEED, BALANCED);

if (!DERIVED.ok) {
	throw new Error(`fixture seed failed to derive: ${DERIVED.error.kind}`);
}

const RAW_TOKEN_SET = buildTokenSet(DERIVED.schemes, SEED, BALANCED);

/**
 * The set the workspace store actually paints (`repairedBase` in `app/state/workspace-store.ts`):
 * derive, then repair contrast. `exportArtifacts` below runs on this token set and never on the
 * page's own copy, so a broken download can't grade itself against its own wrong answer.
 */
const TOKEN_SET = withContrastRepairs(RAW_TOKEN_SET).tokenSet;

/**
 * `core/export/artifacts.test.ts` documents this exact seed as one whose light `brand.1` moves
 * under `withContrastRepairs`. Pinning that here too means the byte comparisons below can only
 * pass if the page served the repaired set: a page stuck on `RAW_TOKEN_SET` would produce bytes
 * that differ from every `expected` this file builds, and this is the one check that would say why.
 */
if (
	JSON.stringify(serializeDtcg(RAW_TOKEN_SET).light) ===
	JSON.stringify(serializeDtcg(TOKEN_SET).light)
) {
	throw new Error('fixture seed no longer repairs a light-scheme colour; pick a seed that does');
}

/**
 * Computed from the adapters directly, not from `exportArtifacts`, so a bug that reorders or
 * corrupts `exportArtifacts`' own output can't grade itself as correct against itself.
 */
const ADAPTER_ORACLE = { ...serializeDtcg(TOKEN_SET), css: toStylesheet(TOKEN_SET) };

/**
 * One record per scenario, so a scenario that mutates its own overrides through the token list
 * can't leak state into another. `brandUrl` and `overrides` are the two things export.spec.ts
 * varies; everything else is the fixture seed's usual shape.
 */
function buildRecord(brandUrl: string | null, overrides: TokenOverride[] = []): BrandRecord {
	return BrandRecordSchema.parse({
		id: randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl,
		images: [
			{
				id: 'img-1',
				downscaled: 'data:image/png;base64,AAAA',
				originalHash: 'sha256-fixture',
				tag: 'auto',
			},
		],
		versions: [
			{
				createdAt: new Date().toISOString(),
				ordinal: 1,
				seed: SEED,
				tokenSet: null,
				provider: 'cambium-e2e-fixture',
				model: 'cambium-e2e-fixture',
				promptVersion: 'cambium-e2e-fixture',
				rawResponse: 'raw model output held by the e2e fixture',
				scaleEngine: 'cambium-oklch-1',
				fontTable: { source: 'cambium-e2e-fixture', version: '1' },
				interpretation: 'balanced',
				overrides,
				pins: defaultSeedPins(SEED),
			},
		],
	} satisfies BrandRecord);
}

/**
 * `workspace.spec.ts`'s `seedWorkspaceRecord`: one row written straight into the records store,
 * opened at the app's database version so the app's own open finds nothing to upgrade.
 */
async function seedWorkspaceRecord(page: Page, record: BrandRecord): Promise<void> {
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
		[DATABASE_NAME, RECORD_STORE_NAME, record] as const,
	);
}

async function openExportTab(page: Page, record: BrandRecord): Promise<void> {
	await seedWorkspaceRecord(page, record);
	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);
	await page.getByRole('tab', { name: 'Export' }).click();
}

/**
 * A download's `Blob` never crosses back into Node, so the only way to read its media type is to
 * catch it on the way out. Patched in right before the click rather than at page load, because the
 * app calls `URL.createObjectURL` on demand and nothing before then, so there's no window in which
 * a real call could slip past an unpatched original.
 */
async function spyOnBlobTypes(page: Page): Promise<void> {
	await page.evaluate(() => {
		const seen: string[] = [];
		const original = URL.createObjectURL.bind(URL);

		(window as Window & { cambiumBlobTypes?: string[] }).cambiumBlobTypes = seen;

		URL.createObjectURL = (object: Blob | MediaSource): string => {
			if (object instanceof Blob) seen.push(object.type);
			return original(object);
		};
	});
}

/** The most recent `Blob` type the spy caught, i.e. the one the click just before it produced. */
async function lastBlobType(page: Page): Promise<string> {
	const types = await page.evaluate(
		() => (window as Window & { cambiumBlobTypes?: string[] }).cambiumBlobTypes ?? [],
	);
	const type = types.at(-1);

	if (type === undefined) throw new Error('no Blob was created for the last download');

	return type;
}

/**
 * Clicks the button named for `filename` and waits out the resulting `download` event, so every
 * scenario reads the same three things off it a real user's save dialog would show: the suggested
 * name, the media type the spy caught, and the bytes actually written to disk.
 */
async function downloadArtifact(
	page: Page,
	filename: string,
): Promise<{ download: Download; bytes: Buffer; blobType: string }> {
	const button = page.getByRole('button', { name: `Download ${filename}`, exact: true });
	const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
	const blobType = await lastBlobType(page);
	const path = await download.path();

	if (path === null) throw new Error(`download of ${filename} produced no saved file`);

	return { download, bytes: await readFile(path), blobType };
}

/**
 * Every artifact's bytes and type checked in one round trip: once against `expected`, computed
 * with the same `exportArtifacts` the app runs, and once against `oracle`, computed with the two
 * adapters directly. `exportArtifacts` sits between the two orders in the array it returns, so
 * position 0 is light and 1 is dark for either check.
 */
async function expectArtifactsMatch(
	page: Page,
	expected: readonly ExportArtifact[],
	oracle: { light: unknown; dark: unknown; css: string },
): Promise<void> {
	await spyOnBlobTypes(page);

	for (const [index, artifact] of expected.entries()) {
		// One click and one `download` event at a time: firing every click together would race their
		// `waitForEvent` calls against events that may land in a different order than the clicks did.
		// oxlint-disable-next-line no-await-in-loop
		const { download, bytes, blobType } = await downloadArtifact(page, artifact.filename);

		expect(download.suggestedFilename(), artifact.filename).toBe(artifact.filename);
		expect(blobType, artifact.filename).toBe(artifact.mediaType);
		// Exact bytes, not a trimmed or decoded comparison: a trailing-newline slip or a stray BOM
		// would still "look equal" under a string comparison that normalized either side first.
		expect(bytes.equals(Buffer.from(artifact.contents, 'utf-8')), artifact.filename).toBe(true);

		if (artifact.mediaType === 'text/css') {
			expect(bytes.toString('utf-8'), artifact.filename).toBe(oracle.css);
		} else {
			expect(JSON.parse(bytes.toString('utf-8')), artifact.filename).toEqual(
				index === 0 ? oracle.light : oracle.dark,
			);
		}
	}
}

test('downloads the light and dark DTCG documents and the stylesheet, each byte-identical to exportArtifacts and prefixed with the record brand URL', async ({
	page,
}) => {
	// A bare domain, no scheme: `core/brand-record.ts` stores `brandUrl` exactly as the landing
	// form's input, and the form accepts `acme.example` on purpose, per its own docblock.
	const brandUrl = 'acme.example';
	const record = buildRecord(brandUrl);
	const expected = exportArtifacts(TOKEN_SET, { brandUrl });

	// Pins the scenario's own premise: without a prefix these three names would collide with the
	// no-prefix scenario's, so a harness bug reusing one page across scenarios would go unnoticed.
	expect(expected.map((artifact) => artifact.filename)).toEqual([
		'acme.example-light.tokens.json',
		'acme.example-dark.tokens.json',
		'acme.example-tokens.css',
	]);

	await openExportTab(page, record);
	await expectArtifactsMatch(page, expected, ADAPTER_ORACLE);
});

test('downloads the same three artifacts unprefixed when the record carries no brand URL', async ({
	page,
}) => {
	const record = buildRecord(null);
	const expected = exportArtifacts(TOKEN_SET, { brandUrl: null });

	expect(expected.map((artifact) => artifact.filename)).toEqual([
		'light.tokens.json',
		'dark.tokens.json',
		'tokens.css',
	]);

	await openExportTab(page, record);
	await expectArtifactsMatch(page, expected, ADAPTER_ORACLE);
});

test('a re-alias applied through the token list shows up in the downloaded light document', async ({
	page,
}) => {
	const record = buildRecord(null);
	await openExportTab(page, record);

	// `token-list.spec.ts`'s re-alias flow: `primary` starts on `brand.9`, so re-pointing it at
	// `brand.1` is a change the export can't produce by accident from the unmodified token set.
	const override: TokenOverride = {
		kind: 'alias',
		scheme: 'light',
		token: 'primary',
		alias: 'brand.1',
	};
	const applied = applyOverrides(TOKEN_SET, [override]);
	if (!applied.ok) throw new Error(`fixture override refused: ${JSON.stringify(applied.issues)}`);

	const [expectedLight] = exportArtifacts(applied.tokenSet, { brandUrl: null });

	await page.getByLabel('primary alias', { exact: true }).selectOption('brand.1');

	await spyOnBlobTypes(page);
	const { download, bytes, blobType } = await downloadArtifact(page, 'light.tokens.json');

	expect(download.suggestedFilename()).toBe('light.tokens.json');
	expect(blobType).toBe(expectedLight!.mediaType);

	const text = bytes.toString('utf-8');
	// Checked ahead of the full-document comparison below, so a document that still carries the
	// original alias fails right here instead of disappearing into one all-or-nothing byte diff.
	expect(text).toContain('"{color.primitive.brand.1}"');
	expect(bytes.equals(Buffer.from(expectedLight!.contents, 'utf-8'))).toBe(true);
});

test('a download whose click throws still revokes its object URL, and the panel reports the failure', async ({
	page,
}) => {
	await openExportTab(page, buildRecord(null));

	// Something outside the app hooking `click` (an extension, a security product) is the one way
	// `anchor.click()` throws in practice. Every object URL must still be revoked, or each failed
	// attempt pins its Blob in memory for the life of the page.
	await page.evaluate(() => {
		const state = { created: [] as string[], revoked: [] as string[] };
		const create = URL.createObjectURL.bind(URL);
		const revoke = URL.revokeObjectURL.bind(URL);

		(window as Window & { cambiumUrls?: typeof state }).cambiumUrls = state;
		URL.createObjectURL = (object: Blob | MediaSource): string => {
			const url = create(object);
			state.created.push(url);
			return url;
		};
		URL.revokeObjectURL = (url: string): void => {
			state.revoked.push(url);
			revoke(url);
		};
		HTMLAnchorElement.prototype.click = () => {
			throw new Error('click blocked');
		};
	});

	await page.getByRole('button', { name: 'Download light.tokens.json', exact: true }).click();

	await expect(page.getByRole('alert').filter({ hasText: 'The export failed' })).toContainText(
		'click blocked',
	);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const state = (
					window as Window & { cambiumUrls?: { created: string[]; revoked: string[] } }
				).cambiumUrls!;
				return (
					state.created.length > 0 && state.created.every((url) => state.revoked.includes(url))
				);
			}),
		)
		.toBe(true);
});
