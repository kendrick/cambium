import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
	fixtureBrandKeyColor,
	generateWithFreshKey,
	imageIdFromRequest,
	mockAnthropic,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

/**
 * Distinct from `generate.spec.ts`'s `TEST_KEY`: that suite proves the real key never leaks, this
 * one proves no request escapes the mock boundary at all, so a key that is visibly fake is the
 * more honest fixture here—nothing in this file cares whether Anthropic considers it well-formed.
 */
const TEST_KEY = 'sk-ant-test-not-a-real-key';

/**
 * Every request the guard below caught and aborted. Reset per test in `beforeEach` and read in
 * `afterEach`. A module-level array is safe here because each worker loads its own module and runs
 * this file's tests serially, unless a spec opts into parallel mode, which this one does not.
 */
let escaped: string[];

/**
 * The one thing every scenario in this file has to prove before it proves anything else: nothing
 * it does reaches a real network origin. `mockAnthropic` (`keyed-flow.ts`) installs its own route
 * on `ANTHROPIC_MESSAGES_URL` after this one runs, and Playwright matches the most recently
 * registered route first, so a mocked request is answered and gone before this handler's
 * `route.request().url()` would even see it. Anything that is not same-origin, `data:`, or `blob:`
 * gets aborted and named here, rather than left to fail some other way—a timeout, a flaky pass—that
 * would hide a real call behind a slow one.
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

/**
 * `oklch(l c h)` as `toOklchCss` prints it, split into its three numbers. Parsed back out of the
 * DOM rather than compared as text, so this checks the rendered value against the fixture's own
 * numbers instead of against another call to the same formatter the UI used to print it.
 */
function parseOklchChannels(text: string): [number, number, number] {
	const channels = /^oklch\(([^ ]+) ([^ ]+) ([^ )]+)\)$/.exec(text);
	if (!channels) throw new Error(`unrecognised swatch text: ${text}`);
	return [Number(channels[1]), Number(channels[2]), Number(channels[3])];
}

/** The `oklch(...)` text `seed-rail.tsx` prints beside a key colour's swatch, by its pin path. */
function keyColorRailSwatch(page: Page, path: `keyColors.${number}`) {
	return page.locator(`[data-seed-field="${path}"] .font-mono`);
}

/**
 * Half a unit in the last place the token list prints an OKLCH channel at, three decimals since
 * #159. A value printed there sits within this of the one it was rounded from. The 1e-12 absorbs
 * binary round-off at the exact half-way point and loosens nothing else.
 */
function expectWithinPrinted(actual: number, printed: number, label: string): void {
	expect(Math.abs(actual - printed), label).toBeLessThanOrEqual(0.0005 + 1e-12);
}

/**
 * `semantic.primary`'s rendered swatch text, `oklch(l c h)` as the token list prints it: three
 * decimals per channel, rounded for reading. Read fresh on every call so a caller can poll it for a
 * change without racing the store's own recompute.
 */
function primaryTokenValue(page: Page): Promise<string | null> {
	return page.locator('[data-token="semantic.primary"] [data-swatch-value]').textContent();
}

/**
 * Opens a key colour's popover, sets its lightness, and closes it the way a person would: blur to
 * commit the number field, then Escape to dismiss the popover. Steps 3 and 4 below each edit a
 * different key colour's lightness to prove a different part of re-derivation, so they share this
 * rather than each retyping the open/fill/blur/Escape sequence.
 */
async function editKeyColorLightness(page: Page, label: string, value: string): Promise<void> {
	await page.getByRole('button', { name: `Edit ${label}` }).click();
	const lightness = page.getByLabel(`${label} lightness value`, { exact: true });
	await lightness.fill(value);
	await lightness.blur();
	await page.keyboard.press('Escape');
}

