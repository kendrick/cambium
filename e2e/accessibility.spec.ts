import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { paintedContrast, settle } from './painted-contrast';

/**
 * Typed out rather than imported from `app/demo/demo-fixtures.ts`, so a relabel there fails here.
 * `photo-window` because its unrepaired set fails AA, so the tab has repairs to show.
 */
const BUTTON = 'Open the Window photo demo';

const LIGHT_BRAND = 'light brand.1';
const LIGHT_NEUTRAL = 'light neutral.11';
const DARK_BRAND = 'dark brand.1';
const REPAIRS = [LIGHT_BRAND, LIGHT_NEUTRAL, DARK_BRAND] as const;

// Written from the plan's measurement of `photo-window`, not computed from the repair code, so a
// regression in repair can't move the expectation with it.
const AFTER_RATIO = 4.51;
const BEFORE_RATIO = 4.18;

/**
 * 8-bit sRGB rounding moves a painted ratio by about 0.01. One decimal digit (within 0.05) absorbs
 * that and still separates 4.18 from 4.51.
 */
const PAINT_PRECISION = 1;

/**
 * The closeness window above straddles 4.5, so a repair the compositor paints at 4.47 would pass it.
 * The threshold check catches that drift.
 */
const AA_TEXT = 4.5;

const PRIMARY_PAIR = 'primary-foreground on primary';

async function openDemo(page: Page): Promise<void> {
	await page.goto('/');
	await page
		.locator('[data-library-first-run]')
		.getByRole('button', { name: BUTTON, exact: true })
		.click();
	await page.waitForURL(/\/workspace\?record=/);
}

async function openAccessibility(page: Page): Promise<void> {
	await page.getByRole('tab', { name: 'Accessibility' }).click();
	await expect(page.getByRole('heading', { name: 'Repairs' })).toBeVisible();
}

const card = (page: Page, name: string): Locator =>
	page.locator(`[data-repair="${name.replace(' ', ':')}"]`);

const table = (page: Page, scheme: 'light' | 'dark'): Locator =>
	page.getByRole('table', { name: `Every declared pair, ${scheme}` });

const decline = (page: Page, name: string) =>
	page.getByRole('button', { name: `Decline repair of ${name}`, exact: true }).click();

const restore = (page: Page, name: string) =>
	page.getByRole('button', { name: `Restore repair of ${name}`, exact: true }).click();

const ALL_PASS = 'Every declared pair passes AA in both schemes.';

/** Typed out from `CONTRAST_PAIRS` rather than imported, so a pair dropped from the table fails here. */
const DECLARED_PAIRS = [
	'foreground on background',
	'card-foreground on card',
	'popover-foreground on popover',
	'primary-foreground on primary',
	'secondary-foreground on secondary',
	'muted-foreground on muted',
	'accent-foreground on accent',
	'sidebar-foreground on sidebar',
	'sidebar-primary-foreground on sidebar-primary',
	'sidebar-accent-foreground on sidebar-accent',
	'destructive on background',
	'ring on background',
	'sidebar-ring on background',
];

/** #174's floor (WCAG 2.2 SC 2.5.8), the same one `e2e/target-size.spec.ts` holds the other tabs to. */
const MIN_TARGET = 24;

test('the report lists every pair in both schemes with AA and advisory APCA columns', async ({
	page,
}) => {
	await openDemo(page);
	await openAccessibility(page);

	await expect(page.getByText(ALL_PASS)).toBeVisible();

	await Promise.all(
		(['light', 'dark'] as const).map(async (scheme) => {
			const rows = table(page, scheme).locator('tbody tr');

			await expect(rows).toHaveCount(13);
			expect(await rows.locator('td:nth-child(1)').allTextContents()).toEqual(DECLARED_PAIRS);
			await expect(
				table(page, scheme).getByRole('columnheader', { name: 'APCA Lc (advisory)' }),
			).toBeVisible();
			expect(await rows.locator('td:nth-child(4)').allTextContents()).toEqual(
				Array.from({ length: 13 }, () => 'Pass'),
			);

			const apca = await rows.locator('td:nth-child(5)').allTextContents();

			expect(apca).toHaveLength(13);
			for (const lc of apca) {
				expect(lc.trim(), `${scheme} APCA cell`).not.toBe('');
				expect(Number.isFinite(Number(lc)), `${scheme} APCA "${lc}"`).toBe(true);
			}
		}),
	);
});

test('three repairs show applied, with before and after ratios on the backed pairs', async ({
	page,
}) => {
	await openDemo(page);
	await openAccessibility(page);

	await expect(page.locator('[data-repair]')).toHaveCount(REPAIRS.length);

	await Promise.all(
		REPAIRS.flatMap((name) => [
			expect(card(page, name).getByRole('heading', { name })).toBeVisible(),
			expect(card(page, name)).toContainText('Applied'),
		]),
	);

	const brand = card(page, LIGHT_BRAND);

	await expect(brand.locator('[data-specimen]')).toHaveCount(2);
	await expect(brand).toContainText('Before 4.18:1');
	await expect(brand).toContainText('After 4.51:1');
});

