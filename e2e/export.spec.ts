import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Download, Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

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
import { exportArchiveEntries } from '../core/export/archive';
import { exportArtifacts, type ExportArtifact } from '../core/export/artifacts';
import { BALANCED } from '../core/interpretation';
import { createOklchScaleEngine } from '../core/oklch-scale-engine';
import { defaultSeedPins, repairPinsFor } from '../core/seed-pins';
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
 * The set and the report the workspace store holds (`repairedBase` in `app/state/workspace-store.ts`): derive, then repair contrast with the store's own pinned set. One call gives both, so the DESIGN.md checked below documents the run the page paints. Everything expected here is built from these and never from the page's own copy, so a broken download can't grade itself against its own wrong answer.
 */
const { tokenSet: TOKEN_SET, report: REPAIRS } = withContrastRepairs(RAW_TOKEN_SET, {
	pinned: repairPinsFor(SEED, defaultSeedPins(SEED)),
});

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
 * Every step repair moved, found by comparing the raw and repaired sets channel by channel rather than by reading `REPAIRS`. DESIGN.md has to document these, so the check below doesn't take the report's own word for what moved.
 */
const MOVED_STEPS = (['light', 'dark'] as const).flatMap((scheme) =>
	Object.entries(RAW_TOKEN_SET.schemes[scheme].primitives).flatMap(([ramp, steps]) =>
		steps.flatMap((before, index) => {
			const after = TOKEN_SET.schemes[scheme].primitives[ramp]![index]!;

			return before.l === after.l && before.c === after.c && before.h === after.h
				? []
				: [{ scheme, step: `${ramp}.${index + 1}` }];
		}),
	),
);

