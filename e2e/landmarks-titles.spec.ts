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

type Landmark = { role: string; name: string; holdsSampleApp: boolean };

/**
 * Every landmark Chromium's accessibility tree exposes, read over Playwright's CDP session for the
 * reason `e2e/field-errors.spec.ts`'s `axField` gives: `getByRole` runs Playwright's own role and
 * name code, not the tree a screen reader's landmark list is built from. `holdsSampleApp` resolves
 * each landmark back to the DOM node Chromium built it from, so "the sample app sits inside the
 * region" is asked of that node rather than of a selector that could match a different one.
 */
async function chromiumLandmarks(page: Page): Promise<Landmark[]> {
	const cdp = await page.context().newCDPSession(page);
	try {
		const { nodes } = await cdp.send('Accessibility.getFullAXTree');
		const landmarks: Landmark[] = [];
		for (const node of nodes) {
			const role = String(node.role?.value ?? '');
			if (node.ignored || !(LANDMARK_ROLES as readonly string[]).includes(role)) continue;

			let holdsSampleApp = false;
			if (node.backendDOMNodeId !== undefined) {
				const { object } = await cdp.send('DOM.resolveNode', {
					backendNodeId: node.backendDOMNodeId,
				});
				const { result } = await cdp.send('Runtime.callFunctionOn', {
					objectId: object.objectId,
					functionDeclaration:
						'function () { return this.querySelector("[data-preview-app-screen]") !== null; }',
					returnByValue: true,
				});
				holdsSampleApp = result.value === true;
			}
			landmarks.push({ role, name: String(node.name?.value ?? ''), holdsSampleApp });
		}
		return landmarks;
	} finally {
		await cdp.detach();
	}
}

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

	const landmarks = await chromiumLandmarks(page);
	// A read that came back empty would pass every absence check below, so the tool's own `main`
	// has to be there first.
	expect(landmarks.map(({ role }) => role)).toContain('main');

	const sampleLandmarks = landmarks.filter(({ name }) =>
		['Sample app', 'Order views'].includes(name),
	);
	expect(sampleLandmarks).toEqual([]);

	const regions = landmarks.filter(
		({ role, name }) => role === 'region' && name === 'Preview: sample app',
	);
	expect(regions).toHaveLength(1);
	// The sample app is still inside it, parts and all.
	expect(regions[0]!.holdsSampleApp).toBe(true);
	await expect(page.locator('[data-preview-part="nav"]')).toBeVisible();
	await expect(page.locator('[data-preview-part="sidebar"]')).toBeVisible();
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

test("a workspace reached by the keyed flow's client-side push keeps a title naming its record", async ({
	page,
}) => {
	await serveFontTable(page);
	await page.goto('/');
	const landingTitle = await page.title();

	await page.getByLabel('Reference images').setInputFiles(pngFile('brand.png'));
	await expect(page.getByText('brand.png', { exact: true })).toBeVisible();
	await page.getByLabel(/^Brand site/).fill('ceramics.example');
	await page.getByRole('button', { name: 'Save these references' }).click();
	await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();

	await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));
	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);
	await expect(page).toHaveURL(/\/workspace\?record=/);
	await expect(page.locator('[data-preview] [data-preview-app-screen]')).toBeVisible();

	await expect(page).toHaveTitle(/ceramics\.example/);
	// Next applies the route's metadata title on a client-side navigation too, and on its own
	// schedule. A late write would replace the record's name with the static `Workspace · Cambium`,
	// so read again once that has had time to land.
	await page.waitForTimeout(1000);
	expect(await page.title()).toMatch(/ceramics\.example/);
	expect(await page.title()).not.toBe(landingTitle);
});

test('the missing-record page has exactly one h1', async ({ page }) => {
	await page.goto('/workspace?record=nothing-is-stored-under-this-id');
	await expect(page.locator('[data-outcome="missing"]')).toBeVisible();

	await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});
