import type { Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';

import { expect, test } from './fixtures';
import {
	generateButton,
	generateWithFreshKey,
	imageIdFromRequest,
	mockAnthropic,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

/**
 * DPR 2, so a 2 CSS px outline covers four device pixels and an edge that lands mid-pixel still
 * leaves one of its two partial pixels at least half covered.
 */
test.use({ deviceScaleFactor: 2 });

const DPR = 2;
/** CSS px examined outside each edge of the border box. */
const BAND = 8;
/** WCAG 2.2 SC 1.4.11. */
const FOCUS_TARGET = 3;
/** WCAG 2.2 SC 1.4.3, for the placeholder text. */
const TEXT_TARGET = 4.5;
const MIN_WIDTH_CSS = 2;
const TEST_KEY = 'sk-ant-focus-indicator-e2e';

type Rgb = readonly [number, number, number];
type Box = { x: number; y: number; width: number; height: number };
type Side = 'left' | 'right' | 'top' | 'bottom';
const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];

/** WCAG 2.2 relative luminance, written from the spec rather than borrowed from `core/`, so the check doesn't share a method with the code it guards. */
function linear(channel: number): number {
	const s = channel / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
	const [la, lb] = [luminance(a), luminance(b)];
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function pixel(png: PNG, x: number, y: number): Rgb {
	const i = (y * png.width + x) * 4;
	return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

async function requireBox(locator: Locator): Promise<Box> {
	const box = await locator.boundingBox();
	if (!box) throw new Error('expected the control to have a bounding box');
	return box;
}

async function shoot(page: Page, clip: Box): Promise<PNG> {
	return PNG.sync.read(await page.screenshot({ clip, animations: 'disabled' }));
}

/** An integer CSS px clip reaching BAND px past the border box on every side. */
function clipAround(box: Box): Box {
	const x = Math.floor(box.x) - BAND;
	const y = Math.floor(box.y) - BAND;
	return {
		x,
		y,
		width: Math.ceil(box.x + box.width) + BAND - x,
		height: Math.ceil(box.y + box.height) + BAND - y,
	};
}

/** Device pixels strictly outside the border box, walking outward from one edge's midpoint, nearest first. */
function outwardRun(box: Box, clip: Box, png: PNG, side: Side): [number, number][] {
	const left = (box.x - clip.x) * DPR;
	const right = (box.x + box.width - clip.x) * DPR;
	const top = (box.y - clip.y) * DPR;
	const bottom = (box.y + box.height - clip.y) * DPR;
	const midX = Math.floor((left + right) / 2);
	const midY = Math.floor((top + bottom) / 2);
	const run: [number, number][] = [];

	if (side === 'left') for (let x = Math.floor(left) - 1; x >= 0; x--) run.push([x, midY]);
	if (side === 'right') for (let x = Math.ceil(right); x < png.width; x++) run.push([x, midY]);
	if (side === 'top') for (let y = Math.floor(top) - 1; y >= 0; y--) run.push([midX, y]);
	if (side === 'bottom') for (let y = Math.ceil(bottom); y < png.height; y++) run.push([midX, y]);

	return run;
}

/** Focus lands by a real Tab keypress, so `:focus-visible` comes from the keyboard. */
async function focusByKeyboard(page: Page, target: Locator): Promise<void> {
	await target.focus();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Tab');
	await expect(target).toBeFocused();
}

type Shots = { box: Box; clip: Box; unfocused: PNG; focused: PNG };

/**
 * The same clip with nothing focused and then with the control focused. The unfocused pixel is the
 * adjacent background the indicator has to stand out from, whatever that background is.
 */
async function shootFocus(page: Page, target: Locator): Promise<Shots> {
	await target.scrollIntoViewIfNeeded();
	await page.mouse.move(0, 0);
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

	const box = await requireBox(target);
	const clip = clipAround(box);
	const unfocused = await shoot(page, clip);

	await focusByKeyboard(page, target);
	expect(
		await requireBox(target),
		'focusing moved the control, so the shots no longer line up',
	).toEqual(box);

	return { box, clip, unfocused, focused: await shoot(page, clip) };
}

async function reachWorkspace(page: Page): Promise<string> {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);
	await waitForGenerateReady(page);
	await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));
	await generateWithFreshKey(page, TEST_KEY);
	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));
	return recordId;
}

test("a button in the preview's sample app draws the generated ring, not the chrome outline", async ({
	page,
}) => {
	await reachWorkspace(page);

	const preview = page.locator('[data-preview]');
	const action = preview.locator('[data-preview-part="primary-action"]');
	await expect(action).toBeVisible();

	// Pure red stands in for brand.11, so where the painted colour comes from shows up as a hue
	// shift no grey ring and no foreground outline can produce.
	await preview.evaluate((element) =>
		(element as HTMLElement).style.setProperty('--ring', 'rgb(255 0 0)'),
	);

	const shots = await shootFocus(page, action);

	for (const side of SIDES) {
		const run = outwardRun(shots.box, shots.clip, shots.focused, side);
		// An empty band makes Math.max return -Infinity, which passes `<= 2` without reading a pixel.
		expect(run.length, `${side} edge: the scan covers the whole band`).toBeGreaterThanOrEqual(
			BAND * DPR,
		);
		const shift = run.map(([x, y]) => {
			const [fr, fg, fb] = pixel(shots.focused, x, y);
			const [ur, ug, ub] = pixel(shots.unfocused, x, y);
			return {
				red: fr - ur - (fg - ug),
				drift: Math.max(Math.abs(fr - ur), Math.abs(fg - ug), Math.abs(fb - ub)),
			};
		});

		// Within 3 CSS px: the ring, reading --ring from the preview.
		const ringBand = shift.slice(0, 3 * DPR);
		expect(
			Math.max(...ringBand.map((s) => s.red)),
			`${side} edge: ring shifts toward --ring`,
		).toBeGreaterThanOrEqual(100);

		// Beyond it: nothing, so no outline reached into the preview.
		const outlineBand = shift.slice(3 * DPR);
		expect(
			Math.max(...outlineBand.map((s) => s.drift)),
			`${side} edge: nothing drawn past the ring`,
		).toBeLessThanOrEqual(2);
	}
});

