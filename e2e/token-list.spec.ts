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
import { toOklchCss } from '../core/css/oklch-css';
import { BALANCED } from '../core/interpretation';
import { createOklchScaleEngine } from '../core/oklch-scale-engine';
import { CAMBIUM_NAMESPACE } from '../core/provenance';
import { resolveScheme } from '../core/resolve-scheme';
import { buildTokenSet } from '../core/semantic-layer';
import { STEP_ROLES } from '../core/step-roles';
import { stepForAlias, type TokenSet } from '../core/token-set';

import { expect, test } from './fixtures';

/**
 * Spelled out rather than imported: `components/stored-record.tsx` owns the constant and
 * `workspace.spec.ts` has its own copy for the same reason stated there. A rename should fail
 * whichever spec forgot to move with it, not silently agree with the other.
 */
const RECORD_PARAM = 'record';

/**
 * One key colour, same shape `workspace.spec.ts`'s `FIXTURE_SEED` uses, for the same reason: it is
 * the minimum `core/oklch-scale-engine.ts` needs for a non-error `ScaleEngineResult`. Every scenario
 * below shares this one seed, so a single Node-computed token set (below) is every scenario's source
 * of truth.
 */
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
 * Computed once, in Node, the same way `app/state/workspace-store.ts`'s `tokensFor` builds a set:
 * generate the ramps, then derive the full set from them. Every expectation below reads off this
 * object rather than off the DOM, so a rendering bug can't supply its own expected value.
 */
const ENGINE = createOklchScaleEngine();
const DERIVED = ENGINE.generate(SEED, BALANCED);

if (!DERIVED.ok) {
	throw new Error(`fixture seed failed to derive: ${DERIVED.error.kind}`);
}

const TOKEN_SET: TokenSet = buildTokenSet(DERIVED.schemes, SEED, BALANCED);
const LIGHT = TOKEN_SET.schemes.light;
const RESOLVED_LIGHT = resolveScheme(LIGHT);

const SEMANTIC_TOKENS = Object.keys(LIGHT.semantic);
const RAMP_NAMES = Object.keys(LIGHT.primitives);

/** The five categories `core/system-constants.ts` names exhaustively; #7's "untouched default" set. */
const SYSTEM_CATEGORIES = ['spacing', 'opacity', 'motion', 'focusRing', 'zIndex'] as const;

/** The remaining non-colour categories, each derived from the seed rather than a constant. */
const DERIVED_VALUE_CATEGORIES = ['radius', 'typography', 'tracking', 'shadow'] as const;

const NON_COLOUR_CATEGORIES = [...SYSTEM_CATEGORIES, ...DERIVED_VALUE_CATEGORIES] as const;

/**
 * Rows per category for `SEED`, counted once from the DTCG export (`serializeDtcg` in
 * `core/dtcg/serialize.ts`, one `$value` per token) and written in by hand. The list finds its rows by
 * walking to each `$extensions`; counting them the same way here would only prove the walk agrees
 * with itself. A token added upstream fails this table until someone updates it.
 */
const EXPECTED_ROWS: Record<(typeof NON_COLOUR_CATEGORIES)[number], number> = {
	spacing: 7,
	opacity: 4,
	motion: 8,
	focusRing: 2,
	zIndex: 8,
	radius: 7,
	typography: 16,
	tracking: 5,
	shadow: 5,
};

/** The DTCG export's `color` group for `SEED`: 26 semantic tokens plus 7 ramps of 12 steps. */
const EXPECTED_COLOUR_ROWS = 110;

function expectedRowCount(): number {
	return (
		EXPECTED_COLOUR_ROWS + Object.values(EXPECTED_ROWS).reduce((total, count) => total + count, 0)
	);
}

/**
 * A record holding one version whose seed derives real tokens. Parsed through `BrandRecordSchema`
 * before anything writes it to IndexedDB, the same guard `workspace.spec.ts`'s own builder applies,
 * so a shape the schema has moved past fails here rather than as a silent mismatch on read-back.
 */
