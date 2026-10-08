import type { Page } from '@playwright/test';

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

const VIEWPORT = { width: 390, height: 844 };

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

type Step = { control: string; top: number; barBottom: number; inBar: boolean; scrollY: number };

/** Boxes as the browser laid them out after the last key press: the consumer's units. */
async function readStep(page: Page): Promise<Step> {
	return page.evaluate(() => {
		const active = document.activeElement as HTMLElement;
		const bar = document.querySelector('[data-workspace-bar]')!.getBoundingClientRect();
		return {
			control: active.getAttribute('aria-label') ?? active.tagName.toLowerCase(),
			top: active.getBoundingClientRect().top,
			barBottom: bar.bottom,
			inBar: active.closest('[data-workspace-bar]') !== null,
			scrollY: window.scrollY,
		};
	});
}

test.describe('at 390 × 844', () => {
	test.use({ viewport: VIEWPORT });

	test('Shift+Tab back up the token list never leaves the focused control under the sticky bar', async ({
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

		const tokensTab = page
			.getByRole('tablist', { name: 'Workspace' })
			.getByRole('tab', { name: 'Tokens' });
		await tokensTab.click();
		await expect.poll(() => visibleWorkspacePanels(page)).toEqual(['Tokens']);

		// Forward from the tab, until the page has scrolled two screens under the bar.
		let deep = await readStep(page);
		for (let press = 0; press < 300 && deep.scrollY < 2 * VIEWPORT.height; press += 1) {
			await page.keyboard.press('Tab');
			deep = await readStep(page);
		}
		expect(deep.scrollY, 'Tab went deep into the token list').toBeGreaterThanOrEqual(
			2 * VIEWPORT.height,
		);

		// Back up one control at a time, until the walk has climbed a full screen.
		const covered: Step[] = [];
		let step = deep;
		for (let press = 0; press < 300 && step.scrollY > deep.scrollY - VIEWPORT.height; press += 1) {
			await page.keyboard.press('Shift+Tab');
			step = await readStep(page);
			if (step.inBar) break;
			// One pixel of slack for sub-pixel layout. A covered control sits a whole row under the bar.
			if (step.top < step.barBottom - 1) covered.push(step);
		}
		expect(step.scrollY, 'Shift+Tab climbed a full screen').toBeLessThanOrEqual(
			deep.scrollY - VIEWPORT.height,
		);
		expect(covered, 'focused controls whose top sat under the sticky bar').toEqual([]);
	});
});
