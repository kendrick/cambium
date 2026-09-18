import type { ReferenceImage } from '../core/brand-record';

/**
 * Turns a file the user picked into the `ReferenceImage` a `BrandRecord` stores: sniff the real
 * format, downscale it if it is bigger than the model needs, and hash the original for
 * provenance. One module because those are three steps of one pipeline and every caller wants
 * one answer, not three functions to wire together the same way each time.
 *
 * `ReferenceImage` is imported as a type only. `core/brand-record.ts` imports zod at module
 * scope, and zod costs about 93 kB gzip against a 200 kB first-load budget that already spends
 * 176 kB elsewhere — see `lib/bundle-budget.ts`. A value import here would pull zod into every
 * chunk that touches image intake, which is the upload picker on the landing route.
 *
 * Residual left to the Playwright suite (#47/#48), per `docs/agents/testing.md`: a real WebP
 * round trip cannot be decoded under Node, so "the stored data URL decodes back to these pixels"
 * is only provable in a browser. This module and its tests prove everything upstream of that —
 * sniffing, sizing, hashing, and which bytes get stored — and stop at the platform's own decoder.
 */

export type AcceptedImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Bytes `sniffImageType` and `describeRejectedBytes` need. */
export const SNIFF_BYTES = 12;

/**
 * The long edge a reference image is downscaled to before it is stored.
 *
 * The research notes' own snippet uses 1024; this diverges on purpose. 1568 is the Messages
 * API's long-edge ceiling, so it is the largest size that costs nothing extra in tokens — the
 * API resizes to its own tile grid on arrival regardless, and a UI screenshot is one of the
 * three input kinds issue #22 names where legible text is the whole signal a downscale can't
 * afford to blur away.
 */
export const MAX_EDGE_PX = 1568;

export const WEBP_QUALITY = 0.85;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP_FOURCC = [0x57, 0x45, 0x42, 0x50];

function matchesAt(head: Uint8Array, offset: number, bytes: number[]): boolean {
	if (head.length < offset + bytes.length) return false;

	return bytes.every((byte, index) => head[offset + index] === byte);
}

/**
 * Decides from magic bytes only — never `File.type`, never the filename. Both describe what the
 * OS guessed, and a HEIC photo renamed to `logo.png` reports `image/png` right up until something
 * actually reads its bytes. This is that something.
 *
 * The Messages API also accepts GIF (see `app/readers/anthropic-request.ts`), but issue #22
 * names three formats for the upload picker and a fourth buys nothing here.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
	if (matchesAt(head, 0, PNG_SIGNATURE)) return 'image/png';
	if (matchesAt(head, 0, JPEG_SIGNATURE)) return 'image/jpeg';
	if (matchesAt(head, 0, RIFF) && matchesAt(head, 8, WEBP_FOURCC)) return 'image/webp';

	return null;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function asciiAt(head: Uint8Array, offset: number, length: number): string {
	return Array.from(head.subarray(offset, offset + length))
		.map((byte) => String.fromCharCode(byte))
		.join('');
}

/**
 * A short human label for the common near-misses, so the picker can say what actually arrived
 * instead of just "unsupported". HEIC gets its own branch because it is the iPhone case the
 * research notes call out by name — the format a user is statistically most likely to hit this
 * with, dragged straight off a Photos export.
 *
 * Twelve bytes is not enough to be exhaustive: an SVG that opens with a byte-order mark, leading
 * whitespace, or an XML comment slips past the `<svg` / `<?xml` check below. That only costs a
 * less specific message here — `sniffImageType` never accepts it either way.
 */
export function describeRejectedBytes(head: Uint8Array): string | null {
	if (matchesAt(head, 0, [0x47, 0x49, 0x46, 0x38])) return 'GIF';

	if (matchesAt(head, 4, [0x66, 0x74, 0x79, 0x70])) {
		const brand = asciiAt(head, 8, 4);
		if (HEIC_BRANDS.has(brand)) return 'HEIC';
		if (AVIF_BRANDS.has(brand)) return 'AVIF';
	}

	const leading = asciiAt(head, 0, Math.min(5, head.length));
	if (leading.startsWith('<svg') || leading.startsWith('<?xml')) return 'SVG';

	if (matchesAt(head, 0, [0x25, 0x50, 0x44, 0x46])) return 'PDF';

	return null;
}

/**
 * The largest size that fits inside `maxEdge` on its long side, holding aspect ratio. Guards
 * zero or negative input by returning it unchanged rather than dividing — a caller passing a
 * broken probe result gets that same broken result back, not `NaN` or `Infinity` laundered
 * through rounding.
 */