function buildRecordWithSeed(seed: BrandSeed): BrandRecord {
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
				seed,
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
 * Writes one row straight into the `records` object store, bypassing `RecordStore` entirely, the
 * same mechanism `workspace.spec.ts` uses and for the same reason: IndexedDB is scoped to the page's
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
 * The colour a consumer's own compositor makes of an `oklch()` string, read off a throwaway element
 * rather than off the string itself. `data-swatch`'s inline `background-color` and this probe both
 * go through the same browser CSS engine, so comparing their computed styles is the seam itself,
 * not our own serialization of it: `docs/agents/testing.md`'s "Where the seam actually is" is what
 * this stands in for.
 */
async function computedColorOf(page: Page, oklchCss: string): Promise<string> {
	return page.evaluate((css) => {
		const probe = document.createElement('div');
		probe.style.backgroundColor = css;
		document.body.appendChild(probe);
		const color = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return color;
	}, oklchCss);
}

test('every category is grouped, and every row carries a value control, a provenance label and a rationale', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const tokensSection = page.getByRole('region', { name: 'Tokens' });
	await expect(tokensSection.getByRole('listitem').first()).toBeVisible();

	const semanticSection = tokensSection.locator('section[data-category="semantic"]');
	await expect(semanticSection).toBeVisible();
	await expect(semanticSection.locator('li[data-token]')).toHaveCount(SEMANTIC_TOKENS.length);

	for (const ramp of RAMP_NAMES) {
		const section = tokensSection.locator(`section[data-category="${ramp}"]`);
		await expect(section).toBeVisible();
		await expect(section.locator('li[data-token]')).toHaveCount(12);
	}

	for (const category of NON_COLOUR_CATEGORIES) {
		const section = tokensSection.locator(`section[data-category="${category}"]`);
		await expect(section).toBeVisible();
		await expect(section.locator('li[data-token]')).toHaveCount(EXPECTED_ROWS[category]);
	}

	// Every row, across every category, batched into one evaluate rather than one assertion per row:
	// with ~200 rows in this fixture's set, awaiting a `toBeVisible()` apiece would make the scenario
	// minutes slow for no more coverage than one round trip already gives.
	const rows = await tokensSection.locator('li[data-token]').evaluateAll((elements) =>
		elements.map((element) => {
			const provenanceLabel = Array.from(element.querySelectorAll('span')).find((span) =>
				/^(observed|derived|invented)$/.test(span.textContent?.trim() ?? ''),
			);

			return {
				id: element.getAttribute('data-token'),
				controls: element.querySelectorAll('input, select').length,
				provenance: provenanceLabel?.textContent?.trim() ?? null,
				rationale: element.querySelector('p')?.textContent?.trim() ?? '',
			};
		}),
	);

	expect(rows.length).toBe(expectedRowCount());

	for (const row of rows) {
		expect(row.controls, `${row.id} should carry a value control`).toBeGreaterThan(0);
		expect(row.provenance, `${row.id} should carry a provenance label`).not.toBeNull();
		expect(row.rationale.length, `${row.id} should carry a rationale`).toBeGreaterThan(0);
	}

	// One row's exact text, tied to the Node-computed set rather than to the count above: `primary`
	// is a fixed alias (`brand.9`), so its provenance and rationale are the same on every run.
	const primaryProvenance = LIGHT.semantic.primary!.$extensions[CAMBIUM_NAMESPACE];
	const primaryRow = tokensSection.locator('[data-token="semantic.primary"]');

	await expect(primaryRow.getByText(primaryProvenance.provenance, { exact: true })).toBeVisible();
	await expect(primaryRow.locator('p').first()).toHaveText(primaryProvenance.rationale);
});

test('the primary swatch renders the resolved brand colour, measured as the browser composites it', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const swatch = page.locator('[data-token="semantic.primary"] [data-swatch]');
	await expect(swatch).toBeVisible();

	const expectedCss = toOklchCss(RESOLVED_LIGHT.primary!);
	const [actualColor, expectedColor] = await Promise.all([
		swatch.evaluate((element) => getComputedStyle(element).backgroundColor),
		computedColorOf(page, expectedCss),
	]);

	expect(actualColor).toBe(expectedColor);
	await expect(page.locator('[data-token="semantic.primary"] [data-swatch-value]')).toHaveText(
		expectedCss,
	);
});

test("a dark-scheme shadow swatch renders that scheme's own shadow colour, alpha included", async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	await page.getByRole('button', { name: 'dark', exact: true }).click();

	// Dark's shadow colour differs from light's in lightness and alpha for this seed, so a swatch
	// still reading the top-level (light) copy fails the comparison below.
	const darkColor = TOKEN_SET.schemes.dark.shadow.values.md!.color;
	expect(toOklchCss(darkColor)).not.toBe(toOklchCss(LIGHT.shadow.values.md!.color));

	const swatch = page.locator('[data-token="shadow.md"] [data-swatch]');
	await expect(swatch).toBeVisible();

	const expectedColor = await computedColorOf(page, toOklchCss(darkColor));
	await expect
		.poll(() => swatch.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe(expectedColor);
});

test('a field that blurs unchanged stores nothing, and a cleared field is rejected with an issue', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const primitiveRow = page.locator('[data-token="primitive.brand.1"]');
	const lightness = page.getByLabel('primitive.brand.1 l', { exact: true });
	await lightness.focus();
	await lightness.blur();

	await expect(primitiveRow).not.toHaveAttribute('data-overridden', '');
	await expect(primitiveRow.getByText('overridden', { exact: true })).toHaveCount(0);

	// `Number('')` is 0, and 0 is a legal radius, so a cleared field that slipped through would
	// store an override rather than fail visibly.
	const radiusRow = page.locator('[data-token="radius.md"]');
	const radius = page.getByLabel('radius.md value', { exact: true });
	await radius.fill('');
	await radius.blur();

	await expect(radiusRow.getByText('Enter a number.', { exact: true })).toBeVisible();
	await expect(radiusRow).not.toHaveAttribute('data-overridden', '');
});