test('the toggle swaps the failing and repaired paint in place', async ({ page }) => {
	await openDemo(page);
	await openAccessibility(page);

	const specimen = card(page, LIGHT_BRAND).locator(`[data-specimen="${PRIMARY_PAIR}"]`);
	const toggle = page.getByRole('button', {
		name: `Show ${LIGHT_BRAND} before repair`,
		exact: true,
	});

	await specimen.scrollIntoViewIfNeeded();
	await settle(page);
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	const applied = await paintedContrast(specimen);
	expect(applied, 'applied').toBeCloseTo(AFTER_RATIO, PAINT_PRECISION);

	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await settle(page);
	const before = await paintedContrast(specimen);
	expect(before, 'before repair').toBeCloseTo(BEFORE_RATIO, PAINT_PRECISION);
	expect(before, 'before repair').toBeLessThan(AA_TEXT);

	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await settle(page);
	const back = await paintedContrast(specimen);
	expect(back, 'toggled back').toBeCloseTo(AFTER_RATIO, PAINT_PRECISION);
});

// #190: repair accepts this pair at 4.511 in core's bytes (#0f0f10 on #647f8a), but Chromium paints
// the ink one green step off, rgb(15,16,16), and the pair lands at 4.487. `test.fail` keeps the
// check running: once #190 lands this case starts passing, Playwright reports it, and the marker
// comes off.
test('the repaired pair clears AA as Chromium paints it', async ({ page }) => {
	test.fail(true, '#190');
	await openDemo(page);
	await openAccessibility(page);

	const specimen = card(page, LIGHT_BRAND).locator(`[data-specimen="${PRIMARY_PAIR}"]`);

	await specimen.scrollIntoViewIfNeeded();
	await settle(page);
	expect(await paintedContrast(specimen), 'applied').toBeGreaterThanOrEqual(AA_TEXT);
});

test('declining and restoring a repair fails and clears only that scheme', async ({ page }) => {
	await openDemo(page);
	await openAccessibility(page);

	const fails = (scheme: 'light' | 'dark') =>
		table(page, scheme).locator('tbody td:nth-child(4)', { hasText: 'Fail' });

	await decline(page, LIGHT_BRAND);
	await expect(card(page, LIGHT_BRAND)).toContainText('Declined');
	await expect(page.getByText('2 declared pairs fail AA.')).toBeVisible();
	await expect(page.getByText(`light: ${PRIMARY_PAIR}: 4.18:1, needs 4.5`)).toBeVisible();
	await expect(page.getByText(`Repair declined: ${LIGHT_BRAND}`).first()).toBeVisible();

	const failingSpecimen = page.locator(`[data-failing-specimen="light: ${PRIMARY_PAIR}"]`);

	await failingSpecimen.scrollIntoViewIfNeeded();
	await settle(page);
	const declined = await paintedContrast(failingSpecimen);
	expect(declined, 'declined').toBeCloseTo(BEFORE_RATIO, PAINT_PRECISION);
	expect(declined, 'declined').toBeLessThan(AA_TEXT);

	await expect(fails('light')).toHaveCount(2);
	await expect(fails('dark')).toHaveCount(0);

	await restore(page, LIGHT_BRAND);
	await expect(card(page, LIGHT_BRAND)).toContainText('Applied');
	await expect(page.getByText(ALL_PASS)).toBeVisible();
	await expect(fails('light')).toHaveCount(0);

	await decline(page, DARK_BRAND);
	await expect(card(page, DARK_BRAND)).toContainText('Declined');
	await expect(card(page, LIGHT_BRAND)).toContainText('Applied');
	await expect(fails('dark')).toHaveCount(2);
	await expect(fails('light')).toHaveCount(0);

	await restore(page, DARK_BRAND);
	await expect(page.getByText(ALL_PASS)).toBeVisible();
});

test('bulk decline and restore cover every repair', async ({ page }) => {
	await openDemo(page);
	await openAccessibility(page);

	await page.getByRole('button', { name: 'Decline all repairs', exact: true }).click();

	await Promise.all(REPAIRS.map((name) => expect(card(page, name)).toContainText('Declined')));

	await expect(page.getByText('5 declared pairs fail AA.')).toBeVisible();

	const failingPairs = [
		'light: primary-foreground on primary',
		'light: sidebar-primary-foreground on sidebar-primary',
		'light: muted-foreground on muted',
		'dark: primary-foreground on primary',
		'dark: sidebar-primary-foreground on sidebar-primary',
	];

	await Promise.all(
		failingPairs.map((pair) =>
			expect(page.locator(`[data-failing-specimen="${pair}"]`), pair).toBeVisible(),
		),
	);

	await page.getByRole('button', { name: 'Restore all repairs', exact: true }).click();
	await expect(page.getByText(ALL_PASS)).toBeVisible();

	await Promise.all(REPAIRS.map((name) => expect(card(page, name)).toContainText('Applied')));
});

