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
