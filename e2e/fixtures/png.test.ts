import { crc32 as zlibCrc32 } from 'node:zlib';

import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';

import { chunk, crc32, makeFatPng, makePng, makeTruncatedPng } from './png';

/**
 * Every decode and rejection assertion below runs through `pngjs` (an independent decoder) or
 * `node:zlib`'s own `crc32` (an independent CRC oracle), never through this module's `crc32` or
 * a hand-rolled inflate. A test that decoded a generator's output with the generator's own logic
 * would only prove the two agree with each other, which is exactly the failure #105 exists to
 * close.
 */

function readUint32BE(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

/** Walks a PNG's chunks without inflating or CRC-checking anything — pure length-prefixed framing. */
function walkChunks(
	bytes: Uint8Array,
): Array<{ type: string; typeAndData: Uint8Array; storedCrc: number }> {
	const chunks: Array<{ type: string; typeAndData: Uint8Array; storedCrc: number }> = [];
	let offset = 8; // past the 8-byte PNG signature

	while (offset + 8 <= bytes.length) {
		const length = readUint32BE(bytes, offset);
		const chunkEnd = offset + 8 + length + 4;

		// A truncated fixture ends mid-chunk on purpose; stop rather than read past the end.
		if (chunkEnd > bytes.length) break;

		const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
		const typeAndData = bytes.slice(offset + 4, offset + 8 + length);
		const storedCrc = readUint32BE(bytes, offset + 8 + length);

		chunks.push({ type, typeAndData, storedCrc });
		offset = chunkEnd;
	}

	return chunks;
}

/** The recompute check criterion 5 names: independent of this module's own `crc32`. */
function chunkCrcMatches(typeAndData: Uint8Array, storedCrc: number): boolean {
	return zlibCrc32(Buffer.from(typeAndData)) === storedCrc;
}

describe('crc32', () => {
	test('matches zlib.crc32 on the IHDR of a known PNG', () => {
		// A PNG this test never generates and never reads with png.ts's own logic: pngjs synthesizes
		// it, so the "known PNG" is genuinely external to the module under test.
		const known = new PNG({ width: 3, height: 2 });
		known.data.fill(0);
		const knownBytes = PNG.sync.write(known);

		// IHDR is always the first chunk, always 13 bytes of data: signature (8) + length (4), then
		// 4 bytes of type and 13 of data.
		const ihdrTypeAndData = knownBytes.subarray(12, 12 + 4 + 13);

		expect(crc32(ihdrTypeAndData)).toBe(zlibCrc32(ihdrTypeAndData));
	});

	test('matches zlib.crc32 on random buffers', () => {
		const sizes = [0, 1, 7, 64, 1000];

		for (const size of sizes) {
			const bytes = new Uint8Array(size);
			for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);

			expect(crc32(bytes)).toBe(zlibCrc32(Buffer.from(bytes)));
		}
	});

	test('the recompute check rejects a chunk with one flipped CRC byte', () => {
		const original = chunk('tEXt', Uint8Array.of(1, 2, 3, 4));
		const typeAndData = original.slice(4, original.length - 4);
		const storedCrc = readUint32BE(original, original.length - 4);

		expect(chunkCrcMatches(typeAndData, storedCrc)).toBe(true);

		const flipped = original.slice();
		flipped[flipped.length - 1]! ^= 0xff; // flip one byte of the trailing CRC
		const flippedCrc = readUint32BE(flipped, flipped.length - 4);

		expect(chunkCrcMatches(typeAndData, flippedCrc)).toBe(false);
	});
});

describe('makePng', () => {
	test.each([
		[1, 1],
		[2, 3],
		[5, 4],
		[64, 32],
		[400, 300],
	])('decodes to exactly %ix%i', (width, height) => {
		const decoded = PNG.sync.read(Buffer.from(makePng(width, height)));

		expect(decoded.width).toBe(width);
		expect(decoded.height).toBe(height);
	});
});

describe('makeTruncatedPng', () => {
	test('pngjs rejects it by throwing, not by any byte-length check', () => {
		const bytes = makeTruncatedPng();

		expect(() => PNG.sync.read(Buffer.from(bytes))).toThrow(/./);
	});
});

describe('makeFatPng', () => {
	test.each([1000, 20_000, 2_000_000])(
		'is at least %i bytes and still decodes to 400x300',
		(target) => {
			const bytes = makeFatPng(target);

			expect(bytes.length).toBeGreaterThanOrEqual(target);

			const decoded = PNG.sync.read(Buffer.from(bytes));
			expect(decoded.width).toBe(400);
			expect(decoded.height).toBe(300);
		},
	);

	test('carries its weight in an ancillary chunk', () => {
		const bytes = makeFatPng(500_000);
		const chunks = walkChunks(bytes);

		const ancillary = chunks.filter((c) => {
			const firstByte = c.type.charCodeAt(0);
			return (firstByte & 0x20) !== 0; // lowercase first letter = ancillary, per the PNG spec
		});

		expect(ancillary.length).toBeGreaterThan(0);
		const bulk = ancillary.find((c) => c.typeAndData.length > 400_000);
		expect(bulk).toBeDefined();
	});
});

describe('every chunk every generator emits', () => {
	test('carries a CRC-32 that matches a recomputation from its own type and data', () => {
		const fixtures: Array<[string, Uint8Array]> = [
			['makePng(1,1)', makePng(1, 1)],
			['makePng(64,32)', makePng(64, 32)],
			['makeTruncatedPng()', makeTruncatedPng()],
			['makeFatPng(50000)', makeFatPng(50_000)],
		];

		for (const [name, bytes] of fixtures) {
			const chunks = walkChunks(bytes);

			// A truncated fixture still has to yield at least the complete chunks before its cut,
			// or this loop would silently assert nothing about it.
			expect(chunks.length, `${name} produced no complete chunks to walk`).toBeGreaterThan(0);

			for (const c of chunks) {
				expect(
					chunkCrcMatches(c.typeAndData, c.storedCrc),
					`${name}: chunk "${c.type}" has a CRC that does not match its own type and data`,
				).toBe(true);
			}
		}
	});
});
