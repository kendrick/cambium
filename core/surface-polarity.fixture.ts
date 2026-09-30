import type { DecodedPixels } from './surface-polarity';

/**
 * One full-width stripe of flat colour. Stripes rather than shapes so a band's share of the image is
 * exact: `rows / total rows`, with no antialiased edge for a codec or a canvas to blur. `alpha`
 * defaults to opaque.
 */
export type Band = { rgb: readonly [number, number, number]; rows: number; alpha?: number };

export const FIXTURE_WIDTH = 100;

/** oklch(0.55 0.12 260), and the same lightness and chroma at hue 30. Both in sRGB gamut. */
export const DARK_KEY_BLUE = [0x46, 0x71, 0xb7] as const;
export const DARK_KEY_RED = [0xac, 0x53, 0x46] as const;

/** oklch(0.62 0.12 260), and the same lightness and chroma at hue 90. Both in sRGB gamut. */
export const LIGHT_KEY_BLUE = [0x5a, 0x86, 0xce] as const;
export const LIGHT_KEY_OCHRE = [0xa2, 0x82, 0x18] as const;

/**
 * A white page, 40% of the image, under four dark stripes that together cover 60%. The pixel
 * majority is dark and the surface is still white, so a pixel-majority rule reads this dark. Mean
 * luminance (about 0.45) still reads it light; `DARK_DOMINANT` is the fixture that catches a mean
 * rule.
 */
export const LIGHT_DOMINANT: readonly Band[] = [
	{ rgb: [0xff, 0xff, 0xff], rows: 40 },
	{ rgb: [0x1a, 0x1a, 0x1a], rows: 15 },
	{ rgb: [0x38, 0x38, 0x38], rows: 15 },
	{ rgb: [0x58, 0x58, 0x58], rows: 15 },
	{ rgb: DARK_KEY_BLUE, rows: 15 },
];

/**
 * A #111111 page, 45% of the image, under four light stripes. Mean luminance is about 0.35, well
 * above `DARK_SURFACE_LUMINANCE`, and 55% of the pixels are light, so both a mean rule and a
 * pixel-majority rule read this light. #111111's channels are 17, one past a 16-wide bucket edge,
 * where one grid alone starts to lose to codec noise.
 */
export const DARK_DOMINANT: readonly Band[] = [
	{ rgb: [0x11, 0x11, 0x11], rows: 45 },
	{ rgb: [0xff, 0xff, 0xff], rows: 14 },
	{ rgb: [0xe0, 0xe0, 0xe0], rows: 14 },
	{ rgb: [0xc0, 0xc0, 0xc0], rows: 14 },
	{ rgb: LIGHT_KEY_BLUE, rows: 13 },
];

export function withBand(bands: readonly Band[], index: number, rgb: Band['rgb']): Band[] {
	return bands.map((band, i) => (i === index ? { ...band, rgb } : band));
}

export function paintBands(bands: readonly Band[], width = FIXTURE_WIDTH): DecodedPixels {
	const height = bands.reduce((total, band) => total + band.rows, 0);
	const data = new Uint8ClampedArray(width * height * 4);
	let offset = 0;

	for (const { rgb, rows, alpha = 255 } of bands) {
		for (let pixel = 0; pixel < rows * width; pixel += 1, offset += 4) {
			data[offset] = rgb[0];
			data[offset + 1] = rgb[1];
			data[offset + 2] = rgb[2];
			data[offset + 3] = alpha;
		}
	}

	return { data, width, height };
}
