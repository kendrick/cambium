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

/**
 * What the picker takes, and the file dialog's `accept` list is built from this rather than
 * restating it.
 *
 * Deliberately three where `ACCEPTED_IMAGE_MEDIA_TYPES` in `app/readers/anthropic-request.ts` is
 * four: the Messages API also takes GIF, and issue #22 names three formats for upload. The lists
 * are related, not the same one, and collapsing them would quietly widen the picker.
 */
export const ACCEPTED_IMAGE_TYPES: readonly AcceptedImageType[] = [
	'image/png',
	'image/jpeg',
	'image/webp',
];

/**
 * Twelve, because that is where the longest signature this module reads actually ends: WebP's
 * `WEBP` fourcc sits at offset 8, and an ISO base media brand (`heic`, `avif`) sits at 8 as well,
 * right after `ftyp` at 4. A shorter head would make both of those unreadable.
 */
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

/**
 * `heic` and friends declare HEVC-coded images; `mif1` and `msf1` are the generic HEIF image and
 * image-sequence brands and say nothing about the codec. Reporting the second pair as HEIC names a
 * format the file may not be, in a message whose only job is to tell somebody what they just
 * handed over.
 */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
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
		if (HEIF_BRANDS.has(brand)) return 'HEIF';
		if (AVIF_BRANDS.has(brand)) return 'AVIF';
	}

	const leading = asciiAt(head, 0, Math.min(5, head.length));
	if (leading.startsWith('<svg') || leading.startsWith('<?xml')) return 'SVG';

	if (matchesAt(head, 0, [0x25, 0x50, 0x44, 0x46])) return 'PDF';

	return null;
}

/**
 * The largest size that fits inside `maxEdge` on its long side, holding aspect ratio.
 *
 * Zero or negative input comes back unchanged rather than being divided — a caller passing a broken
 * probe result gets that same broken result back, not `NaN` or `Infinity` laundered through
 * rounding.
 *
 * A positive edge never rounds to zero. A 5000x1 strip scales by 0.31 and rounds its short edge to
 * 0, which reaches `createImageBitmap` as `resizeHeight: 0`; the browser then refuses an image it
 * had already decoded, and the picker reports a perfectly good file as damaged. That is the same
 * misleading-failure class `ImageEncodeError` exists to prevent, arriving through a different door.
 *
 * A strip like that is accepted rather than rejected, which is a decision rather than an oversight.
 * Issue #22 takes reference images "of any kind" and names no minimum dimension, so a floor here
 * would be a number nobody asked for, turning away a wide banner crop or a colour strip that a
 * vision model can read perfectly well. The clamp is what makes accepting it safe.
 */
