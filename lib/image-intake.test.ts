import { describe, expect, it } from 'vitest';

import {
	describeRejectedBytes,
	fitWithin,
	ImageEncodeError,
	MAX_EDGE_PX,
	prepareReferenceImage,
	sniffImageType,
	type DecodedImage,
	type ImageCodec,
} from './image-intake';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const WAV_HEAD = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0];
const SVG_HEAD = Array.from('<svg xmlns').map((char) => char.charCodeAt(0));
const HEIC_HEAD = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];
const AVIF_HEAD = [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66];
const HEIF_MIF1_HEAD = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31];
const HEIF_MSF1_HEAD = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x73, 0x66, 0x31];
const PDF_HEAD = Array.from('%PDF-1.7').map((char) => char.charCodeAt(0));

function bytes(values: number[]): Uint8Array<ArrayBuffer> {
	return new Uint8Array(values);
}

/**
 * A stand-in for encoder output, carrying a real WebP signature and padded to `size` bytes.
 *
 * The signature is not decoration. `prepareReferenceImage` names the stored blob by sniffing it,
 * never by its `Blob.type`, so a fake encoder returning arbitrary bytes under a WebP label is
 * rejected — which is the whole point of that rule and was what these fakes used to lean on.
 */
function encodedWebp(size = WEBP_HEAD.length): Blob {
	const out = new Uint8Array(size);
	out.set(WEBP_HEAD.slice(0, Math.min(WEBP_HEAD.length, size)));

	return new Blob([out], { type: 'image/webp' });
}

function inertBitmap(width: number, height: number): DecodedImage {
	return { width, height, close() {} };
}

/**
 * A codec a test can fully control: what dimensions a decode reports and what bytes an encode
 * hands back. The defaults report an 800x600 image no test relies on, so a test only needs to
 * override the calls it actually cares about.
 */
function fakeCodec(overrides: Partial<ImageCodec> = {}): ImageCodec {
	return {
		async decode() {
			return inertBitmap(800, 600);
		},
		async encode() {
			return encodedWebp();
		},
		...overrides,
	};
}

describe('sniffImageType', () => {
	it('accepts a real PNG signature', () => {
		expect(sniffImageType(bytes(PNG_HEAD))).toBe('image/png');
	});

	it('accepts a real JPEG signature', () => {
		expect(sniffImageType(bytes(JPEG_HEAD))).toBe('image/jpeg');
	});

	it('accepts a real RIFF/WEBP signature', () => {
		expect(sniffImageType(bytes(WEBP_HEAD))).toBe('image/webp');
	});

	it('rejects RIFF with a non-WEBP fourcc at offset 8', () => {
		expect(sniffImageType(bytes(WAV_HEAD))).toBeNull();
	});

	it('rejects a GIF', () => {
		expect(sniffImageType(bytes(GIF_HEAD))).toBeNull();
	});

	it('rejects an SVG', () => {
		expect(sniffImageType(bytes(SVG_HEAD))).toBeNull();
	});

	it('rejects a zero-length head', () => {
		expect(sniffImageType(new Uint8Array(0))).toBeNull();
	});
});

describe('describeRejectedBytes', () => {
	it('names GIF', () => {
		expect(describeRejectedBytes(bytes(GIF_HEAD))).toBe('GIF');
	});

	it('names HEIC', () => {
		expect(describeRejectedBytes(bytes(HEIC_HEAD))).toBe('HEIC');
	});

	it('names AVIF', () => {
		expect(describeRejectedBytes(bytes(AVIF_HEAD))).toBe('AVIF');
	});

	// mif1 and msf1 are the generic HEIF container brands and carry no codec claim, so calling them
	// HEIC names a format the file may not be.
	it('names a generic HEIF container HEIF rather than HEIC', () => {
		expect(describeRejectedBytes(bytes(HEIF_MIF1_HEAD))).toBe('HEIF');
		expect(describeRejectedBytes(bytes(HEIF_MSF1_HEAD))).toBe('HEIF');
	});

	it('names SVG', () => {
		expect(describeRejectedBytes(bytes(SVG_HEAD))).toBe('SVG');
	});

	it('names PDF', () => {
		expect(describeRejectedBytes(bytes(PDF_HEAD))).toBe('PDF');
	});

	it('returns null for bytes it cannot place', () => {
		expect(describeRejectedBytes(bytes(PNG_HEAD))).toBeNull();
	});
});

