import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

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

const TEST_KEY = 'sk-ant-test-not-a-real-key';

/** Named, not left to axe's defaults: `target-size` is off in a default run (Decision 16). */
const RULES = ['target-size', 'landmark-unique', 'page-has-heading-one', 'color-contrast'];

/** #157's phone tab set, in order (`shell.tsx`'s `TabsList aria-label="Workspace"`). */
const PHONE_TABS = ['Seed', 'Tokens', 'Preview', 'Accessibility', 'Export'] as const;

/** The desktop Output tabs. base-ui unmounts an inactive Output panel, so each is scanned selected. */
const OUTPUT_TABS = ['Preview', 'Accessibility', 'Export'] as const;

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

async function violations(page: Page): Promise<string[]> {
	const { violations: found } = await new AxeBuilder({ page }).withRules(RULES).analyze();
	return found.flatMap((violation) =>
		violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}`),
	);
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
	await expect(page.locator('[data-seed-field]').first()).toBeVisible();
}

async function expectLandingClean(page: Page): Promise<void> {
	await page.goto('/');
	await expect(page.getByLabel('Reference images')).toBeVisible();
	// #39's library and #40's picker are both lazy. Scanning before they land would miss the
	// first-run state and the demo buttons.
	await expect(page.locator('[data-library="listed"] [data-library-first-run]')).toBeVisible();
	await expect(page.locator('[data-demo-picker]')).toBeVisible();
	expect(await violations(page), 'landing').toEqual([]);

	await serveFontTable(page);
	await saveOneRecord(page);
	await waitForGenerateReady(page);
	// Button's `transition-all` fades `disabled:opacity-50` out over 150ms after the attribute flips.
	// axe blends whatever it catches mid-fade (4.36:1 at #777), so wait for the settled paint.
	await expect(generateButton(page)).toHaveCSS('opacity', '1');
	expect(await violations(page), 'saved outcome').toEqual([]);
}

async function expectMissingClean(page: Page): Promise<void> {
	await page.goto('/workspace?record=nothing-is-stored-under-this-id');
	await expect(page.locator('[data-outcome="missing"]')).toBeVisible();
	expect(await violations(page), 'missing record').toEqual([]);
}

test('axe finds none of the four rules on the landing page, the workspace or the missing-record page at 1280', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await expectLandingClean(page);
	await expectMissingClean(page);

	await openGeneratedWorkspace(page);
	const output = page.getByRole('tablist', { name: 'Output' });
	for (const name of OUTPUT_TABS) {
		await output.getByRole('tab', { name }).click();
		await expect(output.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
		if (name === 'Preview') await expect(page.locator('[data-preview]')).toBeVisible();
		// #40's pane: the archive button renders once the deferred listing lands.
		if (name === 'Export') {
			await expect(page.getByRole('button', { name: /^Download .*export\.zip$/ })).toBeVisible();
		}
		expect(await violations(page), `workspace, ${name} tab`).toEqual([]);
	}
});

test.describe('at 390 × 844', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('axe finds none of the four rules on any page, on every phone tab', async ({ page }) => {
		await expectLandingClean(page);
		await expectMissingClean(page);

		await openGeneratedWorkspace(page);
		const bar = page.getByRole('tablist', { name: 'Workspace' });
		for (const name of PHONE_TABS) {
			await bar.getByRole('tab', { name }).click();
			await expect(bar.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
			// Only this panel, so axe doesn't scan the outgoing one mid-transition (Decision 1).
			await expect.poll(() => visibleWorkspacePanels(page), { message: name }).toEqual([name]);
			if (name === 'Preview') await expect(page.locator('[data-preview]')).toBeVisible();
			if (name === 'Export') {
				await expect(page.getByRole('button', { name: /^Download .*export\.zip$/ })).toBeVisible();
			}
			expect(await violations(page), `workspace, ${name} tab`).toEqual([]);
		}
	});
});