export function fitWithin(
	width: number,
	height: number,
	maxEdge: number,
): { width: number; height: number } {
	if (width <= 0 || height <= 0) return { width, height };

	const scale = Math.min(1, maxEdge / Math.max(width, height));

	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
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

/**
 * Thrown when the encoder returns something that is none of the three accepted types.
 *
 * A class carrying a `kind`, following `StorageQuotaExceededError` in
 * `app/storage/storage-estimate.ts`, because the caller has different advice to give here than for
 * a file it could not read, and matching a message string is not telling them apart. The file was
 * fine: it cleared the byte gate and decoded. Blaming it sends somebody off to re-export something
 * that was never wrong.
 */
export class ImageEncodeError extends Error {
	readonly kind = 'image-encode-failed';

	constructor(producedType: string, options?: { cause?: unknown }) {
		super(
			`the encoder returned a ${producedType || 'typeless'} blob that is not a PNG, JPEG, or WebP`,
			options,
		);
		this.name = 'ImageEncodeError';
	}
}

/**
 * What the encoder actually produced, read the way every other byte in this module is read.
 *
 * `Blob.type` is deliberately not consulted, not even as a fast path. `convertToBlob` is required to
 * report the format it really used, PNG fallback included, so for the platform codec the label
 * would be true. But `ImageCodec` is an injectable seam, and a codec handing back
 * `new Blob([webpBytes], { type: 'image/png' })` would put those bytes into a paid Messages call
 * under a PNG header: the defect this function exists to close, reappearing one layer up inside the
 * fix for it. Twelve bytes is not a price worth an exception to the rule stated at `sniffImageType`,
 * which is that a declaration never decides anything here.
 */
async function sniffStoredType(stored: Blob): Promise<AcceptedImageType> {
	const head = new Uint8Array(await stored.slice(0, SNIFF_BYTES).arrayBuffer());
	const sniffed = sniffImageType(head);

	if (!sniffed) {
		throw new ImageEncodeError(stored.type);
	}

	return sniffed;
}

/** Decodes only to read a size, so the bitmap is closed before the caller ever sees it. */
async function decodeSize(
	codec: ImageCodec,
	blob: Blob,
): Promise<{ width: number; height: number }> {
	const bitmap = await codec.decode(blob);

	try {
		return { width: bitmap.width, height: bitmap.height };
	} finally {
		bitmap.close();
	}
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
	// Twelve bytes before the whole file, and the order is the point. A renamed video is refused on
	// its signature alone, where buffering first would allocate the entire file into memory to reach
	// exactly the same answer. Nothing upstream caps what a file picker hands over.
	const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
	const sniffed = sniffImageType(head);

	if (!sniffed) {
		return { kind: 'unsupported', rejected: { detected: describeRejectedBytes(head) } };
	}

	// Now the whole file, and only now. `originalHash` identifies the file the user actually picked,
	// so it has to run over every byte; this reorders that read rather than avoiding it.
	const original = new Uint8Array(await file.arrayBuffer());

	const probe = await decodeSize(codec, file);
	const fitted = fitWithin(probe.width, probe.height, MAX_EDGE_PX);

	// An image already inside the cap is passed through byte for byte: no resize, no re-encode,
	// media type unchanged. This is more than an optimisation — `app/readers/local-extract.ts`
	// samples flat logo regions pixel by pixel to recover a brand colour, and a lossy WebP
	// re-encode would shift exactly the colour that step is asked to read back.
	const passthrough = fitted.width === probe.width && fitted.height === probe.height;
	const stored = passthrough ? file : await codec.encode(file, fitted);

	// Both branches take the type off the bytes being stored, never off the type the encoder was
	// asked for. `convertToBlob` falls back to PNG wherever the UA cannot encode what it was handed,
	// so a hardcoded `image/webp` here stamps that fallback as WebP. Nothing downstream re-checks it:
	// `app/readers/anthropic-request.ts` splits this data URL and sends the header to the Messages
	// API as the image's media type, so the mislabelling leaves the browser inside a paid call.
	//
	// Same discipline as the re-decode below, which is what made this worth catching: the size was
	// already measured off the artefact while the type beside it was still being assumed.
	const mediaType = passthrough ? sniffed : await sniffStoredType(stored);

	// Measured off the artefact that is actually about to be stored, never off `fitted`. A resize
	// request is a hint the platform can round or clamp on its own terms, and the passthrough path
	// re-decodes for the same reason: the gap between what was asked for and what landed is what
	// this second read exists to close, so skipping it on one branch would reopen it there.
	const landed = await decodeSize(codec, stored);

	const originalHash = `sha256:${await sha256Hex(original)}`;
	// On the passthrough path `stored` is `file`, so its bytes are the ones already in hand. Reading
	// it again would buffer the whole file a second time, which is the common case: every image
	// small enough to keep takes this branch.
	const storedBytes = passthrough ? original : new Uint8Array(await stored.arrayBuffer());
	const downscaled = `data:${mediaType};base64,${toBase64(storedBytes)}`;

	const image: ReferenceImage = { id: crypto.randomUUID(), downscaled, originalHash };

	return {
		kind: 'prepared',
		prepared: { image, mediaType, width: landed.width, height: landed.height, bytes: stored.size },
	};
}