describe('fitWithin', () => {
	it('fits a 4000x3000 image against 1568 to 1568x1176', () => {
		expect(fitWithin(4000, 3000, 1568)).toEqual({ width: 1568, height: 1176 });
	});

	it('fits a 3000x4000 image to 1176x1568 regardless of orientation', () => {
		expect(fitWithin(3000, 4000, 1568)).toEqual({ width: 1176, height: 1568 });
	});

	it('returns an image already inside the cap unchanged', () => {
		expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 });
	});

	it('returns an exactly-1568 edge unchanged, with no rounding-error resize', () => {
		expect(fitWithin(1568, 900, 1568)).toEqual({ width: 1568, height: 900 });
	});

	it('returns non-positive dimensions unchanged rather than dividing', () => {
		expect(fitWithin(0, 500, 1568)).toEqual({ width: 0, height: 500 });
		expect(fitWithin(-10, 500, 1568)).toEqual({ width: -10, height: 500 });
	});

	/**
	 * A positive edge that rounds to zero reaches `createImageBitmap` as `resizeHeight: 0`, and the
	 * browser refuses an image it had already decoded. The picker then calls a good file damaged,
	 * which is the misleading failure `ImageEncodeError` exists to prevent, by another route.
	 */
	it('never rounds a positive edge down to zero', () => {
		expect(fitWithin(5000, 1, 1568)).toEqual({ width: 1568, height: 1 });
		expect(fitWithin(4000, 3, 1568)).toEqual({ width: 1568, height: 1 });
		expect(fitWithin(1, 5000, 1568)).toEqual({ width: 1, height: 1568 });
	});
});

