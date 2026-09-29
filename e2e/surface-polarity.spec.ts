import type { Page } from '@playwright/test';

import { type DecodedPixels, deriveSurfacePolarity } from '../core/surface-polarity';
import {
	type Band,
	DARK_DOMINANT,
	DARK_KEY_RED,
	FIXTURE_WIDTH,
	LIGHT_DOMINANT,
	LIGHT_KEY_OCHRE,
	withBand,
} from '../core/surface-polarity.fixture';
import { ACCEPTED_IMAGE_TYPES, WEBP_QUALITY } from '../lib/image-intake';

import { expect, test } from './fixtures';

/**
 * `images[].downscaled` is a base64 data URL: PNG or JPEG when intake passed the file through, WebP
 * when it re-encoded. Node ships no image decoder, and a Node-side one wouldn't match a browser's,
 * so the pixels `deriveSurfacePolarity` sees for a stored image only exist here. Each fixture is
 * painted, encoded as a stored type at intake's own quality, turned into a data URL, and decoded
 * the way `decodeInBrowser` in `app/readers/local-reader.ts` does. Chromium's pixels then go to the
 * core in Node. The assertions read those pixels, never the painted bands, so codec noise is part
 * of what's measured.
 *
 * No route uses the module yet, so this runs on a `setContent` page, as `stylesheet-dark.spec.ts`
 * does. Like every spec here it needs `pnpm build` first.
 */
async function storedPixels(
	page: Page,
	bands: readonly Band[],
	type: string,
): Promise<{ mediaType: string; pixels: DecodedPixels }> {
	const decoded = await page.evaluate(
		async ({ painting, width, mimeType, quality }) => {
			const height = painting.reduce((total, band) => total + band.rows, 0);
			const painted = new OffscreenCanvas(width, height);
			const paint = painted.getContext('2d');

			if (!paint) throw new Error('no 2d context to paint the fixture');

			let y = 0;

			for (const band of painting) {
				paint.fillStyle = `rgb(${band.rgb.join(' ')})`;
				paint.fillRect(0, y, width, band.rows);
				y += band.rows;
			}

			const blob = await painted.convertToBlob({ type: mimeType, quality });
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.addEventListener('load', () => resolve(reader.result as string));
				reader.addEventListener('error', () => reject(reader.error));
				reader.readAsDataURL(blob);
			});
			const comma = dataUrl.indexOf(',');
			const mediaType = dataUrl.slice('data:'.length, comma).split(';')[0];
			const binary = atob(dataUrl.slice(comma + 1));
			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
			const bitmap = await createImageBitmap(new Blob([bytes], { type: mediaType }));

			try {
				const readback = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');

				if (!readback) throw new Error('no 2d context to read the decoded image');

				readback.drawImage(bitmap, 0, 0);

				const image = readback.getImageData(0, 0, bitmap.width, bitmap.height);

				return {
					mediaType,
					width: image.width,
					height: image.height,
					data: Array.from(image.data),
				};
			} finally {
				bitmap.close();
			}
		},
		{ painting: bands, width: FIXTURE_WIDTH, mimeType: type, quality: WEBP_QUALITY },
	);

	return {
		mediaType: decoded.mediaType,
		pixels: {
			data: new Uint8ClampedArray(decoded.data),
			width: decoded.width,
			height: decoded.height,
		},
	};
}

const CASES = [
	{ name: 'the light-dominant fixture', bands: LIGHT_DOMINANT, polarity: 'light' },
	{ name: 'the dark-dominant fixture', bands: DARK_DOMINANT, polarity: 'dark' },
	{
		name: 'the light fixture with only its background darkened',
		bands: withBand(LIGHT_DOMINANT, 0, [0, 0, 0]),
		polarity: 'dark',
	},
	{
		name: 'the light fixture with only its key colour hue-rotated',
		bands: withBand(LIGHT_DOMINANT, 4, DARK_KEY_RED),
		polarity: 'light',
	},
	{
		name: 'the dark fixture with only its key colour hue-rotated',
		bands: withBand(DARK_DOMINANT, 4, LIGHT_KEY_OCHRE),
		polarity: 'dark',
	},
] as const;

test.beforeEach(async ({ page }) => {
	await page.setContent('<!doctype html><title>surface polarity</title>');
});

for (const type of ACCEPTED_IMAGE_TYPES) {
	for (const { name, bands, polarity } of CASES) {
		test(`${name}, stored as ${type}, reads ${polarity}`, async ({ page }) => {
			const stored = await storedPixels(page, bands, type);

			// `convertToBlob` falls back to PNG for a type it can't encode, which would quietly turn the
			// JPEG and WebP rows into PNG ones.
			expect(stored.mediaType).toBe(type);
			expect(deriveSurfacePolarity([{ id: 'stored', pixels: stored.pixels }]).polarity).toBe(
				polarity,
			);
		});
	}
}
