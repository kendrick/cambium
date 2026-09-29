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
import { withContrastRepairs } from '../core/contrast/repair';
import { serializeDtcg } from '../core/dtcg/serialize';
import { BALANCED } from '../core/interpretation';
import { createOklchScaleEngine } from '../core/oklch-scale-engine';
import { CAMBIUM_NAMESPACE } from '../core/provenance';
import { defaultSeedPins } from '../core/seed-pins';
import { buildTokenSet } from '../core/semantic-layer';
import { STEP_ROLES } from '../core/step-roles';
import { applyOverrides, type TokenOverride } from '../core/token-overrides';
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

// `repairedBase` in `app/state/workspace-store.ts` never paints the raw derived set: it repairs
// contrast first and applies that repair's own overrides, so a fixture that skipped this step would
// check the token list against colours nothing on screen ever shows.
const TOKEN_SET: TokenSet = withContrastRepairs(
	buildTokenSet(DERIVED.schemes, SEED, BALANCED),
).tokenSet;
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
 * The literal is also held to `BrandRecord` at compile time: `parse` takes `unknown`, so without
 * that a new required field only surfaces once a browser run trips over it.
 */
function buildRecordWithSeed(seed: BrandSeed, overrides: TokenOverride[] = []): BrandRecord {
	const createdAt = new Date().toISOString();

	return BrandRecordSchema.parse({
		id: randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl: null,
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
				overrides,
				pins: defaultSeedPins(seed),
			},
		],
	} satisfies BrandRecord);
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

/**
 * A token's edit trigger, found by accessible name. The `(has issues)` suffix is the trigger
 * announcing a held issue, so a scenario that raised one can still find it.
 */
function editTrigger(page: Page, id: string): Locator {
	const escaped = id.replaceAll('.', '\\.');
	return page.getByRole('button', { name: new RegExp(`^Edit ${escaped}( \\(has issues\\))?$`) });
}

async function openEditor(page: Page, id: string): Promise<Locator> {
	await editTrigger(page, id).click();
	const editor = page.locator(`[data-editor="${id}"]`);
	await expect(editor).toBeVisible();
	return editor;
}

/** Escape, then wait out base-ui's exit animation, so the next open can't find two editors. */
async function closeEditor(page: Page, editor: Locator): Promise<void> {
	await page.keyboard.press('Escape');
	await expect(editor).toHaveCount(0);
}

/** Every button name in an accessibility snapshot, read the way `getByRole` reads them. */
function buttonNames(snapshot: string): string[] {
	return [...snapshot.matchAll(/- button "((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]!);
}

test('no alias select or number input is in the DOM until its editor opens', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);
	await expect(page.locator('[data-token="semantic.primary"]')).toBeVisible();

	// Page-wide on purpose: the editor portals to <body>, so a control mounted early would sit
	// outside the Tokens region and a region-scoped count would miss it.
	await expect(page.locator('select[aria-label$=" alias"]')).toHaveCount(0);
	await expect(page.locator('input[aria-label^="primitive."]')).toHaveCount(0);
	await expect(page.getByLabel('radius.md value', { exact: true })).toHaveCount(0);

	const semantic = await openEditor(page, 'semantic.primary');
	await expect(page.locator('select[aria-label$=" alias"]')).toHaveCount(1);
	await expect(semantic.getByLabel('primary alias', { exact: true })).toBeVisible();
	await closeEditor(page, semantic);
	await expect(page.locator('select[aria-label$=" alias"]')).toHaveCount(0);

	const primitive = await openEditor(page, 'primitive.brand.1');
	await expect(primitive.locator('input[type="number"]')).toHaveCount(3);
});

