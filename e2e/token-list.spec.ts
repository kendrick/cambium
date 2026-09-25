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
import { serializeDtcg } from '../core/dtcg/serialize';
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

/** What one row should show, read off the DTCG export rather than off the token set's own shape. */
type ExportedRow = {
	/** Each control's accessible name, mapped to the alias or number the export holds for it. */
	controls: Record<string, number | string>;
	provenance: string;
	rationale: string;
};

/** DTCG fixes a cubic-bezier's `$value` as the tuple `[x1, y1, x2, y2]`. */
const BEZIER_PARAMS = ['x1', 'y1', 'x2', 'y2'] as const;

/**
 * The editable numbers in one exported `$value`, each under the name its input should carry after
 * the row id. Dispatched on `$type` and written from the DTCG shapes rather than from the list's
 * own labelling, so a row that shows the right number under the wrong name fails. The strings a
 * `$value` also carries (`unit`, `hex`, `colorSpace`) aren't editable and aren't listed. A `$type`
 * nobody mapped throws, so a new family can't slip through with nothing checked.
 */
function exportedLeaves(type: string, value: unknown): Record<string, number> {
	switch (type) {
		case 'number':
		case 'fontWeight':
			return { value: value as number };
		case 'dimension':
		case 'duration':
			return { value: (value as { value: number }).value };
		case 'cubicBezier':
			return Object.fromEntries(
				BEZIER_PARAMS.map((name, index) => [name, (value as number[])[index]!]),
			);
		case 'color': {
			const { components, alpha } = value as { components: number[]; alpha?: number };
			const [l, c, h] = components;
			return alpha === undefined ? { l: l!, c: c!, h: h! } : { l: l!, c: c!, h: h!, alpha };
		}
		case 'shadow': {
			type Length = { value: number };
			const shadow = value as {
				color: unknown;
				offsetX: Length;
				offsetY: Length;
				blur: Length;
				spread: Length;
			};
			const color = Object.entries(exportedLeaves('color', shadow.color)).map(
				([name, number]) => [`color.${name}`, number] as const,
			);
			return {
				offsetX: shadow.offsetX.value,
				offsetY: shadow.offsetY.value,
				blur: shadow.blur.value,
				spread: shadow.spread.value,
				...Object.fromEntries(color),
			};
		}
		default:
			throw new Error(`no control mapping for DTCG $type "${type}"`);
	}
}

/**
 * How many times each value occurs. Two tallies are equal when the lists hold the same values the
 * same number of times in any order, which is the comparison a section's row ids need: the list
 * follows no order the export promises, and a repeated row or a dropped one changes a count.
 */
function tally<T>(values: Iterable<T>): Map<T, number> {
	const counts = new Map<T, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return counts;
}

/**
 * Every row the light scheme should render, keyed by the list's `data-token` id and built from
 * `serializeDtcg`'s light document. The list finds its tokens by walking to each `$extensions`;
 * the export finds them by where DTCG puts a `$value`, so the two only agree when the list shows
 * exactly the tokens a consumer of the export would read. Every editable number under a `$value`
 * is one input's worth, named as `exportedLeaves` says.
 */
const EXPORTED_ROWS: ReadonlyMap<string, ExportedRow> = (() => {
	const rows = new Map<string, ExportedRow>();

	function visit(node: unknown, path: string[]): void {
		if (typeof node !== 'object' || node === null) return;

		const record = node as Record<string, unknown>;

		if (!Object.hasOwn(record, '$value')) {
			for (const [key, child] of Object.entries(record)) {
				if (!key.startsWith('$')) visit(child, [...path, key]);
			}
			return;
		}

		const extensions = record.$extensions as Record<
			string,
			{ provenance: string; rationale: string }
		>;
		const { provenance, rationale } = extensions[CAMBIUM_NAMESPACE]!;
		const value = record.$value;

		// The export nests both colour groups under `color`; the list names them on their own.
		if (path[0] === 'color' && path[1] === 'semantic') {
			const token = path.slice(2).join('.');
			const alias = String(value).replace(/^\{color\.primitive\.(.+)\}$/, '$1');
			rows.set(`semantic.${token}`, {
				controls: { [`${token} alias`]: alias },
				provenance,
				rationale,
			});
			return;
		}

		const id = path[0] === 'color' ? path.slice(1).join('.') : path.join('.');
		const leaves = Object.entries(exportedLeaves(String(record.$type), value));
		rows.set(id, {
			controls: Object.fromEntries(leaves.map(([name, number]) => [`${id} ${name}`, number])),
			provenance,
			rationale,
		});
	}

	visit(serializeDtcg(TOKEN_SET).light, []);
	return rows;
})();

/** The exported ids a `section[data-category]` should hold, found by the prefix each one carries. */
function exportedIdsFor(prefix: string): Map<string, number> {
	return tally([...EXPORTED_ROWS.keys()].filter((id) => id.startsWith(`${prefix}.`)));
}

/** Every row id a section renders, in one round trip. */
async function renderedIds(section: Locator): Promise<Map<string, number>> {
	return tally(
		await section
			.locator('li[data-token]')
			.evaluateAll((elements) =>
				elements.map((element) => element.getAttribute('data-token') ?? ''),
			),
	);
}

