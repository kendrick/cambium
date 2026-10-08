import type { Page } from '@playwright/test';

// `with { type: 'json' }`: Playwright runs this file as native Node ESM, whose loader wants it.
import structuredSuccessFixture from '../app/readers/fixtures/structured-success.json' with { type: 'json' };

import { expect, test } from './fixtures';
import {
	generateWithFreshKey,
	mockAnthropic,
	saveOneRecord,
	serveFontTable,
	waitForGenerateReady,
} from './keyed-flow';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

/** `max-h-64`: the cap the `<pre>` had at every width before #174. */
const OLD_CAP_PX = 256;

/**
 * Prose where JSON was expected, which the panel reports as not-JSON and shows raw. Forty lines are
 * taller than the old cap at 390px, and the last line is one unbroken 400-character run, wider than
 * the viewport unless something wraps it.
 */
const LONG_RAW = [
	...Array.from(
		{ length: 40 },
		(_, index) => `line ${index + 1}: the model answered in prose rather than JSON`,
	),
	'x'.repeat(400),
].join('\n');

function proseResponseBody(): unknown {
	return {
		...(structuredSuccessFixture.body as Record<string, unknown>),
		model: 'claude-opus-5-5',
		content: [{ type: 'text', text: LONG_RAW }],
	};
}

/**
 * Elements in `<main>`, outside the preview, that scroll on their own: `overflow` `auto` or `scroll`
 * on an axis where the content outruns the box. #157's `selfScrollers` (`e2e/workspace.spec.ts`)
 * tests the same overflow condition but still counts vertical scrolling inside the preview. This
 * leaves the preview out on both axes, as the criterion does.
 */
async function ownScrollers(page: Page): Promise<string[]> {
	return page.locator('main').evaluate((main) =>
		[...main.querySelectorAll<HTMLElement>('*')]
			.filter((node) => !node.closest('[data-preview]'))
			.filter((node) => {
				const style = getComputedStyle(node);
				// A regex, not a helper: `evaluate` serializes this callback, so nothing outside it exists
				// in the page.
				const scrolls = /^(auto|scroll)$/;
				return (
					(scrolls.test(style.overflowY) && node.scrollHeight > node.clientHeight) ||
					(scrolls.test(style.overflowX) && node.scrollWidth > node.clientWidth)
				);
			})
			.map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
	);
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

async function failAndOpenRaw(page: Page): Promise<void> {
	await mockAnthropic(page, () => ({ status: 200, body: proseResponseBody() }));
	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const notice = page.locator('[data-outcome="not-json"]');
	await expect(notice).toBeVisible();
	// Task 6: a run that ends in a failure leaves focus on its notice.
	await expect(notice).toBeFocused();

	await notice.getByText('What Anthropic sent back').click();
	const raw = notice.locator('pre');
	await expect(raw).toBeVisible();
	// The response really is taller than the old box, so a pass here isn't a short fixture.
	expect(await raw.evaluate((node) => node.scrollHeight)).toBeGreaterThan(OLD_CAP_PX);
}

test.describe('at 390 × 844', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('a failed generate on the landing page leaves nothing in main scrolling on its own', async ({
		page,
	}) => {
		await serveFontTable(page);
		await saveOneRecord(page);
		await failAndOpenRaw(page);

		expect(await ownScrollers(page)).toEqual([]);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
	});

	test('a failed generate in the workspace Seed tab leaves nothing in main scrolling on its own', async ({
		page,
	}) => {
		await serveFontTable(page);
		const recordId = await saveOneRecord(page);
		await page.goto(`/workspace?record=${recordId}`);

		// #157 (#181): below md the generate panel lives in the Seed tab, after the seed rail
		// (Decision 1). This is the state Codex's deferred #181 finding names (Decision 18).
		const seedTab = page
			.getByRole('tablist', { name: 'Workspace' })
			.getByRole('tab', { name: 'Seed' });
		await seedTab.click();
		await expect(seedTab).toHaveAttribute('aria-selected', 'true');
		await expect.poll(() => visibleWorkspacePanels(page), { message: 'Seed' }).toEqual(['Seed']);
		await expect(
			page.getByRole('tabpanel', { name: 'Seed' }).getByRole('region', { name: 'First version' }),
		).toBeVisible();

		await failAndOpenRaw(page);

		expect(await ownScrollers(page)).toEqual([]);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
	});
});
