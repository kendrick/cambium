import type { SchemeName } from './scale-engine';

/**
 * RGBA, four bytes per pixel, row-major: what `getImageData` returns for a decoded image.
 *
 * Takes pixels instead of `images[].downscaled` because intake stores every image it re-encodes as
 * WebP, and only a browser decodes WebP (`lib/image-intake.ts`). The caller decodes and this module
 * does the arithmetic, so it runs under Node. Structurally the same as `PixelSample` in
 * `app/readers/local-extract.ts`, which core can't import.
 */
export type DecodedPixels = {
	data: Uint8ClampedArray;
	width: number;
	height: number;
};

export type DominantBackground = {
	/** Mean sRGB bytes of the pixels in the winning bucket. */
	rgb: readonly [number, number, number];
	/** WCAG 2.x relative luminance of `rgb`. */
	luminance: number;
	/** The winning bucket's share of the image's opaque pixels. */
	share: number;
	polarity: SchemeName;
};

/**
 * Below this alpha a pixel shows whatever page it lands on, which says nothing about the brand, so
 * it isn't counted.
 */
export const MIN_OPAQUE_ALPHA = 128;

/**
 * The relative luminance at which white and black text reach equal WCAG contrast:
 * 1.05 / (Y + 0.05) = (Y + 0.05) / 0.05. Below it white text reads better, which is what calling a
 * surface dark means here. Grey #757575 falls below and #767676 above.
 */
export const DARK_SURFACE_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;

const BUCKET_SHIFT = 4;

/**
 * Two grids, the second shifted half a bucket. A flat colour with codec noise near a bucket edge
 * splits across two buckets on one grid and sits whole on the other. Intake's lossy WebP re-encode
 * adds exactly that noise.
 */
const GRID_OFFSETS = [0, 1 << (BUCKET_SHIFT - 1)] as const;

function linearize(byte: number): number {
	const channel = byte / 255;

	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * The colour covering the most of an image, read as the brand's surface. Mean luminance and the
 * majority side of the threshold both misread common layouts: a light page carrying a large dark
 * photograph has more dark pixels than light ones, and a dark page under light content can average
 * out light.
 *
 * Returns null when no pixel is opaque enough to count.
 */
export function dominantBackground(pixels: DecodedPixels): DominantBackground | null {
	const { data, width, height } = pixels;
	const expected = width * height * 4;

	if (data.length !== expected) {
		throw new Error(
			`a ${width}x${height} image needs ${expected} bytes of RGBA, and this one has ${data.length}`,
		);
	}

	const grids = GRID_OFFSETS.map((offset) => {
		const levels = ((255 + offset) >> BUCKET_SHIFT) + 1;

		return {
			offset,
			levels,
			count: new Uint32Array(levels ** 3),
			sum: new Float64Array(levels ** 3 * 3),
		};
	});
	let opaque = 0;

	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < MIN_OPAQUE_ALPHA) continue;

		opaque += 1;

		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];

		for (const grid of grids) {
			const bucket =
				(((r + grid.offset) >> BUCKET_SHIFT) * grid.levels + ((g + grid.offset) >> BUCKET_SHIFT)) *
					grid.levels +
				((b + grid.offset) >> BUCKET_SHIFT);

			grid.count[bucket] += 1;
			grid.sum[bucket * 3] += r;
			grid.sum[bucket * 3 + 1] += g;
			grid.sum[bucket * 3 + 2] += b;
		}
	}

	if (opaque === 0) return null;

	// Strictly greater, so a tie keeps the first bucket found and the same pixels always give the
	// same answer.
	let winner = { grid: grids[0], bucket: 0, count: 0 };

	for (const grid of grids) {
		for (let bucket = 0; bucket < grid.count.length; bucket += 1) {
			if (grid.count[bucket] > winner.count) {
				winner = { grid, bucket, count: grid.count[bucket] };
			}
		}
	}

	const { grid, bucket, count } = winner;
	const rgb = [
		grid.sum[bucket * 3] / count,
		grid.sum[bucket * 3 + 1] / count,
		grid.sum[bucket * 3 + 2] / count,
	] as const;
	const luminance = relativeLuminance(rgb);

	return {
		rgb,
		luminance,
		share: count / opaque,
		polarity: luminance < DARK_SURFACE_LUMINANCE ? 'dark' : 'light',
	};
}

export type ImagePolarity = { imageId: string; background: DominantBackground | null };

export type SurfacePolarity = {
	/** null when no image had an opaque pixel to vote with. */
	polarity: SchemeName | null;
	images: ImagePolarity[];
};

/**
 * A brand's surface polarity, from the decoded `images[].downscaled` of one record.
 *
 * One vote per image, because image size comes from the 1568 px fit and from what someone happened
 * to upload, not from how much of the brand an image carries. A tie reads light: that's what every
 * brand is treated as today, so a wrong light answer changes nothing. ADR-0008 limits what a dark
 * answer may change to the scheme the workspace opens on.
 */
export function deriveSurfacePolarity(
	images: readonly { id: string; pixels: DecodedPixels }[],
): SurfacePolarity {
	const read = images.map(({ id, pixels }) => ({
		imageId: id,
		background: dominantBackground(pixels),
	}));
	let dark = 0;
	let light = 0;

	for (const { background } of read) {
		if (background?.polarity === 'dark') dark += 1;
		else if (background?.polarity === 'light') light += 1;
	}

	return {
		polarity: dark + light === 0 ? null : dark > light ? 'dark' : 'light',
		images: read,
	};
}