describe('prepareReferenceImage', () => {
	it('downscales an oversized PNG to a webp data URL with a sha256 hash', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const codec = fakeCodec({
			async decode(blob) {
				// First call is the probe (oversized); second is the post-encode measurement.
				const isProbe = blob === file;
				return isProbe
					? { width: 4000, height: 3000, close() {} }
					: { width: 1568, height: 1176, close() {} };
			},
			async encode() {
				return encodedWebp();
			},
		});

		const result = await prepareReferenceImage(file, codec);

		expect(result.kind).toBe('prepared');
		if (result.kind !== 'prepared') return;
		expect(result.prepared.image.downscaled).toMatch(/^data:image\/webp;base64,/);
		expect(result.prepared.image.originalHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(result.prepared.mediaType).toBe('image/webp');
	});

	it('hashes the original, not the output: same encoded bytes, different originals', async () => {
		const fileA = new Blob([bytes([...PNG_HEAD, 1, 2, 3])], { type: 'image/png' });
		const fileB = new Blob([bytes([...PNG_HEAD, 4, 5, 6])], { type: 'image/png' });
		const codec = fakeCodec({
			async decode() {
				return { width: 4000, height: 3000, close() {} };
			},
			async encode() {
				// Both files resize down to the exact same encoded bytes.
				return encodedWebp();
			},
		});

		const resultA = await prepareReferenceImage(fileA, codec);
		const resultB = await prepareReferenceImage(fileB, codec);

		expect(resultA.kind).toBe('prepared');
		expect(resultB.kind).toBe('prepared');
		if (resultA.kind !== 'prepared' || resultB.kind !== 'prepared') return;
		expect(resultA.prepared.image.downscaled).toBe(resultB.prepared.image.downscaled);
		expect(resultA.prepared.image.originalHash).not.toBe(resultB.prepared.image.originalHash);
	});

	it('passes a within-cap image through unchanged and never calls encode', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		let encodeCalls = 0;
		const codec = fakeCodec({
			async decode() {
				return { width: 800, height: 600, close() {} };
			},
			async encode() {
				encodeCalls += 1;
				return encodedWebp();
			},
		});

		const result = await prepareReferenceImage(file, codec);

		expect(encodeCalls).toBe(0);
		expect(result.kind).toBe('prepared');
		if (result.kind !== 'prepared') return;
		expect(result.prepared.mediaType).toBe('image/png');
		expect(result.prepared.image.downscaled).toMatch(/^data:image\/png;base64,/);
	});

	it('produces a distinct uuid per call', async () => {
		const codec = fakeCodec({
			async decode() {
				return { width: 800, height: 600, close() {} };
			},
		});
		const fileA = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const fileB = new Blob([bytes(JPEG_HEAD)], { type: 'image/jpeg' });

		const resultA = await prepareReferenceImage(fileA, codec);
		const resultB = await prepareReferenceImage(fileB, codec);

		expect(resultA.kind).toBe('prepared');
		expect(resultB.kind).toBe('prepared');
		if (resultA.kind !== 'prepared' || resultB.kind !== 'prepared') return;
		expect(resultA.prepared.image.id).not.toBe(resultB.prepared.image.id);
	});

	it('returns unsupported with a detected label and never calls encode', async () => {
		const file = new Blob([bytes(GIF_HEAD)], { type: 'image/gif' });
		let encodeCalls = 0;
		const codec = fakeCodec({
			async encode() {
				encodeCalls += 1;
				return encodedWebp();
			},
		});

		const result = await prepareReferenceImage(file, codec);

		expect(encodeCalls).toBe(0);
		expect(result).toEqual({ kind: 'unsupported', rejected: { detected: 'GIF' } });
	});

	/**
	 * The point of `sniffImageType`: a browser-reported `File.type` and filename both say PNG,
	 * and the bytes say HEIC. Asserted through the pipeline, not the sniffer directly, so the
	 * test proves `prepareReferenceImage` actually consults bytes rather than the declaration.
	 */
	it('rejects a HEIC file renamed and declared as a PNG', async () => {
		const file = new File([bytes(HEIC_HEAD)], 'logo.png', { type: 'image/png' });

		const result = await prepareReferenceImage(file, fakeCodec());

		expect(result).toEqual({ kind: 'unsupported', rejected: { detected: 'HEIC' } });
	});

	it('reports bytes from the encoded blob, not from width times height', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const encodedBlob = encodedWebp(37);
		const codec = fakeCodec({
			async decode(blob) {
				return blob === file
					? { width: 4000, height: 3000, close() {} }
					: { width: 1568, height: 1176, close() {} };
			},
			async encode() {
				// Byte length has nothing to do with the pixel count it was asked to encode.
				return encodedBlob;
			},
		});

		const result = await prepareReferenceImage(file, codec);

		expect(result.kind).toBe('prepared');
		if (result.kind !== 'prepared') return;
		expect(result.prepared.bytes).toBe(encodedBlob.size);
		expect(result.prepared.bytes).not.toBe(1568 * 1176);
	});

	/**
	 * `fitWithin` computes a target the encoder is only ever handed as a hint. This test must
	 * fail if the implementation ever reports that computed target instead of re-measuring the
	 * artefact that actually landed.
	 */
	it('reports the dimensions decode returns for the stored blob, not the requested fit', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const encodedBlob = encodedWebp();
		const codec = fakeCodec({
			async decode(blob) {
				if (blob === file) return { width: 4000, height: 3000, close() {} };
				// The encoder clamped to even numbers; fitWithin would have computed 1568x1176.
				expect(blob).toBe(encodedBlob);
				return { width: 1566, height: 1174, close() {} };
			},
			async encode() {
				return encodedBlob;
			},
		});

		const result = await prepareReferenceImage(file, codec);

		expect(result.kind).toBe('prepared');
		if (result.kind !== 'prepared') return;
		expect(result.prepared.width).toBe(1566);
		expect(result.prepared.height).toBe(1174);
		expect(fitWithin(4000, 3000, MAX_EDGE_PX)).toEqual({ width: 1568, height: 1176 });
	});

	/**
	 * A file picker caps nothing, so a renamed multi-gigabyte video reaches this function. Reading
	 * twelve bytes settles it, and buffering the whole file first would allocate all of it to arrive
	 * at the same rejection. `slice` returns a new Blob, so the instrumented `arrayBuffer` below
	 * counts whole-file reads only.
	 */
	it('rejects on the signature without buffering the whole file', async () => {
		const file = new Blob([bytes(GIF_HEAD)], { type: 'image/gif' });
		let wholeFileReads = 0;
		const read = file.arrayBuffer.bind(file);
		file.arrayBuffer = async () => {
			wholeFileReads += 1;

			return read();
		};

		const result = await prepareReferenceImage(file, fakeCodec());

		expect(result.kind).toBe('unsupported');
		expect(wholeFileReads).toBe(0);
	});

	/**
	 * A valid PNG signature in front of a body the decoder cannot read is the case the twelve-byte
	 * gate cannot catch. Decoding settles it from the blob, so the whole file must not have been
	 * buffered by the time that failure arrives.
	 */
	it('does not buffer the whole file before the decode rejects it', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		let wholeFileReads = 0;
		const read = file.arrayBuffer.bind(file);
		file.arrayBuffer = async () => {
			wholeFileReads += 1;

			return read();
		};
		const codec = fakeCodec({
			async decode() {
				throw new Error('the source image could not be decoded');
			},
		});

		await expect(prepareReferenceImage(file, codec)).rejects.toThrow(/could not be decoded/);
		expect(wholeFileReads).toBe(0);
	});

	// The other half of the reorder: an accepted file still gets read in full, once, because
	// `originalHash` has to run over every byte.
	it('buffers the whole file once the signature is accepted', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		let wholeFileReads = 0;
		const read = file.arrayBuffer.bind(file);
		file.arrayBuffer = async () => {
			wholeFileReads += 1;

			return read();
		};

		const result = await prepareReferenceImage(file, fakeCodec());

		expect(result.kind).toBe('prepared');
		expect(wholeFileReads).toBe(1);
	});

	/**
	 * The case the first version of this fix would have passed and should not have. `ImageCodec` is
	 * an injectable seam, so `Blob.type` is a declaration like any other, and trusting it here would
	 * put WebP bytes into a paid Messages call under a PNG header: the defect the fix exists to
	 * close, one layer up inside the fix itself.
	 */
	it('believes the bytes over the blob type when the two disagree', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const codec = fakeCodec({
			async decode(blob) {
				return blob === file
					? { width: 4000, height: 3000, close() {} }
					: { width: 1568, height: 1176, close() {} };
			},
			// WebP bytes wearing a PNG label.
			async encode() {
				return new Blob([bytes(WEBP_HEAD)], { type: 'image/png' });
			},
		});

		const result = await prepareReferenceImage(file, codec);

		expect(result.kind).toBe('prepared');
		if (result.kind !== 'prepared') return;
		expect(result.prepared.mediaType).toBe('image/webp');
		expect(result.prepared.image.downscaled).toMatch(/^data:image\/webp;base64,/);
	});

	/**
	 * `convertToBlob` falls back to PNG wherever the UA cannot encode the type it was handed, and
	 * reports the fallback on the blob. Declaring `image/webp` regardless put PNG bytes under a WebP
	 * header, which `app/readers/anthropic-request.ts` forwards to the Messages API as the image's
	 * media type. This fails if the encode branch ever assumes its own output type again.
	 */
	it('labels the encoded blob by what came back, not by what was requested', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const codec = fakeCodec({
			async decode(blob) {
				return blob === file
					? { width: 4000, height: 3000, close() {} }
					: { width: 1568, height: 1176, close() {} };
			},
			// A browser that cannot encode WebP from a canvas hands back PNG and says so.
			async encode() {
				return new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
			},
		});

		const result = await prepareReferenceImage(file, codec);

		expect(result.kind).toBe('prepared');
		if (result.kind !== 'prepared') return;
		expect(result.prepared.mediaType).toBe('image/png');
		expect(result.prepared.image.downscaled).toMatch(/^data:image\/png;base64,/);
	});

	// A blob with no type at all still has to be labelled honestly, and only its bytes can say.
	it('falls back to the encoded bytes when the blob carries no type', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const codec = fakeCodec({
			async decode(blob) {
				return blob === file
					? { width: 4000, height: 3000, close() {} }
					: { width: 1568, height: 1176, close() {} };
			},
			async encode() {
				return new Blob([bytes(WEBP_HEAD)]);
			},
		});

		const result = await prepareReferenceImage(file, codec);

		expect(result.kind).toBe('prepared');
		if (result.kind !== 'prepared') return;
		expect(result.prepared.mediaType).toBe('image/webp');
	});

	// Typed rather than bare, because the picker gives opposite advice for this and for a file it
	// could not read, and it can only choose if it can tell them apart.
	it('refuses to store an encoded blob it cannot name, as a named error', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const codec = fakeCodec({
			async decode(blob) {
				return blob === file
					? { width: 4000, height: 3000, close() {} }
					: { width: 1568, height: 1176, close() {} };
			},
			async encode() {
				return new Blob([bytes(GIF_HEAD)]);
			},
		});

		await expect(prepareReferenceImage(file, codec)).rejects.toThrow(ImageEncodeError);
		await expect(prepareReferenceImage(file, codec)).rejects.toMatchObject({
			name: 'ImageEncodeError',
			kind: 'image-encode-failed',
		});
	});

	it('closes every bitmap the codec hands out', async () => {
		const file = new Blob([bytes(PNG_HEAD)], { type: 'image/png' });
		const closeCalls: boolean[] = [];
		function trackedBitmap(width: number, height: number): DecodedImage {
			let closed = false;
			return {
				width,
				height,
				close() {
					closed = true;
					closeCalls.push(closed);
				},
			};
		}
		const codec: ImageCodec = {
			async decode(blob) {
				return blob === file ? trackedBitmap(4000, 3000) : trackedBitmap(1568, 1176);
			},
			async encode() {
				return encodedWebp();
			},
		};

		await prepareReferenceImage(file, codec);

		// One close for the initial probe, one for the post-encode measurement.
		expect(closeCalls).toEqual([true, true]);
	});
});