test('no two buttons in the token list share an accessible name', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const tokens = page.getByRole('region', { name: 'Tokens' });
	await expect(tokens.locator('[data-token]').first()).toBeVisible();

	// An override is what gives an editor its Reset, so one is made before reading the names. This
	// one also breaks `primary-foreground` on `primary` (1.00:1 for this seed), so #153's Revert is
	// on the row and its name is in the tally too.
	const editor = await openEditor(page, 'semantic.primary');
	await editor.getByLabel('primary alias', { exact: true }).selectOption('brand.1');
	await expect(editor.getByRole('button', { name: 'Reset semantic.primary' })).toBeVisible();
	await expect(
		tokens.getByRole('button', { name: 'Revert primary override', exact: true }),
	).toBeVisible();

	// base-ui's portal leaves an `aria-owns` span beside the trigger, so the accessibility tree
	// already nests the popup under its row and the region's snapshot holds the editor's buttons.
	// Adding the editor's own snapshot on top would count each of them twice.
	const names = buttonNames(await tokens.ariaSnapshot());
	const editorNames = buttonNames(await editor.ariaSnapshot());
	expect(editorNames).toEqual(
		expect.arrayContaining(['Why semantic.primary', 'Reset semantic.primary']),
	);
	expect(names).toEqual(expect.arrayContaining(editorNames));

	// Not vacuous: at least one trigger per row has to be in there.
	expect(names.length).toBeGreaterThanOrEqual(expectedRowCount());
	expect([...tally(names)].filter(([, count]) => count > 1)).toEqual([]);
});

test('every category is grouped, and every token opens an editor whose controls, provenance and rationale match the export', async ({
	page,
}) => {
	// One open-read-close per token, 172 for this seed.
	test.slow();
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

	const ids = await tokensSection
		.locator('[data-token]')
		.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-token') ?? ''));

	expect(ids.length).toBe(expectedRowCount());
	expect(tally(ids)).toEqual(tally(EXPORTED_ROWS.keys()));

	for (const id of ids) {
		const exported = EXPORTED_ROWS.get(id)!;
		const editor = await openEditor(page, id);
		const shown = await editor.evaluate((element) => ({
			inputs: Array.from(element.querySelectorAll('input'), (input) => ({
				label: input.getAttribute('aria-label') ?? '',
				raw: input.value,
			})),
			selects: Array.from(element.querySelectorAll('select'), (select) => ({
				label: select.getAttribute('aria-label') ?? '',
				raw: select.value,
			})),
			provenance: element.querySelector('[data-provenance]')?.textContent?.trim() ?? null,
			rationale: element.querySelector('[data-rationale]')?.textContent?.trim() ?? '',
		}));

		// `Number('')` is 0, so a blank input would pass wherever the export holds a 0 unless the raw
		// text is checked first.
		for (const input of shown.inputs) {
			expect(input.raw, `${input.label} is blank`).not.toBe('');
		}

		// Paired by accessible name, so a right number under the wrong label fails. Counted before
		// the pairs collapse into a record, so a repeated control can't hide behind its twin. Inputs
		// compare as numbers, so `0.5` and `.5` count as the same value.
		const controls = [
			...shown.selects.map(({ label, raw }) => [label, raw] as const),
			...shown.inputs.map(({ label, raw }) => [label, Number(raw)] as const),
		];

		expect(controls.length, `${id} control count`).toBe(Object.keys(exported.controls).length);
		expect(Object.fromEntries(controls), `${id} controls`).toEqual(exported.controls);
		expect(shown.provenance, `${id} provenance`).toBe(exported.provenance);
		// The whole sentence, since the one-line truncation is CSS and `textContent` ignores it.
		expect(shown.rationale, `${id} rationale`).toBe(exported.rationale);

		await closeEditor(page, editor);
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
	const primitiveEditor = await openEditor(page, 'primitive.brand.1');
	const lightness = primitiveEditor.getByLabel('primitive.brand.1 l', { exact: true });
	await lightness.focus();
	await lightness.blur();

	await expect(primitiveRow).not.toHaveAttribute('data-overridden', '');
	await expect(primitiveRow.getByText('overridden', { exact: true })).toHaveCount(0);
	await expect(primitiveEditor.getByText('overridden', { exact: true })).toHaveCount(0);
	await closeEditor(page, primitiveEditor);

	// `Number('')` is 0, and 0 is a legal radius, so a cleared field that slipped through would
	// store an override rather than fail visibly.
	const radiusRow = page.locator('[data-token="radius.md"]');
	const radiusEditor = await openEditor(page, 'radius.md');
	const radius = radiusEditor.getByLabel('radius.md value', { exact: true });
	await radius.fill('');
	await radius.blur();

	await expect(radiusEditor.getByText('Enter a number.', { exact: true })).toBeVisible();
	await expect(radiusRow).not.toHaveAttribute('data-overridden', '');
});

test('the full rationale stays closed until its Why disclosure opens it', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const provenance = LIGHT.semantic.primary!.$extensions[CAMBIUM_NAMESPACE];
	const stepRole = STEP_ROLES.find((role) => role.step === 9)!.role;
	const expandedTrace = provenance.seedField
		? `From the seed's ${provenance.seedField}`
		: 'Not traced to a seed field';

	const editor = await openEditor(page, 'semantic.primary');
	const toggle = editor.getByRole('button', { name: 'Why semantic.primary', exact: true });
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');

	// Absent, not hidden: the block renders only once toggled.
	const expandedBlock = editor.locator('[data-rationale-expanded]');
	await expect(expandedBlock).toHaveCount(0);

	await toggle.click();

	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
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
		await expect(section).toHaveAttribute('data-untouched', '');
		await expect(section.getByText('Untouched default')).toBeVisible();
	}

	const derivedCategories: string[] = ['semantic', ...RAMP_NAMES, ...DERIVED_VALUE_CATEGORIES];

	for (const category of derivedCategories) {
		const section = tokensSection.locator(`section[data-category="${category}"]`);
		await expect(section).not.toHaveAttribute('data-source');
		await expect(section).not.toHaveAttribute('data-untouched');
		await expect(section.getByText('Untouched default')).toHaveCount(0);
	}
});

