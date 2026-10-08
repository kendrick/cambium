import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
	generateWithFreshKey,
	imageIdFromRequest,
	mockAnthropic,
	pngFile,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

/** ARIA landmark roles. A landmark named after the sample app under any of them is the defect. */
const LANDMARK_ROLES = [
	'banner',
	'complementary',
	'contentinfo',
	'form',
	'main',
	'navigation',
	'region',
	'search',
] as const;

async function openGeneratedWorkspace(page: Page): Promise<void> {
	await serveFontTable(page);
	await saveOneRecord(page);
	await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));
	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);
	await expect(page).toHaveURL(/\/workspace\?record=/);
	await expect(page.locator('[data-preview] [data-preview-app-screen]')).toBeVisible();
}

test('at 1280 × 720 the sample app adds no landmark of its own, and the preview is one region', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await openGeneratedWorkspace(page);

	const sampleLandmarks = LANDMARK_ROLES.flatMap((role) =>
		['Sample app', 'Order views'].map((name) => ({ role, name })),
	);
	await Promise.all(
		sampleLandmarks.map(({ role, name }) =>
			expect(page.getByRole(role, { name, exact: true }), `${role} "${name}"`).toHaveCount(0),
		),
	);

	const region = page.getByRole('region', { name: 'Preview: sample app', exact: true });
	await expect(region).toHaveCount(1);
	expect(
		await region.evaluate(
			(node) => node.matches('[data-preview]') || node.querySelector('[data-preview]') !== null,
		),
	).toBe(true);
	// The sample app is still inside it, parts and all.
	await expect(region.locator('[data-preview-part="nav"]')).toBeVisible();
	await expect(region.locator('[data-preview-part="sidebar"]')).toBeVisible();
});

test('the landing page and the workspace carry different titles, and the workspace names its record', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.getByLabel('Reference images')).toBeVisible();
	const landingTitle = await page.title();

	await page.getByLabel('Reference images').setInputFiles(pngFile('brand.png'));
	await expect(page.getByText('brand.png', { exact: true })).toBeVisible();
	await page.getByLabel(/^Brand site/).fill('ceramics.example');
	await page.getByRole('button', { name: 'Save these references' }).click();
	await expect(page).toHaveURL(/[?&]record=/);
	const recordId = new URL(page.url()).searchParams.get('record');

	await page.goto(`/workspace?record=${recordId}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	await expect(page).toHaveTitle(/ceramics\.example/);
	expect(await page.title()).not.toBe(landingTitle);
});

test('the missing-record page has exactly one h1', async ({ page }) => {
	await page.goto('/workspace?record=nothing-is-stored-under-this-id');
	await expect(page.locator('[data-outcome="missing"]')).toBeVisible();

	await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});