test('a declined repair survives save and reload', async ({ page }) => {
	await openDemo(page);
	await openAccessibility(page);

	await decline(page, LIGHT_NEUTRAL);
	await expect(card(page, LIGHT_NEUTRAL)).toContainText('Declined');

	const save = page.getByRole('button', { name: 'Save', exact: true });

	await save.click();
	// Disabled again once the commit lands, the same signal `keyed-path.spec.ts` waits on.
	await expect(save).toBeDisabled();
	await page.reload();
	await openAccessibility(page);

	await expect(card(page, LIGHT_NEUTRAL)).toContainText('Declined');
	await expect(page.locator('[data-token="primitive.neutral.11"]')).toHaveAttribute(
		'data-overridden',
		'',
	);
});

// `e2e/target-size.spec.ts` only opens the Seed and Tokens tabs, so the panel's controls get their
// own check against the same floor.
test('every control in the Accessibility tab meets the 24px target size', async ({ page }) => {
	await openDemo(page);
	await openAccessibility(page);

	const buttons = await page
		.getByRole('tabpanel', { name: 'Accessibility' })
		.getByRole('button')
		.all();

	expect(buttons.length).toBeGreaterThan(0);

	const measured = await Promise.all(
		buttons.map(async (button) => ({
			name: (await button.getAttribute('aria-label')) ?? (await button.textContent()),
			box: await button.boundingBox(),
		})),
	);

	for (const { name, box } of measured) {
		expect(box, `${name} has no box`).not.toBeNull();
		expect(Math.min(box!.width, box!.height), `${name}`).toBeGreaterThanOrEqual(MIN_TARGET);
	}
});

// Desktop Chrome's 1280×720. From md up the shell fixes the grid to the viewport, so a report that
// grows past its row runs over the raw-response row under it instead of scrolling (PR #191 review).
test('the report scrolls inside the Output pane on desktop', async ({ page }) => {
	await openDemo(page);
	await openAccessibility(page);

	const panel = page.getByRole('tabpanel', { name: 'Accessibility' });
	const raw = page.getByText('Raw model response', { exact: true });
	const [panelBox, rawBox] = await Promise.all([panel.boundingBox(), raw.boundingBox()]);

	expect(panelBox).not.toBeNull();
	expect(rawBox).not.toBeNull();
	expect(panelBox!.y + panelBox!.height, 'panel bottom vs raw response top').toBeLessThanOrEqual(
		rawBox!.y,
	);

	const sizes = await panel.evaluate((node) => ({
		scrollHeight: node.scrollHeight,
		clientHeight: node.clientHeight,
		page: document.documentElement.scrollHeight,
		viewport: window.innerHeight,
	}));

	expect(sizes.scrollHeight, 'the panel scrolls').toBeGreaterThan(sizes.clientHeight);
	expect(sizes.page, 'the page itself does not').toBeLessThanOrEqual(sizes.viewport);
});

// Below md the page is the one scroller (#157), so the panel mustn't trap a thumb in a nested one.
test('the report leaves scrolling to the page on a phone', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openDemo(page);
	await openAccessibility(page);

	const sizes = await page.getByRole('tabpanel', { name: 'Accessibility' }).evaluate((node) => ({
		scrollHeight: node.scrollHeight,
		clientHeight: node.clientHeight,
		page: document.documentElement.scrollHeight,
		viewport: window.innerHeight,
	}));

	expect(sizes.scrollHeight, 'the panel grows to its content').toBe(sizes.clientHeight);
	expect(sizes.page, 'and the page scrolls it').toBeGreaterThan(sizes.viewport);
});

// A card shows the pairs repair moved its step for. Re-aliasing a token in the token list changes the
// final set, not that history, and the shell has to hand the panel its pre-override set for the card
// to know the difference (#191).
test('a repair card keeps its pairs after a token is re-aliased in the token list', async ({
	page,
}) => {
	await openDemo(page);

	const row = page.locator('[data-token="semantic.primary-foreground"]');
	await page
		.getByRole('button', { name: /^Edit semantic\.primary-foreground( \(has issues\))?$/ })
		.click();
	const editor = page.locator('[data-editor="semantic.primary-foreground"]');
	await editor.getByLabel('primary-foreground alias', { exact: true }).selectOption('brand.12');
	await page.keyboard.press('Escape');
	await expect(editor).toHaveCount(0);
	await expect(row).toHaveAttribute('data-overridden', '');

	await openAccessibility(page);

	await expect(card(page, LIGHT_BRAND).locator('[data-specimen]')).toHaveCount(2);
	expect(
		await card(page, LIGHT_BRAND)
			.locator('[data-specimen]')
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-specimen'))),
	).toEqual([PRIMARY_PAIR, 'sidebar-primary-foreground on sidebar-primary']);
});