/**
 * A colour written straight from its own fields, never through `toOklchCss`, which is how the list
 * writes a swatch. A reference built with the swatch's own serializer can't catch that serializer
 * getting a channel wrong. Alpha stays the 0-1 number the token holds; CSS Color 4 takes either
 * that or a percentage in the slash slot.
 */
function oklchFromFields(color: { l: number; c: number; h: number; alpha?: number }): string {
	const triple = `${color.l} ${color.c} ${color.h}`;

	return color.alpha === undefined ? `oklch(${triple})` : `oklch(${triple} / ${color.alpha})`;
}

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
	expect(await renderedIds(semanticSection)).toEqual(exportedIdsFor('semantic'));

	// A count alone passes a section that repeats one real row in place of another, so each section
	// also has to hold exactly the ids the export names for it.
	for (const ramp of RAMP_NAMES) {
		const section = tokensSection.locator(`section[data-category="${ramp}"]`);
		await expect(section).toBeVisible();
		await expect(section.locator('li[data-token]')).toHaveCount(12);
		expect(await renderedIds(section), ramp).toEqual(exportedIdsFor(`primitive.${ramp}`));
	}

	for (const category of NON_COLOUR_CATEGORIES) {
		const section = tokensSection.locator(`section[data-category="${category}"]`);
		await expect(section).toBeVisible();
		await expect(section.locator('li[data-token]')).toHaveCount(EXPECTED_ROWS[category]);
		expect(await renderedIds(section), category).toEqual(exportedIdsFor(category));
	}

	// Every row, across every category, batched into one evaluate rather than one assertion per row:
	// `expectedRowCount()` is 172 for this seed, and awaiting a `toBeVisible()` apiece would make the
	// scenario minutes slow for no more coverage than one round trip already gives.
	const rows = await tokensSection.locator('li[data-token]').evaluateAll((elements) =>
		elements.map((element) => {
			const provenanceLabel = Array.from(element.querySelectorAll('span')).find((span) =>
				/^(observed|derived|invented)$/.test(span.textContent?.trim() ?? ''),
			);

			return {
				id: element.getAttribute('data-token') ?? '',
				inputs: Array.from(element.querySelectorAll('input'), (input) => ({
					label: input.getAttribute('aria-label') ?? '',
					raw: input.value,
				})),
				selects: Array.from(element.querySelectorAll('select'), (select) => ({
					label: select.getAttribute('aria-label') ?? '',
					raw: select.value,
				})),
				provenance: provenanceLabel?.textContent?.trim() ?? null,
				rationale: element.querySelector('p')?.textContent?.trim() ?? '',
			};
		}),
	);

	expect(rows.length).toBe(expectedRowCount());
	expect(tally(rows.map((row) => row.id))).toEqual(tally(EXPORTED_ROWS.keys()));

	for (const row of rows) {
		const exported = EXPORTED_ROWS.get(row.id)!;

		// `Number('')` is 0, so a blank input would pass wherever the export holds a 0 unless the raw
		// text is checked first.
		for (const input of row.inputs) {
			expect(input.raw, `${input.label} is blank`).not.toBe('');
		}

		// Paired by accessible name, so a right number under the wrong label fails. Counted before
		// the pairs collapse into a record, so a repeated control can't hide behind its twin. Inputs
		// compare as numbers, so `0.5` and `.5` count as the same value.
		const controls = [
			...row.selects.map(({ label, raw }) => [label, raw] as const),
			...row.inputs.map(({ label, raw }) => [label, Number(raw)] as const),
		];

		expect(controls.length, `${row.id} control count`).toBe(Object.keys(exported.controls).length);
		expect(Object.fromEntries(controls), `${row.id} controls`).toEqual(exported.controls);
		expect(row.provenance, `${row.id} provenance`).toBe(exported.provenance);
		// The whole sentence, since the one-line truncation is CSS and `textContent` ignores it.
		expect(row.rationale, `${row.id} rationale`).toBe(exported.rationale);
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

	const expected = await referencePaint(page, swatch, oklchFromFields(brand9));
	expect(paintDistance(await paintedCentre(swatch), expected)).toBeLessThanOrEqual(1);

	// The printed value is read back as numbers, so the check is on what a reader copies out of it
	// rather than on the serializer's exact spelling.
	const printed = await page
		.locator('[data-token="semantic.primary"] [data-swatch-value]')
		.textContent();
	const channels = /^oklch\(([^ ]+) ([^ ]+) ([^ )]+)\)$/.exec(printed ?? '');
	expect(channels, `swatch value ${printed}`).not.toBeNull();
	expect(Number(channels![1])).toBeCloseTo(brand9.l, 6);
	expect(Number(channels![2])).toBeCloseTo(brand9.c, 6);
	expect(Number(channels![3])).toBeCloseTo(brand9.h, 6);
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
	const lightColor = LIGHT.shadow.values.md!.color;
	expect(darkColor.l).not.toBe(lightColor.l);
	expect(darkColor.alpha).not.toBe(lightColor.alpha);

	const swatch = page.locator('[data-token="shadow.md"] [data-swatch]');
	await expect(swatch).toBeVisible();

	const expected = await referencePaint(page, swatch, oklchFromFields(darkColor));
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
	const target = await referencePaint(page, swatch, oklchFromFields(targetStep));
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
	const target = await referencePaint(page, swatch, oklchFromFields(targetStep));

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