if (MOVED_STEPS.length === 0) {
	throw new Error(
		'fixture seed no longer moves a step under repair; DESIGN.md would say none were applied',
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

/** Every archive entry, computed here from the fixture rather than read back from the page. */
const ENTRIES = exportArchiveEntries({ tokens: TOKEN_SET, seed: SEED, repairs: REPAIRS });

/** #15's documented layout, typed out, with the name and type each file downloads as. */
const ARCHIVE_FILES = [
	['DESIGN.md', 'acme.example-DESIGN.md', 'text/markdown'],
	['tokens/dark.tokens.json', 'acme.example-dark.tokens.json', 'application/design-tokens+json'],
	['tokens/light.tokens.json', 'acme.example-light.tokens.json', 'application/design-tokens+json'],
	['tokens/theme.css', 'acme.example-theme.css', 'text/css'],
	['tokens/tokens.css', 'acme.example-tokens.css', 'text/css'],
	['unbranded-ds/theme.dark.json', 'acme.example-theme.dark.json', 'application/json'],
	['unbranded-ds/theme.light.json', 'acme.example-theme.light.json', 'application/json'],
	['unbranded-ds/themes/theme/brand/dark.json', 'acme.example-dark.json', 'application/json'],
	['unbranded-ds/themes/theme/brand/light.json', 'acme.example-light.json', 'application/json'],
] as const;

const ARCHIVE_PATHS = ARCHIVE_FILES.map(([path]) => path);

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

	await page.getByRole('button', { name: 'Edit semantic.primary', exact: true }).click();
	await page.getByLabel('primary alias', { exact: true }).selectOption('brand.1');
	await page.keyboard.press('Escape');

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

test('lists every archive file with a preview of exactly the bytes its own download writes', async ({
	page,
}) => {
	await openExportTab(page, buildRecord('acme.example'));
	await spyOnBlobTypes(page);

	for (const [path, filename, mediaType] of ARCHIVE_FILES) {
		// oxlint-disable-next-line no-await-in-loop -- one disclosure and one download at a time
		await page.getByText(path, { exact: true }).click();

		const preview = page.locator(`[data-export-preview="${path}"]`);

		// oxlint-disable-next-line no-await-in-loop
		await expect(preview).toBeVisible();
		// textContent, not toHaveText, which would normalise the whitespace the bytes carry.
		// oxlint-disable-next-line no-await-in-loop
		expect(await preview.evaluate((node) => node.textContent), path).toBe(ENTRIES[path]);

		// oxlint-disable-next-line no-await-in-loop
		const { download, bytes, blobType } = await downloadArtifact(page, filename);

		expect(download.suggestedFilename(), path).toBe(filename);
		expect(blobType, path).toBe(mediaType);
		expect(bytes.equals(Buffer.from(ENTRIES[path]!, 'utf-8')), path).toBe(true);
		// The requirement itself: the preview is exactly what this file's own download wrote.
		// oxlint-disable-next-line no-await-in-loop
		expect(bytes.toString('utf-8'), path).toBe(await preview.evaluate((node) => node.textContent));
	}
});

test('downloads the complete archive, built in the page with no request, holding every file byte for byte', async ({
	page,
}) => {
	await openExportTab(page, buildRecord('acme.example'));
	await spyOnBlobTypes(page);

	const requests: string[] = [];
	page.on('request', (request) => {
		if (!/^(blob|data):/.test(request.url())) requests.push(request.url());
	});

	const button = page.getByRole('button', {
		name: 'Download acme.example-export.zip',
		exact: true,
	});
	const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
	const path = await download.path();

	if (path === null) throw new Error('the archive download produced no saved file');

	expect(download.suggestedFilename()).toBe('acme.example-export.zip');
	expect(await lastBlobType(page)).toBe('application/zip');

	// fflate's reader, never buildExportArchive, so the archive isn't graded by its own builder.
	const unzipped = unzipSync(new Uint8Array(await readFile(path)));

	expect(Object.keys(unzipped)).toEqual(ARCHIVE_PATHS);

	for (const entry of ARCHIVE_PATHS) {
		expect(strFromU8(unzipped[entry]!), entry).toBe(ENTRIES[entry]);
	}

	expect(JSON.parse(strFromU8(unzipped['tokens/light.tokens.json']!))).toEqual(
		ADAPTER_ORACLE.light,
	);
	expect(JSON.parse(strFromU8(unzipped['tokens/dark.tokens.json']!))).toEqual(ADAPTER_ORACLE.dark);
	expect(strFromU8(unzipped['tokens/tokens.css']!)).toBe(ADAPTER_ORACLE.css);

	// The repairs reached the archive as the reader of DESIGN.md sees them: one row per moved step, under the right scheme, with the moved steps found by diffing the two sets rather than read off the report.
	const design = strFromU8(unzipped['DESIGN.md']!);
	const rows = repairRows(design);

	expect(design).not.toContain('No repairs were applied.');
	for (const { scheme, step } of MOVED_STEPS) {
		expect(
			rows.some(([rowScheme, , moved]) => rowScheme === scheme && moved === step),
			`${scheme} ${step}`,
		).toBe(true);
	}

	expect(requests).toEqual([]);
});

// The listing lags an edit behind `useDeferredValue` while the adapters rerun. A per-file download clicked inside that window has to write the edited tokens, as the archive does, not the stale listing's (PR #180 review).
test('a per-file download clicked before the listing catches up with an edit still writes the edited tokens', async ({
	page,
}) => {
	await openExportTab(page, buildRecord(null));

	const override: TokenOverride = {
		kind: 'alias',
		scheme: 'light',
		token: 'primary',
		alias: 'brand.1',
	};
	const applied = applyOverrides(TOKEN_SET, [override]);
	if (!applied.ok) throw new Error(`fixture override refused: ${JSON.stringify(applied.issues)}`);

	const [expectedLight] = exportArtifacts(applied.tokenSet, { brandUrl: null });

	await page.getByRole('button', { name: 'Edit semantic.primary', exact: true }).click();

	const select = await page.getByLabel('primary alias', { exact: true }).elementHandle();
	const button = await page
		.getByRole('button', { name: 'Download light.tokens.json', exact: true })
		.elementHandle();

	if (!select || !button) throw new Error('expected the alias select and the download button');

	// The edit and the click share one task, so the click lands after React commits the edit's urgent render (a microtask) and before the deferred listing's render (a scheduler task). The preview's `primary` at the click is the evidence the window was open rather than closed.
	const [download, previewPrimary] = await Promise.all([
		page.waitForEvent('download'),
		page.evaluate(
			async ([element, target]) => {
				(element as HTMLSelectElement).value = 'brand.1';
				element.dispatchEvent(new Event('change', { bubbles: true }));
				await Promise.resolve();

				const preview = document.querySelector('[data-export-preview="tokens/light.tokens.json"]');
				const primary: unknown = JSON.parse(preview?.textContent ?? '{}')?.color?.semantic?.primary
					?.$value;

				(target as HTMLButtonElement).click();

				return primary;
			},
			[select, button] as const,
		),
	]);

	expect(previewPrimary).toBe('{color.primitive.brand.9}');

	const path = await download.path();
	if (path === null) throw new Error('the light download produced no saved file');
	const bytes = await readFile(path);

	expect(JSON.parse(bytes.toString('utf-8')).color.semantic.primary.$value).toBe(
		'{color.primitive.brand.1}',
	);
	expect(bytes.equals(Buffer.from(expectedLight!.contents, 'utf-8'))).toBe(true);
});

/**
 * The three downloads for the fixture seed, pinned to the bytes `main` produced before #159 moved
 * number formatting in the interface. #159 rounds what the token list and the preview print, and
 * this is what proves none of that reached an export. Recorded from real downloads on the unchanged
 * tree at 4fa44f6, so the golden is the file a person saves, not an adapter call.
 *
 * A deliberate export change regenerates it: `pnpm build && pnpm test:e2e export
 * --update-snapshots=changed`, then review the diff under `e2e/__snapshots__/`.
 */
test('the three downloads match the bytes recorded on main for the fixture seed', async ({
	page,
}) => {
	await openExportTab(page, buildRecord(null));
	await spyOnBlobTypes(page);

	for (const filename of ['light.tokens.json', 'dark.tokens.json', 'tokens.css']) {
		// One download at a time, for the reason `expectArtifactsMatch` gives.
		// oxlint-disable-next-line no-await-in-loop
		const { bytes } = await downloadArtifact(page, filename);
		expect(bytes).toMatchSnapshot([filename]);
	}
});