test('overriding a system value drops the untouched label without changing its source, and reset restores it', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const tokensSection = page.getByRole('region', { name: 'Tokens' });
	const section = tokensSection.locator('section[data-category="spacing"]');
	const row = section.locator('[data-token="spacing.md"]');
	const shown = TOKEN_SET.spacing.values.md!.value;

	await expect(section).toHaveAttribute('data-source', 'system');
	await expect(section).toHaveAttribute('data-untouched', '');

	const editor = await openEditor(page, 'spacing.md');
	const field = editor.getByLabel('spacing.md value', { exact: true });
	await field.fill(String(shown + 1));
	await field.blur();

	await expect(row).toHaveAttribute('data-overridden', '');
	// The source never moves: overriding a value doesn't change where it came from, only whether it
	// still matches what shipped.
	await expect(section).toHaveAttribute('data-source', 'system');
	await expect(section).not.toHaveAttribute('data-untouched');
	await expect(section.getByText('Untouched default')).toHaveCount(0);
	await expect(section.getByText('Default, edited')).toBeVisible();

	await editor.getByRole('button', { name: 'Reset spacing.md', exact: true }).click();

	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(section).toHaveAttribute('data-untouched', '');
	await expect(section.getByText('Untouched default')).toBeVisible();
	await expect(section.getByText('Default, edited')).toHaveCount(0);
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

	const editor = await openEditor(page, 'semantic.primary');
	await editor.getByLabel('primary alias', { exact: true }).selectOption('brand.1');
	// The popup hangs from the row and can cover its swatch, so it closes before the paint read.
	await closeEditor(page, editor);

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

	const editor = await openEditor(page, 'semantic.primary');
	await editor.getByLabel('primary alias', { exact: true }).selectOption('brand.1');
	await closeEditor(page, editor);
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

/**
 * The computed `background-color` of a throwaway element painted with `oklchCss`, so the swatch's
 * computed value is compared against one the browser normalised the same way rather than against a
 * spelling this spec guessed at. Hung off `<body>` so nothing the list does to its own rows can
 * reach the probe.
 */
async function probeComputedColour(page: Page, oklchCss: string): Promise<string> {
	return page.evaluate((fill) => {
		const probe = document.createElement('div');
		probe.style.backgroundColor = fill;
		document.body.appendChild(probe);

		try {
			return getComputedStyle(probe).backgroundColor;
		} finally {
			probe.remove();
		}
	}, oklchCss);
}

test('a version saved with overrides opens with them applied, and still does after a reload', async ({
	page,
}) => {
	const derivedLg = TOKEN_SET.radius.values.lg!.value;
	const overrides: TokenOverride[] = [
		{ kind: 'alias', scheme: 'light', token: 'primary', alias: 'brand.3' },
		{ kind: 'value', category: 'radius', path: ['lg', 'value'], value: derivedLg + 1 },
	];

	// Expectations come from applying the stored list in Node, not from the seed alone, so a page
	// that ignores the version's overrides shows the derived values and fails every check below.
	const applied = applyOverrides(TOKEN_SET, overrides);
	if (!applied.ok) throw new Error(`fixture overrides refused: ${JSON.stringify(applied.issues)}`);

	const expectedAlias = applied.tokenSet.schemes.light.semantic.primary!.alias;
	const expectedLg = applied.tokenSet.radius.values.lg!.value;
	const expectedStep = stepForAlias(applied.tokenSet.schemes.light.primitives, expectedAlias)!;

	expect(expectedAlias).not.toBe(LIGHT.semantic.primary!.alias);
	expect(expectedLg).not.toBe(derivedLg);
	expect(expectedStep).toBeDefined();

	const record = buildRecordWithSeed(SEED, overrides);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const primaryRow = page.locator('[data-token="semantic.primary"]');
	const radiusRow = page.locator('[data-token="radius.lg"]');
	const swatch = primaryRow.locator('[data-swatch]');

	// brand.3 and brand.9 have to paint differently for this seed, or the colour checks below would
	// pass on a page still showing the derived alias.
	const derivedStep = stepForAlias(LIGHT.primitives, LIGHT.semantic.primary!.alias)!;
	await expect(swatch).toBeVisible();
	expect(
		paintDistance(
			await referencePaint(page, swatch, oklchFromFields(expectedStep)),
			await referencePaint(page, swatch, oklchFromFields(derivedStep)),
		),
	).toBeGreaterThan(1);

	async function expectOverridesShown(): Promise<void> {
		await expect(primaryRow).toHaveAttribute('data-overridden', '');
		await expect(radiusRow).toHaveAttribute('data-overridden', '');

		const primaryEditor = await openEditor(page, 'semantic.primary');
		await expect(primaryEditor.getByLabel('primary alias', { exact: true })).toHaveValue(
			expectedAlias,
		);
		await closeEditor(page, primaryEditor);

		const radiusEditor = await openEditor(page, 'radius.lg');
		await expect(radiusEditor.getByLabel('radius.lg value', { exact: true })).toHaveValue(
			String(expectedLg),
		);
		await closeEditor(page, radiusEditor);

		const probe = await probeComputedColour(page, oklchFromFields(expectedStep));
		await expect(swatch).toHaveCSS('background-color', probe);

		// The computed value is what the cascade settled on; the pixel is what reached the screen.
		const target = await referencePaint(page, swatch, oklchFromFields(expectedStep));
		await expect
			.poll(async () => paintDistance(await paintedCentre(swatch), target))
			.toBeLessThanOrEqual(1);
	}

	await expectOverridesShown();

	await page.reload();

	await expectOverridesShown();
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

/** The issue items an editor lists under its controls, from a rejected edit or a held override. */
function issueItems(editor: Locator): Locator {
	return editor.locator('[data-issues] li');
}

test('a rejected edit retyped back to the shown value leaves no issue behind', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const shown = TOKEN_SET.opacity.values.overlay!.value;
	const row = page.locator('[data-token="opacity.overlay"]');
	const editor = await openEditor(page, 'opacity.overlay');
	const field = editor.getByLabel('opacity.overlay value', { exact: true });

	// Opacity tops out at 1, so the store refuses this and keeps nothing.
	await field.fill('9');
	await field.blur();
	await expect(issueItems(editor)).not.toHaveCount(0);

	await field.fill(String(shown));
	await field.blur();

	await expect(field).toHaveValue(String(shown));
	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(issueItems(editor)).toHaveCount(0);
});

test('reset clears a rejected edit made on top of a held override', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const shown = TOKEN_SET.opacity.values.overlay!.value;
	const row = page.locator('[data-token="opacity.overlay"]');
	const editor = await openEditor(page, 'opacity.overlay');
	const field = () => editor.getByLabel('opacity.overlay value', { exact: true });

	await field().fill('0.5');
	await field().blur();
	await expect(row).toHaveAttribute('data-overridden', '');

	await field().fill('9');
	await field().blur();
	await expect(issueItems(editor)).not.toHaveCount(0);

	// Reset leaves the popover open, so the value check after it reads the same editor.
	await editor.getByRole('button', { name: 'Reset opacity.overlay', exact: true }).click();

	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(field()).toHaveValue(String(shown));
	await expect(issueItems(editor)).toHaveCount(0);
});

test("a field issue raised in the light scheme doesn't follow the row into dark", async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const lightEditor = await openEditor(page, 'primitive.brand.1');
	const lightness = lightEditor.getByLabel('primitive.brand.1 l', { exact: true });

	await lightness.fill('');
	await lightness.blur();
	await expect(issueItems(lightEditor)).toHaveText(['Enter a number.']);

	// The outside press closes the popover, and the scheme-keyed remount drops the row's field state.
	await page.getByRole('button', { name: 'dark', exact: true }).click();
	await expect(lightEditor).toHaveCount(0);

	const darkEditor = await openEditor(page, 'primitive.brand.1');
	const darkStep = TOKEN_SET.schemes.dark.primitives.brand!.find((step) => step.step === 1)!;
	await expect(darkEditor.getByLabel('primitive.brand.1 l', { exact: true })).toHaveValue(
		String(darkStep.l),
	);
	await expect(issueItems(darkEditor)).toHaveCount(0);
});

