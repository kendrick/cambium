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
import { toOklchCss } from '../core/css/oklch-css';
import { BALANCED } from '../core/interpretation';
import { createOklchScaleEngine } from '../core/oklch-scale-engine';
import { CAMBIUM_NAMESPACE } from '../core/provenance';
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

type Rgb = readonly [number, number, number];

/**
 * The pixel at the centre of whatever `target` covers on screen, decoded from a real screenshot.
 * A computed `background-color` is only what the cascade declared: Chromium reports it unchanged
 * under an ancestor at `opacity: 0`, so a swatch nobody can see would still pass a style check.
 * The screenshot is what the compositor actually produced, which is the consumer's unit here.
 */
async function paintedCentre(target: Locator): Promise<Rgb> {
	const png = PNG.sync.read(await target.screenshot({ animations: 'disabled' }));
	const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;

	return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

/**
 * What the browser paints for `oklchCss` over the same backdrop `swatch` sits on, measured the same
 * way as the swatch itself. The reference hangs off `<body>` rather than beside the swatch so an
 * ancestor that hides the swatch can't hide the reference along with it. Its backdrop is the first
 * non-transparent background above the swatch, so a translucent colour (a shadow's alpha)
 * composites over the same thing in both.
 */
async function referencePaint(page: Page, swatch: Locator, oklchCss: string): Promise<Rgb> {
	const backdrop = await swatch.evaluate((element) => {
		for (let node = element.parentElement; node; node = node.parentElement) {
			const color = getComputedStyle(node).backgroundColor;
			if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
		}
		return 'rgb(255, 255, 255)';
	});

	await page.evaluate(
		([fill, behind]) => {
			const frame = document.createElement('div');
			frame.setAttribute('data-paint-reference', '');
			Object.assign(frame.style, {
				position: 'fixed',
				top: '0',
				left: '0',
				width: '16px',
				height: '16px',
				zIndex: '2147483647',
				backgroundColor: behind,
			});
			const chip = document.createElement('div');
			Object.assign(chip.style, { width: '100%', height: '100%', backgroundColor: fill });
			frame.appendChild(chip);
			document.body.appendChild(frame);
		},
		[oklchCss, backdrop] as const,
	);

	const reference = page.locator('[data-paint-reference]');

	try {
		return await paintedCentre(reference);
	} finally {
		await reference.evaluate((element) => element.remove());
	}
}

/**
 * The largest per-channel gap between two paints. Two renders of one colour can land a unit apart
 * after rounding, so a scenario allows 1.
 */
function paintDistance(actual: Rgb, expected: Rgb): number {
	return Math.max(...actual.map((channel, index) => Math.abs(channel - expected[index]!)));
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

test('the primary swatch paints the brand step its alias names, measured in screen pixels', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const swatch = page.locator('[data-token="semantic.primary"] [data-swatch]');
	await expect(swatch).toBeVisible();

	// Read straight off the ramp rather than through `resolveScheme`, which is the code under test's
	// own route from alias to colour. `primary` is a fixed alias in the semantic map.
	expect(LIGHT.semantic.primary!.alias).toBe('brand.9');
	const brand9 = LIGHT.primitives.brand!.find((step) => step.step === 9)!;
	const expectedCss = toOklchCss({ l: brand9.l, c: brand9.c, h: brand9.h });

	const expected = await referencePaint(page, swatch, expectedCss);
	expect(paintDistance(await paintedCentre(swatch), expected)).toBeLessThanOrEqual(1);
	await expect(page.locator('[data-token="semantic.primary"] [data-swatch-value]')).toHaveText(
		expectedCss,
	);
});

test("a dark-scheme shadow swatch paints that scheme's own shadow colour, alpha included", async ({
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

	const expected = await referencePaint(page, swatch, toOklchCss(darkColor));
	await expect
		.poll(async () => paintDistance(await paintedCentre(swatch), expected))
		.toBeLessThanOrEqual(1);
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
	const expandedBlock = row.locator('[data-rationale-expanded]');
	await expect(expandedBlock).toHaveCount(0);

	await toggle.click();

	await expect(row.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
	await expect(expandedBlock).toBeVisible();
	await expect(expandedBlock.getByText(expandedTrace)).toBeVisible();
	await expect(expandedBlock.getByText(stepRole)).toBeVisible();

	// The one-line rationale above is already the whole string, cut by CSS. What makes this block the
	// full one is that nothing clips it, so the check is on the element holding the text.
	const fullRationale = expandedBlock.getByText(provenance.rationale, { exact: true });
	await expect(fullRationale).toBeVisible();

	const layout = await fullRationale.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			whiteSpace: style.whiteSpace,
			textOverflow: style.textOverflow,
			clipped: element.scrollWidth > element.clientWidth,
		};
	});

	expect(layout.whiteSpace).not.toBe('nowrap');
	expect(layout.textOverflow).not.toBe('ellipsis');
	expect(layout.clipped).toBe(false);
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
	const target = await referencePaint(page, swatch, toOklchCss(targetStep));
	expect(paintDistance(await paintedCentre(swatch), target)).toBeGreaterThan(1);

	await expect(row).not.toHaveAttribute('data-overridden', '');

	await page.getByLabel('primary alias', { exact: true }).selectOption('brand.1');

	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(async () => paintDistance(await paintedCentre(swatch), target))
		.toBeLessThanOrEqual(1);
});

