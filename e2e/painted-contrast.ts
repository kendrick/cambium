import type { Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';

import { expect } from './fixtures';

/**
 * Contrast as Chromium composited it, read off a `locator.screenshot()`. Shared by every spec that
 * gates a text pair in the consumer's units (`docs/agents/testing.md`, "Where the seam actually
 * is"). `e2e/button-contrast.spec.ts`'s docblock explains why a screenshot rather than computed
 * style: the compositor quantizes once, after blending, and a re-implementation that quantizes
 * before blending drifts near 4.5:1.
 */

/**
 * The same wait as `e2e/preview.spec.ts`'s `settle`, which still keeps its own copy: every button
 * and badge variant carries `transition-all`, so a scheme switch or a `:hover` both start a CSS
 * transition on `color`/`background-color` rather than snapping to the new value. Reading the paint
 * right after either one, without waiting here, catches it mid-interpolation—a real state a person
 * can see for ~150ms, but not the settled one a caller means to gate, and it matches neither
 * endpoint (caught while writing `e2e/button-contrast.spec.ts`: the link button read back an
 * `oklab(...)` blend nowhere near either scheme's foreground). Polling `document.getAnimations()`
 * down to zero is what actually proves the transition finished, where a fixed `waitForTimeout`
 * would only ever be a guess at its duration.
 */
export async function settle(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.getAnimations().filter((animation) => animation.playState === 'running').length,
			),
		)
		.toBe(0);
}

export type Rgb = { r: number; g: number; b: number };

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
export function contrastRatio(a: Rgb, b: Rgb): number {
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
 * the one measurement every caller imports this module for, taken from one screenshot rather than
 * from a `getComputedStyle` value the caller would otherwise have to composite itself.
 */
export async function paintedContrast(target: Locator): Promise<number> {
	const pixels = await paintedPixels(target);
	const fill = paintedFill(pixels);
	return contrastRatio(paintedText(pixels, fill), fill);
}
