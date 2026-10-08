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
	await expect(page.locator('[data-seed-field]').first()).toBeAttached();
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

function workspaceTab(page: Page, name: 'Seed' | 'Tokens'): Locator {
	return page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name });
}

/** A seed-rail control: the key colour swatch in `[data-seed-field="keyColors.0"]`. */
const keyColour = (page: Page) => page.getByRole('button', { name: 'Edit brand key colour' });

/** A token-row control: the Edit trigger in `[data-token="semantic.primary"]`. */
const primaryRow = (page: Page) =>
	page.getByRole('button', { name: 'Edit semantic.primary', exact: true });

/** Resizes across md, waits two frames, then for the tab list that width's layout shows. */
async function crossTo(page: Page, width: 390 | 1024): Promise<void> {
	await page.setViewportSize({ width, height: 844 });
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}),
	);
	await expect(
		page.getByRole('tablist', { name: width === 390 ? 'Workspace' : 'Output' }),
	).toBeVisible();
}

/** Focus is on `control`, inside `tab`'s panel, which is selected and the only one showing. */
async function expectFocusedInTab(page: Page, control: Locator, tab: 'Seed' | 'Tokens') {
	await expect(workspaceTab(page, tab)).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => visibleWorkspacePanels(page), { message: tab }).toEqual([tab]);
	await expect(control).toBeFocused();
	expect(
		await page
			.getByRole('tabpanel', { name: tab })
			.evaluate((panel) => panel.contains(document.activeElement)),
		`focus inside the ${tab} panel`,
	).toBe(true);
}

test('focus on a seed field and on a token row follows its control from 1024 to 390', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1024, height: 844 });
	await openGeneratedWorkspace(page);
	await expect(page.getByRole('tablist', { name: 'Output' })).toBeVisible();

	// Desktop opens Output on Preview, so the phone layout would too, with the rail hidden.
	await keyColour(page).focus();
	await crossTo(page, 390);
	await expectFocusedInTab(page, keyColour(page), 'Seed');

	await crossTo(page, 1024);
	await primaryRow(page).focus();
	await crossTo(page, 390);
	await expectFocusedInTab(page, primaryRow(page), 'Tokens');
});

test('focus on a seed field and on a token row follows its control from 390 to 1024', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openGeneratedWorkspace(page);

	await workspaceTab(page, 'Tokens').click();
	await expect.poll(() => visibleWorkspacePanels(page)).toEqual(['Tokens']);
	await primaryRow(page).focus();
	await crossTo(page, 1024);
	await expect(primaryRow(page)).toBeFocused();

	await crossTo(page, 390);
	await workspaceTab(page, 'Seed').click();
	await expect.poll(() => visibleWorkspacePanels(page)).toEqual(['Seed']);
	await keyColour(page).focus();
	await crossTo(page, 1024);
	await expect(keyColour(page)).toBeFocused();
});

test('a control with no twin in the other layout hands focus to its column heading, not the page', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openGeneratedWorkspace(page);

	// The phone bar's Tokens tab has no counterpart at 1024.
	await workspaceTab(page, 'Tokens').click();
	await expect(workspaceTab(page, 'Tokens')).toBeFocused();
	await crossTo(page, 1024);
	await expect(page.getByRole('heading', { level: 2, name: 'Tokens', exact: true })).toBeFocused();
});