test('reset puts every channel of a primitive back to its committed value, a refused one included', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const step = LIGHT.primitives.brand!.find((candidate) => candidate.step === 1)!;
	const row = page.locator('[data-token="primitive.brand.1"]');
	const editor = await openEditor(page, 'primitive.brand.1');
	const channel = (name: 'l' | 'c' | 'h') =>
		editor.getByLabel(`primitive.brand.1 ${name}`, { exact: true });

	await channel('c').fill('0.01');
	await channel('c').blur();
	await expect(row).toHaveAttribute('data-overridden', '');

	// L tops out at 1, so the store refuses this and L's committed value never moves. Its input is
	// the one a reset keyed only on committed values would leave showing the refused text.
	await channel('l').fill('2');
	await channel('l').blur();
	await expect(issueItems(editor)).not.toHaveCount(0);

	await editor.getByRole('button', { name: 'Reset primitive.brand.1', exact: true }).click();

	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(issueItems(editor)).toHaveCount(0);
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
	const editor = await openEditor(page, 'shadow.xs');
	const leaf = (label: string) => editor.getByLabel(`shadow.xs ${label}`, { exact: true });

	await leaf('offsetY').fill(String(shadow.offsetY.value + 1));
	await leaf('offsetY').blur();
	await expect(row).toHaveAttribute('data-overridden', '');

	await leaf('color.alpha').fill('2');
	await leaf('color.alpha').blur();
	await expect(issueItems(editor)).not.toHaveCount(0);

	await editor.getByRole('button', { name: 'Reset shadow.xs', exact: true }).click();

	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(issueItems(editor)).toHaveCount(0);

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

	await expect(editor.locator('input')).toHaveCount(Object.keys(committed).length);

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

	const primitive = await openEditor(page, 'primitive.brand.1');
	const lightness = primitive.getByLabel('primitive.brand.1 l', { exact: true });
	await lightness.fill('2');
	await lightness.blur();
	await expect(issueItems(primitive)).toHaveCount(1);
	await closeEditor(page, primitive);

	const shadow = await openEditor(page, 'shadow.xs');
	const alpha = shadow.getByLabel('shadow.xs color.alpha', { exact: true });
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
	const shadow = await openEditor(page, 'shadow.xs');
	const leaf = (label: string) => shadow.getByLabel(`shadow.xs ${label}`, { exact: true });
	await leaf('color.l').fill('2');
	await leaf('color.l').blur();
	await expect(issueItems(shadow)).toHaveCount(1);
	await leaf('color.alpha').fill('2');
	await leaf('color.alpha').blur();
	await expect(issueItems(shadow)).toHaveCount(2);
	await closeEditor(page, shadow);

	// Two cleared channels never reach the store, and share one message the same way.
	const primitive = await openEditor(page, 'primitive.brand.1');
	const channel = (name: 'l' | 'c') =>
		primitive.getByLabel(`primitive.brand.1 ${name}`, { exact: true });
	await channel('l').fill('');
	await channel('l').blur();
	await expect(issueItems(primitive)).toHaveCount(1);
	await channel('c').fill('');
	await channel('c').blur();
	await expect(issueItems(primitive)).toHaveCount(2);
});

