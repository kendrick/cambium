import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
	generateWithFreshKey,
	imageIdFromRequest,
	mockAnthropic,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

/** WCAG 2.2 SC 2.5.8, in CSS pixels. */
const MIN_TARGET = 24;

type Hit = { control: string; width: number; height: number };

/**
 * Every visible range, number and checkbox input outside the preview, with the better of its own
 * box and its labels' boxes. The criterion measures the control or its label, because a click
 * anywhere on a wrapping label lands on the control. Popovers render outside `<main>`, so this reads
 * the whole document: the token list's number inputs exist only in its popovers.
 */
async function hitAreas(page: Page): Promise<Hit[]> {
	return page.evaluate(() =>
		[
			...document.querySelectorAll<HTMLInputElement>(
				'input[type="range"], input[type="number"], input[type="checkbox"]',
			),
		]
			.filter((input) => !input.closest('[data-preview]') && input.checkVisibility())
			.map((input) => {
				const boxes = [input, ...(input.labels ?? [])].map((node) => node.getBoundingClientRect());
				const best = boxes.reduce((a, b) =>
					Math.min(b.width, b.height) > Math.min(a.width, a.height) ? b : a,
				);
				return {
					control:
						input.getAttribute('aria-label') ??
						input.labels?.[0]?.textContent?.trim() ??
						input.type,
					width: Math.round(best.width * 100) / 100,
					height: Math.round(best.height * 100) / 100,
				};
			}),
	);
}

function tooSmall(hits: Hit[]): Hit[] {
	return hits.filter((hit) => hit.width < MIN_TARGET || hit.height < MIN_TARGET);
}

function phoneTab(page: Page, name: 'Seed' | 'Tokens'): Locator {
	return page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name });
}

/**
 * The workspace panels a person can see, by the name of the tab that labels each. Copied from
 * `e2e/workspace.spec.ts` (#157) rather than imported, since importing a spec registers its tests
 * twice. base-ui keeps an outgoing panel visible through its exit transition, so callers poll.
 */
async function visibleWorkspacePanels(page: Page): Promise<string[]> {
	return page
		.locator('main [role="tabpanel"]')
		.evaluateAll((panels) =>
			panels
				.filter((panel) => !panel.closest('[data-preview]') && panel.checkVisibility())
				.map(
					(panel) =>
						document
							.getElementById(panel.getAttribute('aria-labelledby') ?? '')
							?.textContent?.trim() ?? '',
				),
		);
}

/** Selects a phone tab and waits until its panel is the only one showing (Decision 1). */
async function selectPhoneTab(page: Page, name: 'Seed' | 'Tokens'): Promise<void> {
	await phoneTab(page, name).click();
	await expect(phoneTab(page, name)).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => visibleWorkspacePanels(page), { message: name }).toEqual([name]);
}

test.describe('at 390 × 844', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('every range slider, number input and checkbox in the seed rail and token list is at least 24 × 24', async ({
		page,
	}) => {
		await serveFontTable(page);
		await saveOneRecord(page);
		await mockAnthropic(page, (body) => ({
			status: 200,
			body: successResponseBody(imageIdFromRequest(body)),
		}));
		await waitForGenerateReady(page);
		await generateWithFreshKey(page, TEST_KEY);
		await expect(page).toHaveURL(/\/workspace\?record=/);

		// #157 (#181): below md only the selected tab's panel has a box (Decision 1).
		await selectPhoneTab(page, 'Seed');
		await page.getByRole('button', { name: 'Advanced parameters' }).click();

		const rail = await hitAreas(page);
		expect(rail.map((hit) => hit.control)).toEqual(
			expect.arrayContaining([
				'Sincere score',
				'Sophisticated score',
				'Rugged score',
				'Vintage score',
				'Neutral tinting',
				'Neutral temperature hue',
				'Type scale ratio',
				'Tint from surface',
				'Display differs from body',
			]),
		);
		expect(tooSmall(rail)).toEqual([]);

		await page.getByRole('button', { name: 'Edit brand key colour' }).click();
		const keyColour = await hitAreas(page);
		expect(keyColour.map((hit) => hit.control)).toEqual(
			expect.arrayContaining(['brand key colour lightness', 'brand key colour lightness value']),
		);
		expect(tooSmall(keyColour)).toEqual([]);
		await page.keyboard.press('Escape');

		await selectPhoneTab(page, 'Tokens');
		const tokens = page.getByRole('region', { name: 'Tokens' });

		await page
			.getByRole('button', { name: /^Edit primitive\.brand\.1( \(has issues\))?$/ })
			.click();
		await expect(page.locator('[data-editor="primitive.brand.1"]')).toBeVisible();
		const primitive = await hitAreas(page);
		expect(primitive.map((hit) => hit.control)).toEqual(
			expect.arrayContaining(['primitive.brand.1 l', 'primitive.brand.1 c', 'primitive.brand.1 h']),
		);
		expect(tooSmall(primitive)).toEqual([]);
		await page.keyboard.press('Escape');
		await expect(page.locator('[data-editor="primitive.brand.1"]')).toHaveCount(0);

		await tokens.getByRole('button', { name: 'shadow', exact: true }).click();
		await page.getByRole('button', { name: /^Edit shadow\.xs( \(has issues\))?$/ }).click();
		await expect(page.locator('[data-editor="shadow.xs"]')).toBeVisible();
		const shadow = await hitAreas(page);
		expect(shadow.map((hit) => hit.control)).toEqual(expect.arrayContaining(['shadow.xs color.l']));
		expect(tooSmall(shadow)).toEqual([]);
	});
});