test('reset puts every channel of a primitive back to its committed value, a refused one included', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const step = LIGHT.primitives.brand!.find((candidate) => candidate.step === 1)!;
	const row = page.locator('[data-token="primitive.brand.1"]');
	const channel = (name: 'l' | 'c' | 'h') =>
		page.getByLabel(`primitive.brand.1 ${name}`, { exact: true });

	await channel('c').fill('0.01');
	await channel('c').blur();
	await expect(row).toHaveAttribute('data-overridden', '');

	// L tops out at 1, so the store refuses this and L's committed value never moves. Its input is
	// the one a reset keyed only on committed values would leave showing the refused text.
	await channel('l').fill('2');
	await channel('l').blur();
	await expect(issueItems(row)).not.toHaveCount(0);

	await row.getByRole('button', { name: 'Reset' }).click();

	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(issueItems(row)).toHaveCount(0);
	await expect(channel('l')).toHaveValue(String(step.l));
	await expect(channel('c')).toHaveValue(String(step.c));
	await expect(channel('h')).toHaveValue(String(step.h));
});

test('reset puts every leaf of a shadow back to its committed value, a refused one included', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const shadow = LIGHT.shadow.values.xs!;
	const row = page.locator('[data-token="shadow.xs"]');
	const leaf = (label: string) => page.getByLabel(`shadow.xs ${label}`, { exact: true });

	await leaf('offsetY').fill(String(shadow.offsetY.value + 1));
	await leaf('offsetY').blur();
	await expect(row).toHaveAttribute('data-overridden', '');

	await leaf('color.alpha').fill('2');
	await leaf('color.alpha').blur();
	await expect(issueItems(row)).not.toHaveCount(0);

	await row.getByRole('button', { name: 'Reset' }).click();

	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(issueItems(row)).toHaveCount(0);

	const committed: Record<string, number> = {
		offsetX: shadow.offsetX.value,
		offsetY: shadow.offsetY.value,
		blur: shadow.blur.value,
		spread: shadow.spread.value,
		'color.l': shadow.color.l,
		'color.c': shadow.color.c,
		'color.h': shadow.color.h,
		'color.alpha': shadow.color.alpha,
	};

	await expect(row.locator('input')).toHaveCount(Object.keys(committed).length);

	await Promise.all(
		Object.entries(committed).map(([label, value]) =>
			expect(leaf(label), label).toHaveValue(String(value)),
		),
	);
});

test('a refused light-scheme edit lists its message once, though the store checks two copies', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const primitive = page.locator('[data-token="primitive.brand.1"]');
	const lightness = page.getByLabel('primitive.brand.1 l', { exact: true });
	await lightness.fill('2');
	await lightness.blur();
	await expect(issueItems(primitive)).toHaveCount(1);

	const shadow = page.locator('[data-token="shadow.xs"]');
	const alpha = page.getByLabel('shadow.xs color.alpha', { exact: true });
	await alpha.fill('2');
	await alpha.blur();
	await expect(issueItems(shadow)).toHaveCount(1);
});

test('refusals in two different fields of one row list as two items, not one', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// Both leaves top out at 1, so the store refuses each with the same message. Only their paths
	// differ, and a row that merged on the message would hide the second refused field.
	const shadow = page.locator('[data-token="shadow.xs"]');
	const leaf = (label: string) => page.getByLabel(`shadow.xs ${label}`, { exact: true });
	await leaf('color.l').fill('2');
	await leaf('color.l').blur();
	await expect(issueItems(shadow)).toHaveCount(1);
	await leaf('color.alpha').fill('2');
	await leaf('color.alpha').blur();
	await expect(issueItems(shadow)).toHaveCount(2);

	// Two cleared channels never reach the store, and share one message the same way.
	const primitive = page.locator('[data-token="primitive.brand.1"]');
	const channel = (name: 'l' | 'c') =>
		page.getByLabel(`primitive.brand.1 ${name}`, { exact: true });
	await channel('l').fill('');
	await channel('l').blur();
	await expect(issueItems(primitive)).toHaveCount(1);
	await channel('c').fill('');
	await channel('c').blur();
	await expect(issueItems(primitive)).toHaveCount(2);
});

test('two cleared fields of one shadow row list as two items, not one', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// Neither edit reaches the store. Each field holds its own "Enter a number." issue under its
	// own label, with the same message, so only the field tells them apart.
	const shadow = page.locator('[data-token="shadow.xs"]');
	const leaf = (label: string) => page.getByLabel(`shadow.xs ${label}`, { exact: true });
	await leaf('offsetX').fill('');
	await leaf('offsetX').blur();
	await expect(issueItems(shadow)).toHaveCount(1);
	await leaf('offsetY').fill('');
	await leaf('offsetY').blur();
	await expect(issueItems(shadow)).toHaveCount(2);
});
