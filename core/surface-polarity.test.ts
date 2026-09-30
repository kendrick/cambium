import { describe, expect, it } from 'vitest';

import { deriveSurfacePolarity, dominantBackground } from './surface-polarity';
import {
	DARK_DOMINANT,
	DARK_KEY_RED,
	LIGHT_DOMINANT,
	LIGHT_KEY_OCHRE,
	paintBands,
	withBand,
} from './surface-polarity.fixture';

describe('dominantBackground', () => {
	it('reads the light-dominant fixture as a white page, though most of its pixels are dark', () => {
		expect(dominantBackground(paintBands(LIGHT_DOMINANT))).toMatchObject({
			rgb: [255, 255, 255],
			share: 0.4,
			polarity: 'light',
		});
	});

	it('reads the dark-dominant fixture as a #111111 page, though its mean lightness is high', () => {
		expect(dominantBackground(paintBands(DARK_DOMINANT))).toMatchObject({
			rgb: [17, 17, 17],
			share: 0.45,
			polarity: 'dark',
		});
	});

	it('flips when only the dominant background darkens', () => {
		const darkened = withBand(LIGHT_DOMINANT, 0, [0, 0, 0]);

		expect(dominantBackground(paintBands(darkened))?.polarity).toBe('dark');
	});

	it.each([
		['light', LIGHT_DOMINANT, 4, DARK_KEY_RED],
		['dark', DARK_DOMINANT, 4, LIGHT_KEY_OCHRE],
	] as const)(
		'keeps the %s fixture when only its key colour changes hue',
		(polarity, bands, index, rotated) => {
			expect(dominantBackground(paintBands(withBand(bands, index, rotated)))?.polarity).toBe(
				polarity,
			);
		},
	);

	// The WCAG crossover, settled with culori's `wcagContrast` rather than this module: white on
	// #757575 is 4.6075 and black 4.5578, while on #767676 white is 4.5422 and black 4.6233.
	it.each([
		[117, 'dark'],
		[118, 'light'],
	] as const)('classifies a flat grey %i as %s', (grey, polarity) => {
		expect(dominantBackground(paintBands([{ rgb: [grey, grey, grey], rows: 10 }]))?.polarity).toBe(
			polarity,
		);
	});

	// 15 and 16 sit either side of a 16-wide bucket edge. On one grid the page splits 20/20 and the
	// 30% #f0f0f0 stripe wins, reading light. The half-offset grid holds both halves in one bucket.
	it('keeps a page whose noise straddles a bucket edge in one piece', () => {
		const straddling = paintBands([
			{ rgb: [15, 15, 15], rows: 20 },
			{ rgb: [16, 16, 16], rows: 20 },
			{ rgb: [0xf0, 0xf0, 0xf0], rows: 30 },
			{ rgb: [0xa0, 0xa0, 0xa0], rows: 15 },
			{ rgb: [0xd0, 0xd0, 0xd0], rows: 15 },
		]);

		expect(dominantBackground(straddling)).toMatchObject({
			rgb: [15.5, 15.5, 15.5],
			share: 0.4,
			polarity: 'dark',
		});
	});

	// Transparent white outnumbers the dark page 60 rows to 45. Counting it reads light.
	it('ignores transparent pixels', () => {
		const onTransparency = paintBands([
			{ rgb: [255, 255, 255], rows: 60, alpha: 0 },
			...DARK_DOMINANT,
		]);

		expect(dominantBackground(onTransparency)).toMatchObject({ share: 0.45, polarity: 'dark' });
	});

	// The same 60-row white band on either side of MIN_OPAQUE_ALPHA. Only a cutoff of exactly 128
	// ignores it at 127 and counts it at 128, where it joins the page's own white rows and wins.
	it.each([
		[127, 'dark'],
		[128, 'light'],
	] as const)('reads a white band at alpha %i over the dark page as %s', (alpha, polarity) => {
		const band = paintBands([{ rgb: [255, 255, 255], rows: 60, alpha }, ...DARK_DOMINANT]);

		expect(dominantBackground(band)?.polarity).toBe(polarity);
	});

	it('abstains on an image with no opaque pixel', () => {
		expect(dominantBackground(paintBands([{ rgb: [0, 0, 0], rows: 10, alpha: 0 }]))).toBeNull();
	});

	it('refuses a buffer whose length disagrees with its dimensions', () => {
		expect(() =>
			dominantBackground({ data: new Uint8ClampedArray(12), width: 2, height: 2 }),
		).toThrow(/16 bytes/);
	});
});

describe('deriveSurfacePolarity', () => {
	const dark = paintBands(DARK_DOMINANT);
	const light = paintBands(LIGHT_DOMINANT);
	const transparent = paintBands([{ rgb: [255, 255, 255], rows: 10, alpha: 0 }]);
	// A 10-pixel-wide copy of the dark fixture: a tenth the pixels of `light`.
	const smallDark = paintBands(DARK_DOMINANT, 10);

	it('pins one dark-dominant and one light-dominant image', () => {
		expect(deriveSurfacePolarity([{ id: 'a', pixels: dark }]).polarity).toBe('dark');
		expect(deriveSurfacePolarity([{ id: 'a', pixels: light }]).polarity).toBe('light');
	});

	it('takes the majority of images', () => {
		expect(
			deriveSurfacePolarity([
				{ id: 'a', pixels: dark },
				{ id: 'b', pixels: dark },
				{ id: 'c', pixels: light },
			]).polarity,
		).toBe('dark');
	});

	it('reads a tie as light', () => {
		expect(
			deriveSurfacePolarity([
				{ id: 'a', pixels: dark },
				{ id: 'b', pixels: light },
			]).polarity,
		).toBe('light');
	});

	// Pooled, `light`'s 10,000 pixels outweigh two 1,000-pixel dark images and the answer is light.
	it('gives each image one vote whatever its size', () => {
		expect(
			deriveSurfacePolarity([
				{ id: 'a', pixels: smallDark },
				{ id: 'b', pixels: smallDark },
				{ id: 'c', pixels: light },
			]).polarity,
		).toBe('dark');
	});

	// Counted as a light vote, the transparent image would tie this and read light.
	it('lets an image with no opaque pixel abstain', () => {
		const derived = deriveSurfacePolarity([
			{ id: 'a', pixels: transparent },
			{ id: 'b', pixels: dark },
		]);

		expect(derived.polarity).toBe('dark');
		expect(derived.images).toEqual([
			{ imageId: 'a', background: null },
			{ imageId: 'b', background: expect.objectContaining({ polarity: 'dark' }) },
		]);
	});

	it('has no polarity without an image that votes', () => {
		expect(deriveSurfacePolarity([]).polarity).toBeNull();
		expect(deriveSurfacePolarity([{ id: 'a', pixels: transparent }]).polarity).toBeNull();
	});
});
