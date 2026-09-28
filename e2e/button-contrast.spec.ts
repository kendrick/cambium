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

/**
 * `components/ui/button-contrast.test.ts` gates the same defect (#68) at the seam
 * `docs/agents/testing.md` calls the pure core: compiled CSS, resolved tokens, the repo's own
 * compositing math. This is the consumer that math is a claim about — the browser rendering the
 * preview gallery for real — so it reads `getComputedStyle` on the actual `Button` and `Badge`
 * markup and does its own alpha-blend and WCAG contrast arithmetic, independent of
 * `core/oklch.ts`'s, rather than re-deriving the Vitest suite's answer and checking that against
 * itself.
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

/** `e2e/preview.spec.ts`'s own `switchScheme`, reused in shape: click only if the scheme differs. */
async function switchScheme(page: Page, preview: Locator, scheme: (typeof SCHEMES)[number]) {
	const toggle = page.getByRole('button', { name: 'Dark scheme' });
	if ((await preview.getAttribute('data-preview-scheme')) !== scheme) await toggle.click();

	await expect(preview).toHaveAttribute('data-preview-scheme', scheme);
}

/**
 * `e2e/preview.spec.ts`'s own `settle`: every button and badge variant carries `transition-all`, so
 * a scheme switch or a `:hover` both start a CSS transition on `color`/`background-color` rather
 * than snapping to the new value. Reading `getComputedStyle` right after either one, without
 * waiting here, catches the paint mid-interpolation — a real state a person can see for ~150ms, but
 * not the one this spec is gating, and it serializes as a colour that matches neither endpoint
 * (caught while writing this spec: the link button read back an `oklab(...)` blend nowhere near
 * either scheme's foreground). Polling `document.getAnimations()` down to zero is what actually
 * proves the transition finished, where a fixed `waitForTimeout` would only ever be a guess at its
 * duration.
 */
async function settle(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.getAnimations().filter((animation) => animation.playState === 'running').length,
			),
		)
		.toBe(0);
}

type Rgb = { r: number; g: number; b: number; a: number };

/**
 * Resolves any CSS colour string `getComputedStyle` hands back — `rgb()`/`rgba()` on most engines,
 * `oklch()` on one new enough to keep a computed colour in its origin space, since this repo's
 * tokens are `oklch(...)` literals — to the sRGB bytes a canvas actually paints. A canvas 2D context
 * rasterizes to sRGB on `getImageData` regardless of what colour space `fillStyle` was set in, so
 * this asks the browser to do the conversion rather than reimplementing it, the same reason this
 * file writes its own alpha blend and contrast maths below instead of importing `core/oklch.ts`'s.
 */
async function resolveToRgb(page: Page, css: string): Promise<Rgb> {
	return page.evaluate((value) => {
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new Error('2d canvas context unavailable');

		ctx.fillStyle = value;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;

		return { r: r!, g: g!, b: b!, a: a! / 255 };
	}, css);
}

/** `getComputedStyle(element)[property]`, resolved to sRGB bytes via `resolveToRgb`. */
async function computedRgb(
	page: Page,
	locator: Locator,
	property: 'color' | 'backgroundColor',
): Promise<Rgb> {
	const css = await locator.evaluate((node, prop) => getComputedStyle(node)[prop], property);

	return resolveToRgb(page, css);
}

/**
 * What lands on screen when a translucent `source` paints over an opaque `backdrop`: a per-channel
 * sRGB blend on the 8-bit values the browser already reports, rounded the way a pixel is. Written
 * from the WCAG/CSS compositing model directly rather than imported from `core/oklch.ts`'s
 * `compositeOver` — the point of this spec is to check that function's answer against the browser's,
 * not to ask it to check itself.
 */
function alphaComposite(backdrop: Rgb, source: Rgb): Rgb {
	const mix = (under: number, over: number) => Math.round(under * (1 - source.a) + over * source.a);

	return {
		r: mix(backdrop.r, source.r),
		g: mix(backdrop.g, source.g),
		b: mix(backdrop.b, source.b),
		a: 1,
	};
}

/** One sRGB byte, linearised per the WCAG relative-luminance formula (2.4.7 / SC 1.4.3). */
function linearised(byte: number): number {
	const c = byte / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (2.4.7 / SC 1.4.3), off the spec's own sRGB coefficients. */
function relativeLuminance({ r, g, b }: Rgb): number {
	return 0.2126 * linearised(r) + 0.7152 * linearised(g) + 0.0722 * linearised(b);
}

/** WCAG contrast ratio between two opaque colours. */
function contrastRatio(a: Rgb, b: Rgb): number {
	// The array literal is already a fresh array nothing else can see, so this sort mutates nothing
	// anyone else can see either. `toSorted` would satisfy the rule directly, but it is ES2023 and
	// tsconfig targets ES2022, the same trade `core/family-variants.ts` makes.
	// oxlint-disable-next-line unicorn/no-array-sort
	const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);

	return (lighter! + 0.05) / (darker! + 0.05);
}

test('the link Button, the destructive Button (rest and hover), and the destructive Badge clear 4.5:1 as the browser actually paints them, light and dark', async ({
	page,
}) => {
	const preview = await openPopulatedGallery(page);
	const gallery = preview.locator('[data-preview-gallery]');

	const linkButton = gallery.getByRole('button', { name: 'View receipt' });
	const destructiveButton = gallery.getByRole('button', { name: 'Delete order' });
	const destructiveBadge = gallery.getByText('Overdue', { exact: true });

	for (const scheme of SCHEMES) {
		await switchScheme(page, preview, scheme);
		await settle(page);

		// The page surface every specimen below sits on: neither the `Specimen` wrapper nor the
		// gallery section declares a background of its own (`gallery.tsx`), so this is the real
		// backdrop a translucent fill composites against, not an assumption borrowed from
		// `core/semantic-map.ts`.
		const backdrop = await computedRgb(page, preview, 'backgroundColor');

		const linkColor = await computedRgb(page, linkButton, 'color');
		expect(contrastRatio(linkColor, backdrop), `link ${scheme}`).toBeGreaterThanOrEqual(
			TEXT_TARGET,
		);

		const destructiveColor = await computedRgb(page, destructiveButton, 'color');

		const restFill = await computedRgb(page, destructiveButton, 'backgroundColor');
		expect(
			contrastRatio(destructiveColor, alphaComposite(backdrop, restFill)),
			`destructive button rest ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);

		await destructiveButton.hover();
		await settle(page);
		const hoverFill = await computedRgb(page, destructiveButton, 'backgroundColor');
		expect(
			contrastRatio(destructiveColor, alphaComposite(backdrop, hoverFill)),
			`destructive button hover ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);
		// Off the button before the next scheme (or the badge below) reads a style that is still
		// carrying a stale :hover from this one.
		await page.mouse.move(0, 0);
		await settle(page);

		const badgeColor = await computedRgb(page, destructiveBadge, 'color');
		const badgeFill = await computedRgb(page, destructiveBadge, 'backgroundColor');
		expect(
			contrastRatio(badgeColor, alphaComposite(backdrop, badgeFill)),
			`destructive badge ${scheme}`,
		).toBeGreaterThanOrEqual(TEXT_TARGET);
	}
});
