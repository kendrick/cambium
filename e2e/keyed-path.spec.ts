import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { cssNaming } from '../core/css/globals-css';
import { toOklchCss } from '../core/css/oklch-css';
// `with { type: 'json' }` for the same reason `keyed-flow.ts` needs it: this file runs as native
// Node ESM under Playwright, which refuses a JSON import without the attribute.
import structuredSuccessFixture from '../app/readers/fixtures/structured-success.json' with { type: 'json' };
import { VALID_FAMILIES_CSV } from '../app/fonts/fixtures/families.csv';

import { expect, test } from './fixtures';
import {
	generateWithFreshKey,
	imageIdFromRequest,
	mockAnthropic,
	saveOneRecord,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

/**
 * Distinct from `generate.spec.ts`'s `TEST_KEY`: that suite proves the real key never leaks, this
 * one proves no request escapes the mock boundary at all, so a key that is visibly fake is the
 * more honest fixture here — nothing in this file cares whether Anthropic considers it well-formed.
 */
const TEST_KEY = 'sk-ant-test-not-a-real-key';

/**
 * Everything the font lookup fetches from jsDelivr ends in this file (`UPSTREAM_URL` in
 * `app/fonts/font-table-provider.ts`), copied from `generate.spec.ts`'s own constant of the same
 * name for the reason every duplicated constant in this tree gives: a rename fails whichever spec
 * forgot to move with it. The workspace fires this fetch on load whenever a version's seed carries
 * a font pairing, which the fixture generation below does, so a scenario that doesn't route it
 * sends a real request to a real CDN — exactly what the guard above exists to catch.
 */
const FONT_TABLE_CSV_GLOB = '**/families.csv';

/**
 * Every request the guard below caught and aborted. Reset per test in `beforeEach` and read in
 * `afterEach`. A module-level array is safe here because `playwright.config.ts` declares one
 * project and Playwright runs one file's scenarios one at a time in their worker unless a spec
 * opts into parallel mode, which this one does not.
 */
let escaped: string[];

/**
 * The one thing every scenario in this file has to prove before it proves anything else: nothing
 * it does reaches a real network origin. `mockAnthropic` (`keyed-flow.ts`) installs its own route
 * on `ANTHROPIC_MESSAGES_URL` after this one runs, and Playwright matches the most recently
 * registered route first, so a mocked request is answered and gone before this handler's
 * `route.request().url()` would even see it. Anything that is not same-origin, `data:`, or `blob:`
 * gets aborted and named here, rather than left to fail some other way — a timeout, a flaky pass —
 * that would hide a real call behind a slow one.
 */
test.beforeEach(async ({ page, baseURL }) => {
	escaped = [];

	if (!baseURL) throw new Error('no baseURL configured for the e2e project');

	await page.route('**/*', async (route) => {
		const url = route.request().url();

		if (url.startsWith(baseURL) || url.startsWith('data:') || url.startsWith('blob:')) {
			await route.continue();
			return;
		}

		escaped.push(url);
		await route.abort();
	});
});

test.afterEach(() => {
	expect(
		escaped,
		`request(s) reached a real origin instead of the mock boundary:\n${escaped
			.map((url) => `  ${url}`)
			.join('\n')}`,
	).toEqual([]);
});

test('no real model call: ANTHROPIC_API_KEY is unset in the test environment', () => {
	expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
});

/**
 * The fixture's own brand key colour, read out of the recorded response rather than copied as a
 * literal: `successResponseBody` (`keyed-flow.ts`) rewrites the id fields but leaves every OKLCH
 * triple untouched, so what the seed rail renders after a real generation is exactly this colour,
 * printed the way `swatchFor` (`components/workspace/seed-rail/key-color-editor.tsx`) prints it.
 */
function fixtureBrandSwatch(): string {
	const body = structuredSuccessFixture.body as { content: { type: string; text?: string }[] };
	const textBlock = body.content.find((block) => block.type === 'text' && block.text);

	if (!textBlock?.text) {
		throw new Error('the success fixture carries no text block to read a seed from');
	}

	const seed = JSON.parse(textBlock.text) as {
		keyColors: { oklch: [number, number, number]; proposedRole: string }[];
	};
	const brand = seed.keyColors.find((color) => color.proposedRole === 'brand');

	if (!brand) throw new Error('the success fixture carries no brand-role key colour');

	const [l, c, h] = brand.oklch;
	return toOklchCss({ l, c, h }, { places: 4 });
}

/**
 * `semantic.primary`'s rendered swatch, `oklch(l c h)` at the precision `token-list.tsx` prints it
 * (`toOklchCss(resolved[token]!)`, no `places` override). Read fresh on every call so a caller can
 * poll it for a change without racing the store's own recompute.
 */
function primaryTokenValue(page: Page): Promise<string | null> {
	return page.locator('[data-token="semantic.primary"] [data-swatch-value]').textContent();
}

test('the keyed path: upload, generate, edit, pin, and download', async ({ page }) => {
	let recordId: string;

	await test.step('1. upload a reference image, save it, and generate against the mocked fixture', async () => {
		// The workspace the generation below lands on fetches the real font table on mount, since the
		// fixture seed states a font pairing. Fulfilled from a fixture rather than left unrouted, or
		// it would be a real request to a real CDN and the guard above would fail it.
		await page.route(FONT_TABLE_CSV_GLOB, (route) =>
			route.fulfill({ status: 200, contentType: 'text/csv', body: VALID_FAMILIES_CSV }),
		);

		recordId = await saveOneRecord(page);

		const sent = await mockAnthropic(page, (body) => ({
			status: 200,
			body: successResponseBody(imageIdFromRequest(body)),
		}));

		await waitForGenerateReady(page);
		await generateWithFreshKey(page, TEST_KEY);

		await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));
		expect(sent).toHaveLength(1);
	});

	await test.step('2. seed rendered: the seed rail shows the fixture brand key colour', async () => {
		await expect(page.getByText(fixtureBrandSwatch(), { exact: true })).toBeVisible();
	});

	let primaryAfterFirstEdit: string | null = null;

	await test.step("3. edit re-derives: the brand key colour's lightness moves the primary token, with no request", async () => {
		const before = await primaryTokenValue(page);

		const requestUrls: string[] = [];
		page.on('request', (request) => requestUrls.push(request.url()));
		const requestsBeforeEdit = requestUrls.length;

		await page.getByRole('button', { name: 'Edit brand key colour' }).click();
		const lightness = page.getByLabel('brand key colour lightness value', { exact: true });
		await lightness.fill('0.25');
		await lightness.blur();
		await page.keyboard.press('Escape');

		await expect.poll(() => primaryTokenValue(page)).not.toBe(before);
		primaryAfterFirstEdit = await primaryTokenValue(page);

		expect(requestUrls.length).toBe(requestsBeforeEdit);
	});

	await test.step('4. pin survives: pinning radius protects it through a second colour edit', async () => {
		const radiusPin = page.getByRole('button', { name: 'Pin radius' });
		await radiusPin.click();
		await expect(radiusPin).toHaveAttribute('aria-pressed', 'true');

		const radiusValue = page.getByLabel('radius.md value', { exact: true });
		const radiusBeforeSecondEdit = await radiusValue.inputValue();

		await page.getByRole('button', { name: 'Edit brand key colour' }).click();
		const lightness = page.getByLabel('brand key colour lightness value', { exact: true });
		await lightness.fill('0.4');
		await lightness.blur();
		await page.keyboard.press('Escape');

		await expect.poll(() => primaryTokenValue(page)).not.toBe(primaryAfterFirstEdit);
		expect(await radiusValue.inputValue()).toBe(radiusBeforeSecondEdit);
		await expect(radiusPin).toHaveAttribute('aria-pressed', 'true');
	});

	await test.step('5. downloads: the exported DTCG documents and stylesheet carry the post-edit value', async () => {
		// The alias the Tokens region currently shows for `primary`, read off the DOM rather than
		// assumed as the SEMANTIC_MAP default: whatever it resolves to is the path the export has to
		// carry the same value at, and reading it keeps this step honest if that default ever moves.
		const resolvesTo = await page
			.locator('[data-token="semantic.primary"] [data-resolves-to]')
			.getAttribute('data-resolves-to');
		if (!resolvesTo) {
			throw new Error('semantic.primary has no resolved alias to follow into the export');
		}
		const dot = resolvesTo.lastIndexOf('.');
		const rampName = resolvesTo.slice(0, dot);
		const step = resolvesTo.slice(dot + 1);

		// The value read in step 3/4, at the light scheme the Tokens region shows by default
		// (`token-list.tsx`'s `useState<SchemeName>('light')`). Light and dark ramps derive
		// independently (`AGENTS.md`'s "independent light and dark derivation"), so this number is
		// only the light scheme's, and the dark document below is checked for the path's existence
		// alone rather than for this same value.
		const finalPrimaryValue = await primaryTokenValue(page);
		if (!finalPrimaryValue) throw new Error('semantic.primary rendered no swatch value to compare');
		const channels = /^oklch\(([^ ]+) ([^ ]+) ([^ )]+)\)$/.exec(finalPrimaryValue);
		if (!channels) throw new Error(`unrecognised swatch text: ${finalPrimaryValue}`);
		const [expectedL, expectedC, expectedH] = [
			Number(channels[1]),
			Number(channels[2]),
			Number(channels[3]),
		];

		await page.getByRole('tab', { name: 'Export' }).click();

		const downloadButtons = page.getByRole('button', { name: /^Download / });
		await expect(downloadButtons).toHaveCount(3);

		const files: Record<string, string> = {};
		for (let index = 0; index < 3; index += 1) {
			// One click and one `download` event at a time, the same reason `export.spec.ts` does this
			// serially: firing every click together would race their `waitForEvent` calls against
			// events that may land in a different order than the clicks did.
			// oxlint-disable-next-line no-await-in-loop
			const [downloadEvent] = await Promise.all([
				page.waitForEvent('download'),
				downloadButtons.nth(index).click(),
			]);
			const filename = downloadEvent.suggestedFilename();
			// oxlint-disable-next-line no-await-in-loop
			const path = await downloadEvent.path();
			if (path === null) throw new Error(`download of ${filename} produced no saved file`);
			// oxlint-disable-next-line no-await-in-loop
			files[filename] = await readFile(path, 'utf-8');
		}

		// Read by suffix rather than by an assumed literal name: a record carrying a `brandUrl` (this
		// one has none) prefixes all three, per `export.spec.ts`.
		const lightName = Object.keys(files).find((name) => name.endsWith('light.tokens.json'));
		const darkName = Object.keys(files).find((name) => name.endsWith('dark.tokens.json'));
		const cssName = Object.keys(files).find((name) => name.endsWith('tokens.css'));
		if (!lightName || !darkName || !cssName) {
			throw new Error(`did not find all three artifacts among: ${Object.keys(files).join(', ')}`);
		}

		type DtcgColorValue = { components: readonly [number, number, number] };
		type DtcgDoc = {
			color: { primitive: Record<string, Record<string, { $value: DtcgColorValue }> | undefined> };
		};

		const light = JSON.parse(files[lightName]!) as DtcgDoc;
		const dark = JSON.parse(files[darkName]!) as DtcgDoc;

		const lightToken = light.color.primitive[rampName]?.[step];
		if (!lightToken) throw new Error(`${rampName}.${step} is missing from the light document`);
		const [lightL, lightC, lightH] = lightToken.$value.components;
		expect(lightL).toBeCloseTo(expectedL, 6);
		expect(lightC).toBeCloseTo(expectedC, 6);
		expect(lightH).toBeCloseTo(expectedH, 6);

		// The dark document derives its own ramp independently, so only the path's presence is
		// checked here — its value is asserted nowhere, and asserting it against the light reading
		// above would be asserting something the two schemes make no promise to agree on.
		expect(dark.color.primitive[rampName]?.[step]).toBeDefined();

		const primaryProperty = cssNaming().semanticProperty('primary');
		expect(files[cssName]).toContain(`${primaryProperty}: ${finalPrimaryValue};`);
	});
});
