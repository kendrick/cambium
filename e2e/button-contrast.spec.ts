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

/**
 * `components/ui/button-contrast.test.ts` gates the same defect (#68) at the seam
 * `docs/agents/testing.md` calls the pure core: compiled CSS, resolved tokens, the repo's own
 * compositing math. This is the consumer that math is a claim about — the browser rendering the
 * preview gallery for real — so it reads a `locator.screenshot()` of the actual `Button` and `Badge`
 * markup and does its own WCAG contrast arithmetic over the pixels Chromium already composited,
 * independent of `core/oklch.ts`'s, rather than re-deriving the Vitest suite's answer and checking
 * that against itself.
 *
 * An earlier version of this file read `getComputedStyle`, resolved each declared colour to sRGB
 * through a throwaway canvas, and blended fill over backdrop itself (PR #166 review). That path
 * quantizes the backdrop and the translucent fill to 8-bit bytes independently before blending them,
 * where Chromium composites the underlying colour values first and quantizes the result once — close
 * enough to agree most of the time, but the gap widens exactly at the low alpha fractions
 * (`/5`, `/8`) this spec exists to check, near the 4.5:1 boundary where a rounding difference can flip
 * the verdict. A screenshot has no such gap: it's the pixel the compositor actually painted, so
 * reading it is the consumer's unit rather than a re-implementation of the consumer.
 *
 * Distinct from `e2e/stylesheet-dark.spec.ts`, which compiles a hand-assembled stylesheet through
 * `page.setContent()` for a cascade question no route yet renders. The preview gallery already
 * renders `buttonVariants`/`badgeVariants` output for real, so this reaches it the way
 * `e2e/keyed-path.spec.ts` does: upload, save, and generate against the mocked fixture
 * (`e2e/keyed-flow.ts`), which lands on `/workspace?record=<id>` with a real generated token set.
 */

const TEST_KEY = 'sk-ant-test-not-a-real-key';
const SCHEMES = ['light', 'dark'] as const;
const TEXT_TARGET = 4.5;

/**
 * Uploads, saves, and generates against the mocked Anthropic fixture, the same steps
 * `e2e/keyed-path.spec.ts`'s first step drives, then waits for the preview gallery — where the
 * `link`, `destructive` Button and destructive Badge specimens live (`components/workspace/preview/
 * gallery.tsx`) — to mount.
 */
async function openPopulatedGallery(page: Page): Promise<Locator> {
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
	await expect(preview).toBeVisible();
	await expect(preview.locator('[data-preview-gallery]')).toBeVisible();

	return preview;
}

/** The control's visible names, spelled out as `e2e/preview.spec.ts` spells them. */
const SCHEME_LABELS = { light: 'Light', dark: 'Dark' } as const satisfies Record<
	(typeof SCHEMES)[number],
	string
>;

/** `e2e/preview.spec.ts`'s own `switchScheme`, copied: the workspace's one scheme control (#154). */
async function switchScheme(page: Page, preview: Locator, scheme: (typeof SCHEMES)[number]) {
	const button = page
		.getByRole('group', { name: 'Colour scheme' })
		.getByRole('button', { name: SCHEME_LABELS[scheme], exact: true });
	await button.click();

	await expect(preview).toHaveAttribute('data-preview-scheme', scheme);
	await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Whether the nearest ancestor that paints a background is the app screen's orders table, walked in
 * the browser rather than assumed. `paintedContrast` below reads the composited pixel regardless of
 * what that ancestor is, so this exists only to confirm the specimen under test is the badge actually
 * sitting on `card` — the one class-resolution fact a pixel read can't tell you on its own.
 */
async function sitsOnTable(locator: Locator): Promise<boolean> {
	return locator.evaluate((node) => {
		for (let current = node.parentElement; current; current = current.parentElement) {
			const css = getComputedStyle(current).backgroundColor;
			if (css !== 'rgba(0, 0, 0, 0)' && css !== 'transparent') {
				return current.matches('[data-preview-part="table"]');
			}
		}
		throw new Error('no ancestor paints a background');
	});
}

test('the link Button, the destructive Button (rest and hover), and the destructive Badge on the page and on card clear 4.5:1 as the browser actually paints them, light and dark', async ({
	page,
}) => {
	const preview = await openPopulatedGallery(page);
	const gallery = preview.locator('[data-preview-gallery]');

	const linkButton = gallery.getByRole('button', { name: 'View receipt' });
	const destructiveButton = gallery.getByRole('button', { name: 'Delete order' });
	const destructiveBadge = gallery.getByText('Overdue', { exact: true });
	// The one destructive badge the app itself renders, inside the orders table's `bg-card`. Rest
	// only: Badge renders a `<span>`, so its `[a]:hover` fill never paints here.
	const refundedBadge = preview
		.locator('[data-preview-app-screen]')
		.getByText('Refunded', { exact: true });

	for (const scheme of SCHEMES) {
		await switchScheme(page, preview, scheme);
		await settle(page);

		expect(await paintedContrast(linkButton), `link ${scheme}`).toBeGreaterThanOrEqual(TEXT_TARGET);

		expect(
			await paintedContrast(destructiveButton),
			`destructive button rest ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);

		await destructiveButton.hover();
		await settle(page);
		expect(
			await paintedContrast(destructiveButton),
			`destructive button hover ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);
		// Off the button before the next scheme (or the badge below) reads a style that is still
		// carrying a stale :hover from this one.
		await page.mouse.move(0, 0);
		await settle(page);

		expect(
			await paintedContrast(destructiveBadge),
			`destructive badge ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);

		expect(
			await sitsOnTable(refundedBadge),
			`refunded badge ${scheme} sits on the orders table`,
		).toBe(true);
		expect(
			await paintedContrast(refundedBadge),
			`refunded badge on card ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);
	}
});
