import { deflateSync } from 'node:zlib';

/**
 * Byte-level PNG generators for #105: three of #22's five defects (a malformed file, an
 * oversized one, and a renamed one) needed images this repo never had to construct, so a wrong
 * fixture failed silently instead of catching the regression it existed to guard.
 *
 * Everything here is pure bytes over `node:zlib`'s `deflateSync`, with no dependency on an image
 * decoder—`pngjs` is a devDependency the *tests* use to check these bytes from the outside;
 * the generators themselves never import it. That split is the point: a generator that decoded
 * its own output to check it would only prove agreement with itself.
 */

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

// Truecolour-with-alpha, 8 bits per channel: the one PNG colour type where a pixel is exactly
// four bytes, which keeps the scanline math below a single multiply.
const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;
const BYTES_PER_PIXEL = 4;

// The dimensions from #22's actual incident: inside the pixel cap, and still the shape that
// makeFatPng below pads out with an oversized ancillary chunk.
const FAT_WIDTH = 400;
const FAT_HEIGHT = 300;

// An ancillary (lowercase-first) chunk type pngjs has no handler for, so its parser skips it as
// opaque bytes rather than trying to interpret them—exactly the shape a real embedder (a
// colour profile, a text comment) would take.
const FAT_CHUNK_TYPE = 'tEXt';
const FAT_CHUNK_KEYWORD = 'Padding';

/**
 * The CRC-32 table-based algorithm PNG's own spec specifies (ISO 3309 / ITU-T V.42, the same
 * polynomial zlib uses). Built once per process rather than per call, since every chunk this
 * module emits needs it.
 */
function buildCrcTable(): Uint32Array {
	const table = new Uint32Array(256);

	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}

	return table;
}

const CRC_TABLE = buildCrcTable();

/**
 * A from-scratch CRC-32, kept independent on purpose: `png.test.ts` checks every chunk this
 * module emits against `zlib.crc32` rather than against this function, so a bug shared between
 * the two would still be caught. This is the implementation `chunk` below actually signs with.
 */
export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;

	for (let i = 0; i < bytes.length; i++) {
		crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
	}

	return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value >>> 0, false);
	return out;
}

/** ASCII bytes for a fixed-width field (a chunk type, a box brand, …); one byte per char, no encoding. */
export function asciiBytes(text: string): Uint8Array {
	return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;

	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
}

/**
 * One PNG chunk: a 4-byte length, the 4-byte type, the data, and a CRC-32 over type-plus-data
 * (never over the length, which is how the PNG spec defines it).
 */
export function chunk(type: string, data: Uint8Array): Uint8Array {
	if (type.length !== 4) {
		throw new Error(`a PNG chunk type is exactly 4 ASCII bytes, got "${type}"`);
	}

	const typeAndData = concatBytes([asciiBytes(type), data]);

	return concatBytes([u32be(data.length), typeAndData, u32be(crc32(typeAndData))]);
}

function ihdrData(width: number, height: number): Uint8Array {
	const data = new Uint8Array(13);
	const view = new DataView(data.buffer);

	view.setUint32(0, width, false);
	view.setUint32(4, height, false);
	data[8] = BIT_DEPTH;
	data[9] = COLOR_TYPE_RGBA;
	data[10] = 0; // compression method: the only one PNG defines
	data[11] = 0; // filter method: the only one PNG defines
	data[12] = 0; // interlace method: none

	return data;
}

/**
 * One filter-0 (no-op) scanline per row, holding zeroed RGBA pixels. The generators here exist
 * to exercise a decoder's chunk handling, not to carry a picture, so the pixels themselves are
 * never read by anything.
 */
function idatData(width: number, height: number): Uint8Array {
	const stride = width * BYTES_PER_PIXEL;
	const raw = new Uint8Array((stride + 1) * height);

	for (let row = 0; row < height; row++) {
		raw[row * (stride + 1)] = 0; // filter type byte: 0 = none
	}

	const deflated = deflateSync(raw);

	return new Uint8Array(deflated.buffer, deflated.byteOffset, deflated.byteLength);
}

/** A well-formed PNG that decodes to exactly `width` x `height`, RGBA, 8 bits per channel. */
export function makePng(width: number, height: number): Uint8Array {
	return concatBytes([
		PNG_SIGNATURE,
		chunk('IHDR', ihdrData(width, height)),
		chunk('IDAT', idatData(width, height)),
		chunk('IEND', new Uint8Array(0)),
	]);
}

/**
 * A valid PNG cut off partway through its IDAT chunk's data—before the chunk's own CRC and
 * before IEND ever arrive. The cut point is derived from the real IDAT length rather than
 * hardcoded, so it lands inside the data on any platform's zlib output.
 */
export function makeTruncatedPng(): Uint8Array {
	const width = 4;
	const height = 4;
	const ihdrChunk = chunk('IHDR', ihdrData(width, height));
	const data = idatData(width, height);
	const idatChunkStart = PNG_SIGNATURE.length + ihdrChunk.length;
	const idatDataStart = idatChunkStart + 8; // past IDAT's own length + type fields
	const cut = idatDataStart + Math.ceil(data.length / 2);

	return concatBytes([PNG_SIGNATURE, ihdrChunk, chunk('IDAT', data)]).slice(0, cut);
}

/**
 * A 400x300 PNG (#22's incident dimensions: inside the pixel cap, oversized anyway) padded with
 * an ancillary `tEXt` chunk until the whole file is at least `bytes` long. The padding lives in
 * the ancillary chunk's data rather than in IDAT, because #22's actual defect was ancillary
 * bulk riding through untouched on a file whose pixels looked entirely ordinary.
 */
export function makeFatPng(bytes: number): Uint8Array {
	const ihdrChunk = chunk('IHDR', ihdrData(FAT_WIDTH, FAT_HEIGHT));
	const idatChunk = chunk('IDAT', idatData(FAT_WIDTH, FAT_HEIGHT));
	const iendChunk = chunk('IEND', new Uint8Array(0));
	const keyword = asciiBytes(FAT_CHUNK_KEYWORD);

	const baseLength = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
	// Chunk framing (length + type + crc) plus the tEXt keyword and its NUL separator: the part
	// of the ancillary chunk that isn't filler.
	const ancillaryOverhead = 12 + keyword.length + 1;
	const fillerLength = Math.max(0, bytes - baseLength - ancillaryOverhead);
	const fatData = concatBytes([keyword, Uint8Array.of(0), new Uint8Array(fillerLength)]);
	const fatChunk = chunk(FAT_CHUNK_TYPE, fatData);

	return concatBytes([PNG_SIGNATURE, ihdrChunk, idatChunk, fatChunk, iendChunk]);
}