test('the full rationale stays closed on load and opens on demand', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const row = page.locator('[data-token="semantic.primary"]');
	const provenance = LIGHT.semantic.primary!.$extensions[CAMBIUM_NAMESPACE];
	const stepRole = STEP_ROLES.find((role) => role.step === 9)!.role;
	const expandedTrace = provenance.seedField
		? `From the seed's ${provenance.seedField}`
		: 'Not traced to a seed field';

	const toggle = row.getByRole('button', { name: 'More' });
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');

	// Not merely hidden: `TokenRow` renders the expanded block conditionally, so on load it is absent
	// from the DOM rather than present and collapsed.
	await expect(row.getByText(expandedTrace)).toHaveCount(0);
	await expect(row.getByText(stepRole)).toHaveCount(0);

	await toggle.click();

	await expect(row.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
	await expect(row.getByText(expandedTrace)).toBeVisible();
	await expect(row.getByText(stepRole)).toBeVisible();
});

test('every system-constant category is labelled an untouched default, and no derived category is', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const tokensSection = page.getByRole('region', { name: 'Tokens' });
	await expect(tokensSection.getByRole('listitem').first()).toBeVisible();

	for (const category of SYSTEM_CATEGORIES) {
		const section = tokensSection.locator(`section[data-category="${category}"]`);
		await expect(section).toHaveAttribute('data-source', 'system');
		await expect(section.getByText('Untouched default')).toBeVisible();
	}

	const derivedCategories: string[] = ['semantic', ...RAMP_NAMES, ...DERIVED_VALUE_CATEGORIES];

	for (const category of derivedCategories) {
		const section = tokensSection.locator(`section[data-category="${category}"]`);
		await expect(section).not.toHaveAttribute('data-source', /.+/);
		await expect(section.getByText('Untouched default')).toHaveCount(0);
	}
});

test("re-aliasing primary to another step marks the row overridden and repaints its swatch as that step's colour", async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const row = page.locator('[data-token="semantic.primary"]');
	const swatch = row.locator('[data-swatch]');

	// Step 1 of the brand ramp sits near the page-background lightness, far from step 9's brand fill.
	// The first assertion checks the two really differ for this seed, so the scenario can't pass on
	// an implementation that ignores the override.
	const targetStep = LIGHT.primitives.brand![0]!;
	const beforeColor = await swatch.evaluate((element) => getComputedStyle(element).backgroundColor);
	const targetColor = await computedColorOf(page, toOklchCss(targetStep));
	expect(beforeColor).not.toBe(targetColor);

	await expect(row).not.toHaveAttribute('data-overridden', '');

	await page.getByLabel('primary alias', { exact: true }).selectOption('brand.1');

	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(() => swatch.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe(targetColor);
});

test('an override survives a preset switch', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const row = page.locator('[data-token="semantic.primary"]');
	const swatch = row.locator('[data-swatch]');
	const targetStep = LIGHT.primitives.brand![0]!;
	const targetColor = await computedColorOf(page, toOklchCss(targetStep));

	await page.getByLabel('primary alias', { exact: true }).selectOption('brand.1');
	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(() => swatch.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe(targetColor);

	// `PRESET_PARAMS` in `app/state/workspace-store.ts` maps every preset to `BALANCED` until #37, so
	// this switch can't move a derived value on its own, and this scenario can't show an override
	// outliving a base that actually changed. What it does prove is that the override rides along
	// through a re-derivation, which is what #26's acceptance criterion asks for.
	await page.getByLabel('Interpretation').selectOption('faithful');
	await expect(page.getByLabel('Interpretation')).toHaveValue('faithful');
	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(() => swatch.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe(targetColor);

	await page.getByLabel('Interpretation').selectOption('balanced');
	await expect(page.getByLabel('Interpretation')).toHaveValue('balanced');
	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(() => swatch.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe(targetColor);
});

test('every semantic row resolves to a real primitive step, checked against the token set rather than the map that proposed it', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const tokensSection = page.getByRole('region', { name: 'Tokens' });
	await expect(tokensSection.getByRole('listitem').first()).toBeVisible();

	// A mix of fixed aliases and the one kind of entry `semantic-layer.ts` resolves at build time
	// rather than declares outright (a `ContrastingPair`). A row that echoes the static `SEMANTIC_MAP`
	// instead of the alias the built set holds fails on the second kind without failing on the first.
	const sampledTokens = [
		'primary',
		'border',
		'destructive',
		'foreground',
		'primary-foreground',
		'sidebar-primary-foreground',
	];

	for (const token of sampledTokens) {
		const expectedAlias = LIGHT.semantic[token]?.alias;
		if (!expectedAlias) throw new Error(`fixture token set has no semantic entry for "${token}"`);

		// Confirms the alias names a step the ramp actually holds, not just a string shaped like one.
		expect(stepForAlias(LIGHT.primitives, expectedAlias)).toBeDefined();

		const row = tokensSection.locator(`[data-token="semantic.${token}"]`);
		await expect(row.locator(`[data-resolves-to="${expectedAlias}"]`)).toBeVisible();
	}
});
