import type { Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';

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

type Rgb = { r: number; g: number; b: number };

/** One sRGB byte, linearised per the WCAG relative-luminance formula (2.4.7 / SC 1.4.3). */
function linearised(byte: number): number {
	const c = byte / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (2.4.7 / SC 1.4.3), off the spec's own sRGB coefficients. */
function relativeLuminance({ r, g, b }: Rgb): number {
	return 0.2126 * linearised(r) + 0.7152 * linearised(g) + 0.0722 * linearised(b);
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

/** WCAG contrast ratio between two opaque colours. */
function contrastRatio(a: Rgb, b: Rgb): number {
	// The array literal is already a fresh array nothing else can see, so this sort mutates nothing
	// anyone else can see either. `toSorted` would satisfy the rule directly, but it is ES2023 and
	// tsconfig targets ES2022, the same trade `core/family-variants.ts` makes.
	// oxlint-disable-next-line unicorn/no-array-sort
	const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);

	return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * Every pixel inside `target`'s box, decoded from a real screenshot the way `e2e/token-list.spec.ts`'s
 * `paintedCentre` reads one — except the whole box here, not just its centre, because neither the
 * fill nor a glyph's ink sits at a fixed offset across a link's underline, a pill badge's rounded
 * ends, and a button's padding.
 */
async function paintedPixels(target: Locator): Promise<Rgb[]> {
	const png = PNG.sync.read(await target.screenshot({ animations: 'disabled' }));
	const pixels: Rgb[] = [];
	for (let offset = 0; offset < png.data.length; offset += 4) {
		pixels.push({ r: png.data[offset]!, g: png.data[offset + 1]!, b: png.data[offset + 2]! });
	}
	return pixels;
}

/**
 * The fill Chromium actually painted, taken as whichever exact byte triple covers the most pixels in
 * the box. A Tailwind fraction like `/5` names an intent, not a byte value; the majority colour is
 * what compositing that intent over whatever sits underneath produced, with the rounded corners' and
 * glyphs' anti-aliased edges outvoted by the flat fill between them.
 */
function paintedFill(pixels: Rgb[]): Rgb {
	const counts = new Map<string, { rgb: Rgb; count: number }>();
	for (const rgb of pixels) {
		const key = `${rgb.r},${rgb.g},${rgb.b}`;
		const entry = counts.get(key);
		if (entry) entry.count += 1;
		else counts.set(key, { rgb, count: 1 });
	}

	let winner: { rgb: Rgb; count: number } | undefined;
	for (const entry of counts.values()) {
		if (!winner || entry.count > winner.count) winner = entry;
	}
	if (!winner) throw new Error('screenshot decoded to zero pixels');
	return winner.rgb;
}

/**
 * The pixel likeliest to be a glyph's true ink rather than an anti-aliased blend toward the fill:
 * whichever pixel in the box contrasts hardest against `fill`. Every blended edge pixel sits between
 * the glyph colour and the fill by construction, so it can only read as less extreme than the glyph's
 * own ink, never more — the true text colour is always the contrast-maximising pixel, even at the
 * small sizes here (badge text at 12px, button text at 14px) where no run is wide enough to guarantee
 * a large flat interior.
 */
function paintedText(pixels: Rgb[], fill: Rgb): Rgb {
	let winner: Rgb | undefined;
	let winnerRatio = -Infinity;
	for (const pixel of pixels) {
		const ratio = contrastRatio(pixel, fill);
		if (ratio > winnerRatio) {
			winnerRatio = ratio;
			winner = pixel;
		}
	}
	if (!winner) throw new Error('screenshot decoded to zero pixels');
	return winner;
}

/**
 * The ratio between what Chromium painted for `target`'s fill and what it painted for its text —
 * the whole measurement this spec exists to make, now taken from one screenshot rather than from a
 * `getComputedStyle` value this file would otherwise have to composite itself.
 */
async function paintedContrast(target: Locator): Promise<number> {
	const pixels = await paintedPixels(target);
	const fill = paintedFill(pixels);
	return contrastRatio(paintedText(pixels, fill), fill);
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