export function fitWithin(
	width: number,
	height: number,
	maxEdge: number,
): { width: number; height: number } {
	if (width <= 0 || height <= 0) return { width, height };

	const scale = Math.min(1, maxEdge / Math.max(width, height));

	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Decoded pixels. Narrower than `ImageBitmap` so a Node test can supply one with no canvas. */
export type DecodedImage = {
	readonly width: number;
	readonly height: number;
	close(): void;
};

/**
 * The two platform calls that do not exist under Node, in one seam — the same shape
 * `ReferenceImageDecoder` uses in `app/readers/local-reader.ts` for the same reason: decoding
 * and encoding are the only parts of this pipeline that need a browser, so they're the only
 * parts injected. A test drives `prepareReferenceImage` with a fake `ImageCodec`; the default
 * below is the real thing.
 */
export type ImageCodec = {
	decode(blob: Blob, resize?: { width: number; height: number }): Promise<DecodedImage>;
	encode(source: Blob, size: { width: number; height: number }): Promise<Blob>;
};

export const platformImageCodec: ImageCodec = {
	async decode(blob, resize) {
		if (!resize) return createImageBitmap(blob);

		return createImageBitmap(blob, {
			resizeWidth: resize.width,
			resizeHeight: resize.height,
			resizeQuality: 'high',
		});
	},

	async encode(source, size) {
		const bitmap = await createImageBitmap(source, {
			resizeWidth: size.width,
			resizeHeight: size.height,
			resizeQuality: 'high',
		});

		try {
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = canvas.getContext('2d');

			if (!context) {
				throw new Error('a 2d canvas context is required to encode a reference image');
			}

			context.drawImage(bitmap, 0, 0);

			return await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
		} finally {
			// iOS enforces a hard canvas memory ceiling (see pica's wiki on it), so every bitmap this
			// codec creates gets closed on every path, including this error path — a decode failure
			// otherwise leaks exactly the same bytes a plain success would have released.
			bitmap.close();
		}
	},
};

/** What `prepareReferenceImage` hands back on success. */
export type PreparedImage = {
	image: ReferenceImage;
	mediaType: AcceptedImageType;
	/** Read back off the ENCODED blob, never off the resize that was requested. */
	width: number;
	height: number;
	/** The encoded blob's own byte length. */
	bytes: number;
};

export type IntakeResult =
	| { kind: 'prepared'; prepared: PreparedImage; rejected?: never }
	| { kind: 'unsupported'; prepared?: never; rejected: { detected: string | null } };

/**
 * `btoa` over a binary string, built in chunks. `String.fromCharCode(...bytes)` spread over a
 * megabyte image blows the engine's call-argument limit, so the string is assembled a slice at a
 * time instead.
 */
function toBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = '';

	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}

	return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);

	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Turns a picked file into the `ReferenceImage` a `BrandRecord` stores.
 *
 * Rejects by returning rather than throwing: picking the wrong file is an ordinary user action,
 * not an exceptional one, the same reasoning `LocalExtraction` uses in
 * `app/readers/local-extract.ts` for "no brand colour" rather than an error.
 */
export async function prepareReferenceImage(
	file: Blob,
	codec: ImageCodec = platformImageCodec,
): Promise<IntakeResult> {
	const original = new Uint8Array(await file.arrayBuffer());
	const head = original.subarray(0, SNIFF_BYTES);
	const sniffed = sniffImageType(head);

	if (!sniffed) {
		return { kind: 'unsupported', rejected: { detected: describeRejectedBytes(head) } };
	}

	const probe = await codec.decode(file);
	const probeWidth = probe.width;
	const probeHeight = probe.height;
	probe.close();

	const fitted = fitWithin(probeWidth, probeHeight, MAX_EDGE_PX);

	// An image already inside the cap is passed through byte for byte: no resize, no re-encode,
	// media type unchanged. This is more than an optimisation — `app/readers/local-extract.ts`
	// samples flat logo regions pixel by pixel to recover a brand colour, and a lossy WebP
	// re-encode would shift exactly the colour that step is asked to read back.
	const passthrough = fitted.width === probeWidth && fitted.height === probeHeight;
	const stored = passthrough ? file : await codec.encode(file, fitted);
	const mediaType: AcceptedImageType = passthrough ? sniffed : 'image/webp';

	// Measured off the artefact that is actually about to be stored, never off `fitted`. A resize
	// request is a hint the platform can round or clamp on its own terms — even the passthrough
	// path re-decodes, because the "requested vs. actual" gap is exactly what this method exists
	// to close, not a shortcut worth special-casing away.
	const landed = await codec.decode(stored);
	const width = landed.width;
	const height = landed.height;
	landed.close();

	const originalHash = `sha256:${await sha256Hex(original)}`;
	const storedBytes = new Uint8Array(await stored.arrayBuffer());
	const downscaled = `data:${mediaType};base64,${toBase64(storedBytes)}`;

	const image: ReferenceImage = { id: crypto.randomUUID(), downscaled, originalHash };

	return {
		kind: 'prepared',
		prepared: { image, mediaType, width, height, bytes: stored.size },
	};
}