test('a chroma too large to print is refused rather than crashing the workspace', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// `OklchChannelsSchema` bounds lightness and hue but puts no ceiling on chroma
	// (core/token-set.ts), so this parses clean past the schema. Only `toOklchCss`'s overflow guard
	// (core/css/oklch-css.ts) would ever catch it, which the swatch render calls well after the
	// override already sat in the store — the crash this scenario guards against.
	const step = LIGHT.primitives.brand!.find((candidate) => candidate.step === 1)!;
	const row = page.locator('[data-token="primitive.brand.1"]');
	const swatch = row.locator('[data-swatch]');
	const committed = await referencePaint(page, swatch, oklchFromFields(step));

	const editor = await openEditor(page, 'primitive.brand.1');
	const chroma = editor.getByLabel('primitive.brand.1 c', { exact: true });
	await chroma.fill('1e303');
	await chroma.blur();

	await expect(issueItems(editor)).toHaveCount(1);
	await expect(row).not.toHaveAttribute('data-overridden', '');
	// The popup can cover the swatch it hangs beside, so it closes before the paint read.
	await closeEditor(page, editor);

	// The workspace is still alive, not a crashed React tree: the whole token list survived, and the
	// swatch still paints the last value the store actually committed.
	await expect(page.getByRole('region', { name: 'Tokens' })).toBeVisible();
	expect(paintDistance(await paintedCentre(swatch), committed)).toBeLessThanOrEqual(1);
});