type Reading = { side: Side; ratio: number; widthCss: number };

async function readIndicator(page: Page, target: Locator): Promise<Reading[]> {
	const shots = await shootFocus(page, target);

	return SIDES.map((side) => {
		const ratios = outwardRun(shots.box, shots.clip, shots.focused, side).map(([x, y]) =>
			contrast(pixel(shots.focused, x, y), pixel(shots.unfocused, x, y)),
		);
		return {
			side,
			ratio: Math.max(1, ...ratios),
			widthCss: ratios.filter((ratio) => ratio >= FOCUS_TARGET).length / DPR,
		};
	});
}

/** Soft, so a regression reports every control and edge that falls short in one run, not just the first. */
function expectIndicator(name: string, readings: Reading[]): void {
	for (const { side, ratio, widthCss } of readings) {
		expect
			.soft(ratio, `${name}, ${side} edge: ${ratio.toFixed(2)}:1`)
			.toBeGreaterThanOrEqual(FOCUS_TARGET);
		expect
			.soft(widthCss, `${name}, ${side} edge: ${widthCss} CSS px at 3:1`)
			.toBeGreaterThanOrEqual(MIN_WIDTH_CSS);
	}
}

type Scheme = 'light' | 'dark';

/**
 * The chrome has no dark switch yet, so the dark pass sets the class `app/globals.css`'s `.dark`
 * block keys on. Set after hydration, so React never sees an attribute it didn't render.
 */
async function applyScheme(page: Page, scheme: Scheme): Promise<void> {
	if (scheme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'));
	await expectScheme(page, scheme);
}

/**
 * Checked again right before each measurement, because a re-render or a client navigation between
 * `applyScheme` and the screenshot could drop the class and a dark pass would quietly measure light.
 */
async function expectScheme(page: Page, scheme: Scheme): Promise<void> {
	const html = page.locator('html');
	if (scheme === 'dark') await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
	else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
}

async function readIndicatorIn(page: Page, scheme: Scheme, target: Locator): Promise<Reading[]> {
	await expectScheme(page, scheme);
	return readIndicator(page, target);
}

/**
 * The placeholder as the browser paints it, against its own field. The field colour is the most
 * common pixel in the field's interior, and the text colour is whichever pixel contrasts most with
 * it. Rasterised glyphs can land lighter or darker than the declared colour (antialiasing, text
 * gamma), and the painted pixel is what a reader sees, so that's the unit measured here.
 */
async function placeholderContrast(page: Page, field: Locator): Promise<number> {
	await expect(field).toHaveValue('');
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

	const box = await requireBox(field);
	// Inset 2 CSS px, so the 1px border and its antialiased edge stay out of the sample.
	const png = await shoot(page, {
		x: box.x + 2,
		y: box.y + 2,
		width: box.width - 4,
		height: box.height - 4,
	});

	const counts = new Map<string, { rgb: Rgb; n: number }>();
	for (let y = 0; y < png.height; y++)
		for (let x = 0; x < png.width; x++) {
			const rgb = pixel(png, x, y);
			const key = rgb.join(',');
			const entry = counts.get(key) ?? { rgb, n: 0 };
			entry.n++;
			counts.set(key, entry);
		}
	const background = [...counts.values()].reduce((a, b) => (b.n > a.n ? b : a)).rgb;

	let best = 1;
	for (let y = 0; y < png.height; y++)
		for (let x = 0; x < png.width; x++)
			best = Math.max(best, contrast(pixel(png, x, y), background));
	return best;
}

for (const scheme of ['light', 'dark'] as const) {
	test(`every measured chrome control draws a focus indicator at 3:1 and 2px, ${scheme}`, async ({
		page,
	}) => {
		await serveFontTable(page);

		await page.goto('/');
		const brandSite = page.getByLabel('Brand site');
		await expect(brandSite).toBeVisible();
		await applyScheme(page, scheme);
		const placeholder = await placeholderContrast(page, brandSite);
		expect
			.soft(placeholder, `Brand site placeholder: ${placeholder.toFixed(2)}:1`)
			.toBeGreaterThanOrEqual(TEXT_TARGET);
		expectIndicator('Brand site text input', await readIndicatorIn(page, scheme, brandSite));

		const recordId = await saveOneRecord(page);
		await waitForGenerateReady(page);
		await applyScheme(page, scheme);
		expectIndicator('Generate button', await readIndicatorIn(page, scheme, generateButton(page)));

		await mockAnthropic(page, (body) => ({
			status: 200,
			body: successResponseBody(imageIdFromRequest(body)),
		}));
		await generateWithFreshKey(page, TEST_KEY);
		await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));
		await applyScheme(page, scheme);

		const outputTab = page
			.getByRole('tablist', { name: 'Output' })
			.getByRole('tab', { name: 'Preview' });
		expectIndicator('Output tab', await readIndicatorIn(page, scheme, outputTab));
		expectIndicator(
			'Pin toggle',
			await readIndicatorIn(page, scheme, page.getByRole('button', { name: 'Pin tracking' })),
		);
		expectIndicator(
			'Native select',
			await readIndicatorIn(
				page,
				scheme,
				page.getByRole('combobox', { name: 'Tracking', exact: true }),
			),
		);
	});
}