test('the keyed path: upload, generate, edit, pin, and download', async ({ page }) => {
	let recordId: string;

	await test.step('1. upload a reference image, save it, and generate against the mocked fixture', async () => {
		// The workspace this generation lands on fetches the real font table on mount, since the
		// fixture seed states a font pairing. Answered from a fixture rather than left unrouted, or it
		// would be a real request to a real CDN and the guard above would fail it.
		await serveFontTable(page);

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
		const brandSwatch = keyColorRailSwatch(page, 'keyColors.0');
		await expect(brandSwatch).toBeVisible();

		const [l, c, h] = parseOklchChannels((await brandSwatch.textContent()) ?? '');
		const [expectedL, expectedC, expectedH] = fixtureBrandKeyColor().oklch;
		expect(l).toBeCloseTo(expectedL, 3);
		expect(c).toBeCloseTo(expectedC, 3);
		expect(h).toBeCloseTo(expectedH, 3);
	});

	let primaryAfterFirstEdit: string | null = null;

	await test.step("3. edit re-derives: the brand key colour's lightness moves the primary token, with no request", async () => {
		const before = await primaryTokenValue(page);

		const requestUrls: string[] = [];
		page.on('request', (request) => requestUrls.push(request.url()));

		await editKeyColorLightness(page, 'brand key colour', '0.25');

		await expect.poll(() => primaryTokenValue(page)).not.toBe(before);
		primaryAfterFirstEdit = await primaryTokenValue(page);

		// The route guard above and `mockAnthropic`'s own capture already prove no real call landed
		// anywhere in this test; this checks the narrower claim that the edit itself sent nothing.
		expect(requestUrls).toEqual([]);
	});

	await test.step('4. pin survives: the brand key colour holds while an unrelated edit re-derives around it', async () => {
		// v1 ships exactly one consumer of a pin: contrast repair (`core/seed-pins.ts`'s
		// `repairPinsFor`, read by `app/state/workspace-store.ts`'s `withContrastRepairs`). A sweep of
		// this seed's brand and accent lightness across the chroma range never found repair moving step
		// 9, pinned or not, so this step passes whether or not the pin below does anything—it can show
		// that the brand key colour survives a re-derivation it has nothing to do with, not that the
		// pin is what holds it there. #146 gives a pin a case repair can actually decide.
		const brandPin = page.getByRole('button', { name: 'Pin brand key colour' });
		// Generation pins every key colour by default (`defaultSeedPins`); confirmed rather than
		// assumed, in case something upstream ever unpinned it.
		if ((await brandPin.getAttribute('aria-pressed')) !== 'true') await brandPin.click();
		await expect(brandPin).toHaveAttribute('aria-pressed', 'true');

		const brandSwatch = keyColorRailSwatch(page, 'keyColors.0');
		const brandValueBeforeAccentEdit = await brandSwatch.textContent();

		// The accent ramp is anchored on the accent key colour's own channels
		// (`core/oklch-scale-engine.ts`'s `accentAnchor`), so this is the token an accent edit has to
		// move to prove the re-derivation actually ran, while `primary` (aliased to `brand.9`) has no
		// reason to follow it.
		const accentSwatch = page.locator('[data-token="primitive.accent.9"] [data-swatch-value]');
		const accentBeforeEdit = await accentSwatch.textContent();

		await editKeyColorLightness(page, 'accent key colour', '0.4');

		await expect.poll(() => accentSwatch.textContent()).not.toBe(accentBeforeEdit);

		expect(await brandSwatch.textContent()).toBe(brandValueBeforeAccentEdit);
		await expect(brandPin).toHaveAttribute('aria-pressed', 'true');
		expect(await primaryTokenValue(page)).toBe(primaryAfterFirstEdit);

		const save = page.getByRole('button', { name: 'Save', exact: true });
		await save.click();
		// A hand-edited seed still settles to "not dirty" once the commit lands, the same signal
		// `seed-rail.spec.ts`'s own pin-and-reload scenario waits on.
		await expect(save).toBeDisabled();

		await page.reload();

		await expect(brandSwatch).toHaveText(brandValueBeforeAccentEdit ?? '');
		await expect(brandPin).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => primaryTokenValue(page)).toBe(primaryAfterFirstEdit);
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

		// Read fresh here rather than carried over from step 3 or 4: the Tokens region shows the light
		// scheme by default (`token-list.tsx`'s `useState<SchemeName>('light')`), and light and dark
		// ramps derive independently (`docs/agents/testing.md`'s "independent light and dark
		// derivation"), so this number is only the light scheme's, and the dark document below is
		// checked for the path's existence alone rather than for this same value.
		const finalPrimaryValue = await primaryTokenValue(page);
		if (!finalPrimaryValue) throw new Error('semantic.primary rendered no swatch value to compare');
		const [expectedL, expectedC, expectedH] = parseOklchChannels(finalPrimaryValue);

		await page.getByRole('tab', { name: 'Export' }).click();

		// The pane has a button per archive file plus one for the archive. This step reads only the two DTCG documents and the stylesheet, picked by name suffix for the same reason the lookups below are.
		const downloadButtons = page.getByRole('button', {
			name: /^Download (.+-)?(light\.tokens\.json|dark\.tokens\.json|tokens\.css)$/,
		});
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
		expectWithinPrinted(lightL, expectedL, 'light l');
		expectWithinPrinted(lightC, expectedC, 'light c');
		expectWithinPrinted(lightH, expectedH, 'light h');

		// The dark document derives its own ramp independently, so only the path's presence is
		// checked here—its value is asserted nowhere, and asserting it against the light reading
		// above would be asserting something the two schemes make no promise to agree on.
		expect(dark.color.primitive[rampName]?.[step]).toBeDefined();

		// Literal rather than `cssNaming().semanticProperty('primary')`: that call is the same naming
		// logic the CSS adapter itself uses to write the property, so asserting against it would only
		// prove the adapter agrees with itself.
		// The first `--primary` is the light scheme's: the stylesheet writes `:root` before `.dark`.
		const cssPrimary = /--primary: (oklch\([^;]+\));/.exec(files[cssName]!);
		if (!cssPrimary) throw new Error('tokens.css declares no --primary colour');
		const [cssL, cssC, cssH] = parseOklchChannels(cssPrimary[1]!);
		expectWithinPrinted(cssL, expectedL, 'tokens.css l');
		expectWithinPrinted(cssC, expectedC, 'tokens.css c');
		expectWithinPrinted(cssH, expectedH, 'tokens.css h');

		// The rounded text can't show whether the two exports agree past three decimals, so check that
		// directly: the stylesheet and the light document carry the same colour.
		expect(cssL).toBeCloseTo(lightL, 6);
		expect(cssC).toBeCloseTo(lightC, 6);
		expect(cssH).toBeCloseTo(lightH, 6);
	});
});
