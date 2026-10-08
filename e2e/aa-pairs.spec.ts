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
import { paintedContrast, settle } from './painted-contrast';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

/** WCAG 2.2 SC 1.4.3. Neither element is large text. */
const TEXT_TARGET = 4.5;

/** #154's control, by the names its own tests use. */
const SCHEMES = [
	{ scheme: 'light', button: 'Light' },
	{ scheme: 'dark', button: 'Dark' },
] as const;

/**
 * The recorded success fixture through the real keyed path, so the preview paints a token set the
 * app generated and repaired, not one this spec assembled.
 */
async function openGeneratedPreview(page: Page): Promise<Locator> {
	await serveFontTable(page);
	await saveOneRecord(page);
	await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));
	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);
	await expect(page).toHaveURL(/\/workspace\?record=/);

	const preview = page.locator('[data-preview]');
	await expect(preview.locator('[data-preview-gallery]')).toBeVisible();
	return preview;
}

test('the destructive alert description and the active sidebar count clear 4.5:1 as painted, light and dark', async ({
	page,
}) => {
	const preview = await openGeneratedPreview(page);

	const alertDescription = preview
		.locator('[data-preview-gallery] [data-slot="alert-description"]')
		.filter({ hasText: 'Update the card on file' });
	// The first view row sits on `sidebar-accent`: the pair #68 measured at 4.34:1.
	const activeCount = preview
		.locator('[data-preview-part="sidebar"] > div')
		.first()
		.locator('span')
		.nth(1);
	await expect(activeCount).toHaveText('128');

	for (const { scheme, button } of SCHEMES) {
		await page
			.getByRole('group', { name: 'Colour scheme' })
			.getByRole('button', { name: button, exact: true })
			.click();
		await expect(preview).toHaveAttribute('data-preview-scheme', scheme);
		await settle(page);

		expect(
			await paintedContrast(alertDescription),
			`alert description, ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);
		expect(
			await paintedContrast(activeCount),
			`active sidebar count, ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);
	}
});