test('an override survives a preset switch', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const row = page.locator('[data-token="semantic.primary"]');
	const swatch = row.locator('[data-swatch]');
	const targetStep = LIGHT.primitives.brand![0]!;
	const target = await referencePaint(page, swatch, toOklchCss(targetStep));

	await page.getByLabel('primary alias', { exact: true }).selectOption('brand.1');
	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(async () => paintDistance(await paintedCentre(swatch), target))
		.toBeLessThanOrEqual(1);

	// `PRESET_PARAMS` in `app/state/workspace-store.ts` maps every preset to `BALANCED` until #37, so
	// this switch can't move a derived value on its own, and this scenario can't show an override
	// outliving a base that actually changed. What it does prove is that the override rides along
	// through a re-derivation, which is what #26's acceptance criterion asks for.
	await page.getByLabel('Interpretation').selectOption('faithful');
	await expect(page.getByLabel('Interpretation')).toHaveValue('faithful');
	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(async () => paintDistance(await paintedCentre(swatch), target))
		.toBeLessThanOrEqual(1);

	await page.getByLabel('Interpretation').selectOption('balanced');
	await expect(page.getByLabel('Interpretation')).toHaveValue('balanced');
	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(async () => paintDistance(await paintedCentre(swatch), target))
		.toBeLessThanOrEqual(1);
});

test('every semantic row resolves to a real primitive step, checked against the token set rather than the map that proposed it', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const semanticSection = page
		.getByRole('region', { name: 'Tokens' })
		.locator('section[data-category="semantic"]');
	await expect(semanticSection.locator('li[data-token]').first()).toBeVisible();

	// Every row in one round trip. The expectation comes from the built set rather than the static
	// `SEMANTIC_MAP`, because a `ContrastingPair` entry is only settled at build time: a row echoing
	// the map would pass on the fixed aliases and fail on those.
	const rendered = Object.fromEntries(
		await semanticSection
			.locator('li[data-token]')
			.evaluateAll((elements) =>
				elements.map((element) => [
					element.getAttribute('data-token'),
					element.querySelector('[data-resolves-to]')?.getAttribute('data-resolves-to') ?? null,
				]),
			),
	) as Record<string, string | null>;

	expect(Object.keys(rendered)).toHaveLength(SEMANTIC_TOKENS.length);
	expect(new Set(Object.keys(rendered))).toEqual(
		new Set(SEMANTIC_TOKENS.map((token) => `semantic.${token}`)),
	);

	for (const token of SEMANTIC_TOKENS) {
		const shown = rendered[`semantic.${token}`];

		expect(shown, `semantic.${token}`).toBe(LIGHT.semantic[token]!.alias);
		// The alias has to name a step the ramp holds, not just a string shaped like one.
		expect(stepForAlias(LIGHT.primitives, shown!), `semantic.${token}`).toBeDefined();
	}
});

/** The issue items a row lists under its controls, from a rejected edit or a held override. */
function issueItems(row: Locator): Locator {
	return row.locator('[data-issues] li');
}

test('a rejected edit retyped back to the shown value leaves no issue behind', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const shown = TOKEN_SET.opacity.values.overlay!.value;
	const row = page.locator('[data-token="opacity.overlay"]');
	const field = page.getByLabel('opacity.overlay value', { exact: true });

	// Opacity tops out at 1, so the store refuses this and keeps nothing.
	await field.fill('9');
	await field.blur();
	await expect(issueItems(row)).not.toHaveCount(0);

	await field.fill(String(shown));
	await field.blur();

	await expect(field).toHaveValue(String(shown));
	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(issueItems(row)).toHaveCount(0);
});

test('reset clears a rejected edit made on top of a held override', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const shown = TOKEN_SET.opacity.values.overlay!.value;
	const row = page.locator('[data-token="opacity.overlay"]');
	const field = () => page.getByLabel('opacity.overlay value', { exact: true });

	await field().fill('0.5');
	await field().blur();
	await expect(row).toHaveAttribute('data-overridden', '');

	await field().fill('9');
	await field().blur();
	await expect(issueItems(row)).not.toHaveCount(0);

	await row.getByRole('button', { name: 'Reset' }).click();

	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(field()).toHaveValue(String(shown));
	await expect(issueItems(row)).toHaveCount(0);
});

test("a field issue raised in the light scheme doesn't follow the row into dark", async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const row = page.locator('[data-token="primitive.brand.1"]');
	const lightness = () => page.getByLabel('primitive.brand.1 l', { exact: true });

	await lightness().fill('');
	await lightness().blur();
	await expect(issueItems(row)).toHaveText(['Enter a number.']);

	await page.getByRole('button', { name: 'dark', exact: true }).click();

	const darkStep = TOKEN_SET.schemes.dark.primitives.brand!.find((step) => step.step === 1)!;
	await expect(lightness()).toHaveValue(String(darkStep.l));
	await expect(issueItems(row)).toHaveCount(0);
});