test('two cleared fields of one shadow row list as two items, not one', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	// Neither edit reaches the store. Each field holds its own "Enter a number." issue under its
	// own label, with the same message, so only the field tells them apart.
	const shadow = await openEditor(page, 'shadow.xs');
	const leaf = (label: string) => shadow.getByLabel(`shadow.xs ${label}`, { exact: true });
	await leaf('offsetX').fill('');
	await leaf('offsetX').blur();
	await expect(issueItems(shadow)).toHaveCount(1);
	await leaf('offsetY').fill('');
	await leaf('offsetY').blur();
	await expect(issueItems(shadow)).toHaveCount(2);
});

// 0.04045 is what WCAG 2.2 states; older copies carry 0.03928. No 8-bit channel lands between the
// two (10/255 sits under both, 11/255 over both), so a screenshot byte decodes the same either way.
function linearizeChannel(byte: number): number {
	const channel = byte / 255;
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: Rgb): number {
	return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

/**
 * Written from the WCAG formula rather than imported from `core/oklch.ts`'s `renderedContrast`, so
 * the pixel check below measures the row's printed number against arithmetic the pipeline didn't
 * supply.
 */
function wcagRatio(a: Rgb, b: Rgb): number {
	const lumA = relativeLuminance(a);
	const lumB = relativeLuminance(b);
	const lighter = Math.max(lumA, lumB);
	const darker = Math.min(lumA, lumB);

	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The preview heading's contrast as the compositor painted it, read from a screenshot of the
 * heading's own box (criterion 2). The commonest pixel in that box is the surface behind the text.
 * Glyph edges are antialiased, and a blend of two colours never out-contrasts either one, so the
 * pixel farthest from the surface is a fully covered stroke: the text colour itself.
 */
async function paintedHeadingContrast(page: Page): Promise<number> {
	const heading = page.locator('[data-preview-app-screen] h3', { hasText: 'Orders' });
	const png = PNG.sync.read(await heading.screenshot({ animations: 'disabled' }));

	const counts = new Map<string, { rgb: Rgb; count: number }>();
	for (let offset = 0; offset < png.data.length; offset += 4) {
		const rgb: Rgb = [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
		const id = rgb.join(',');
		const seen = counts.get(id);
		if (seen) seen.count += 1;
		else counts.set(id, { rgb, count: 1 });
	}

	const pixels = [...counts.values()];
	const surface = pixels.reduce((best, pixel) => (pixel.count > best.count ? pixel : best)).rgb;

	return Math.max(...pixels.map((pixel) => wcagRatio(pixel.rgb, surface)));
}

/** One `[data-contrast-verdict]` line, parsed back into the fields `token-row.tsx` printed it from. */
function parseVerdictLine(text: string): { label: string; wcag: number; target: number } {
	const match = /^(.+): ([\d.]+):1, needs ([\d.]+)$/.exec(text.trim());
	if (!match) throw new Error(`unparsed verdict line "${text}"`);

	return { label: match[1]!, wcag: Number(match[2]), target: Number(match[3]) };
}

function verdictOf(row: Locator): Locator {
	return row.locator('[data-contrast-verdict] [data-contrast-line]');
}

/**
 * The four declared pairs this seed's `background` -> `brand.9` override breaks, at the two decimals
 * the row prints. Worked out by running this spec's `SEED` through `BALANCED`,
 * `withContrastRepairs` and `core/contrast/check.ts` in a scratch script, not read off the row, so
 * the row can't supply its own expected value. They are still the pipeline's numbers, which is why
 * criterion 2 is checked against the painted pixels instead of against this table.
 */
const BACKGROUND_OVERRIDE_FAILURES = [
	{ label: 'foreground on background', target: 4.5, wcag: 3.29 },
	{ label: 'destructive on background', target: 4.5, wcag: 1.45 },
	{ label: 'ring on background', target: 3, wcag: 1.37 },
	{ label: 'sidebar-ring on background', target: 3, wcag: 1.37 },
] as const;

test('setting semantic.background to brand.9 shows the AA fails it causes, agrees with the rendered pixels, and Revert clears it', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const row = page.locator('[data-token="semantic.background"]');
	const trigger = editTrigger(page, 'semantic.background');
	const resolvesTo = row.locator('[data-resolves-to]');
	const verdict = row.locator('[data-contrast-verdict] [data-contrast-line]');
	const revert = row.getByRole('button', { name: 'Revert background override', exact: true });

	await expect(resolvesTo).toHaveAttribute('data-resolves-to', 'neutral.1');
	await expect(verdict).toHaveCount(0);

	const editor = await openEditor(page, 'semantic.background');
	await editor.getByLabel('background alias', { exact: true }).selectOption('brand.9');
	// Closed before the verdict and paint reads: the verdict lives on the row, not in the popup.
	await closeEditor(page, editor);

	await expect(row).toHaveAttribute('data-overridden', '');
	await expect(verdict).toHaveCount(BACKGROUND_OVERRIDE_FAILURES.length);

	// The verdict lands inside a polite live region the row already held, so it's announced.
	await expect(row.getByRole('status')).toContainText('foreground on background');
	// Revert and Reset both clear the override. Reset lives in the edit popover (Decision 21), so
	// the row itself offers only Revert.
	await expect(row.getByRole('button', { name: /^Reset\b/ })).toHaveCount(0);

	const lines = (await verdict.allTextContents()).map(parseVerdictLine);
	expect(lines).toEqual(BACKGROUND_OVERRIDE_FAILURES.map((failure) => ({ ...failure })));

	// Criterion 2: the row's `foreground on background` ratio against what the compositor painted.
	const printedRatio = lines[0]!.wcag;
	const paintedRatio = await paintedHeadingContrast(page);
	expect(Math.abs(paintedRatio - printedRatio)).toBeLessThanOrEqual(0.1);

	await revert.click();

	await expect(row).not.toHaveAttribute('data-overridden', '');
	await expect(resolvesTo).toHaveAttribute('data-resolves-to', 'neutral.1');
	// The alias select isn't in the DOM with the popover closed, so Revert hands focus to the
	// row's Edit trigger, the one control on the row that opens it (Decision 20).
	await expect(trigger).toBeFocused();
	const reopened = await openEditor(page, 'semantic.background');
	await expect(reopened.getByLabel('background alias', { exact: true })).toHaveValue('neutral.1');
	await closeEditor(page, reopened);
	await expect(verdict).toHaveCount(0);
	await expect.poll(() => paintedHeadingContrast(page)).toBeGreaterThanOrEqual(4.5);
});

test('a verdict lands only on the row whose override broke the pair, and its Revert clears it', async ({
	page,
}) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const foregroundRow = page.locator('[data-token="semantic.foreground"]');
	const backgroundRow = page.locator('[data-token="semantic.background"]');

	// Passes on its own. After the background change below, `foreground on background` fails, but
	// taking this override back wouldn't fix it: the base foreground fails on `brand.9` too.
	const foregroundEditor = await openEditor(page, 'semantic.foreground');
	await foregroundEditor.getByLabel('foreground alias', { exact: true }).selectOption('neutral.11');
	await closeEditor(page, foregroundEditor);
	await expect(foregroundRow).toHaveAttribute('data-overridden', '');
	await expect(verdictOf(foregroundRow)).toHaveCount(0);

	const backgroundEditor = await openEditor(page, 'semantic.background');
	await backgroundEditor.getByLabel('background alias', { exact: true }).selectOption('brand.9');
	await closeEditor(page, backgroundEditor);
	await expect(verdictOf(backgroundRow)).toHaveCount(BACKGROUND_OVERRIDE_FAILURES.length);
	await expect(verdictOf(backgroundRow).first()).toHaveText(/^foreground on background: /);
	await expect(verdictOf(foregroundRow)).toHaveCount(0);
	await expect(
		foregroundRow.getByRole('button', { name: 'Revert foreground override', exact: true }),
	).toHaveCount(0);

	await backgroundRow
		.getByRole('button', { name: 'Revert background override', exact: true })
		.click();

	await expect(backgroundRow.locator('[data-resolves-to]')).toHaveAttribute(
		'data-resolves-to',
		'neutral.1',
	);
	await expect(editTrigger(page, 'semantic.background')).toBeFocused();
	await expect(verdictOf(backgroundRow)).toHaveCount(0);
	await expect(foregroundRow).toHaveAttribute('data-overridden', '');
	await expect(verdictOf(foregroundRow)).toHaveCount(0);
	await expect.poll(() => paintedHeadingContrast(page)).toBeGreaterThanOrEqual(4.5);
});

test('an override that keeps every declared pair at AA shows no verdict', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const row = page.locator('[data-token="semantic.secondary"]');
	const swatch = row.locator('[data-swatch]');

	// Not `primary` -> `brand.1`, the shape the earlier re-aliasing scenario uses: `primary-foreground`
	// is `brand.1` for this seed, so that pair would drop to 1:1. `secondary-foreground` still clears
	// AA on `neutral.4`, and the paint check below proves the override actually landed.
	const targetStep = LIGHT.primitives.neutral!.find((step) => step.step === 4)!;
	const target = await referencePaint(page, swatch, oklchFromFields(targetStep));

	await expect(row.locator('[data-contrast-verdict]')).toHaveCount(0);

	const editor = await openEditor(page, 'semantic.secondary');
	await editor.getByLabel('secondary alias', { exact: true }).selectOption('neutral.4');
	await closeEditor(page, editor);

	await expect(row).toHaveAttribute('data-overridden', '');
	await expect
		.poll(async () => paintDistance(await paintedCentre(swatch), target))
		.toBeLessThanOrEqual(1);
	await expect(row.locator('[data-contrast-verdict]')).toHaveCount(0);
});

test('the Accessibility tab lists a failing pair instead of the placeholder', async ({ page }) => {
	const record = buildRecordWithSeed(SEED);
	await seedWorkspaceRecord(page, record);

	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const placeholder = page.getByText('The accessibility report is not built yet.', {
		exact: true,
	});
	const panel = page.getByRole('tabpanel', { name: 'Accessibility' });

	await expect(placeholder).toHaveCount(0);

	await page.getByRole('tab', { name: 'Accessibility' }).click();
	await expect(placeholder).toHaveCount(0);

	// Opening a token's editor doesn't touch the Output tab's selection.
	const editor = await openEditor(page, 'semantic.background');
	await editor.getByLabel('background alias', { exact: true }).selectOption('brand.9');
	await closeEditor(page, editor);

	await expect(panel.getByText('light: foreground on background:', { exact: false })).toBeVisible();
	await expect(placeholder).toHaveCount(0);
});
