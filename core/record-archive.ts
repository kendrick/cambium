import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import { type BrandRecord, BrandRecordSchema } from './brand-record';

/**
 * A brand record as a zip: `record.json` plus `images/<index>.<ext>` for each reference image, with
 * each image's `downscaled` in `record.json` holding that path instead of the data URL. Images go
 * in as decoded bytes, which saves the third that base64 adds.
 *
 * Everything here runs on `Uint8Array`, so the browser can build and read an archive with no
 * server, and the headless CLI can too.
 */

export type ArchiveErrorKind =
	| 'not-an-archive'
	| 'too-large'
	| 'missing-record'
	| 'unsafe-path'
	| 'missing-image'
	| 'invalid-record';

export type ArchiveError = { kind: ArchiveErrorKind; message: string };

export type DeserializeResult =
	| { ok: true; record: BrandRecord }
	| { ok: false; error: ArchiveError };

const RECORD_ENTRY = 'record.json';

/**
 * fflate allocates each deflated entry's output at the size its central header declares, before
 * inflating a byte, so a tiny archive can demand gigabytes.
 */
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

/**
 * Mirrors `AcceptedImageType` in `lib/image-intake.ts`, which is every type intake can store. Core
 * never imports from `lib/`, so a type added there has to be added here too, or an archive of a
 * record holding it fails in `serializeRecord`.
 */
const EXTENSION_FOR = new Map([
	['image/webp', 'webp'],
	['image/png', 'png'],
	['image/jpeg', 'jpeg'],
]);
// A Map so an extension like `toString` can't resolve to something on Object.prototype, and
// EXTENSION_FOR is one for the same reason with media types.
const MEDIA_TYPE_FOR = new Map(
	[...EXTENSION_FOR].map(([mediaType, extension]) => [extension, mediaType]),
);

/**
 * Built from local-time fields, not a UTC instant, because fflate writes an entry's DOS time from
 * `getFullYear()`, `getHours()` and the rest. `1980-01-01T00:00:00Z` is still 1979 anywhere west of
 * UTC, where fflate throws, and it lands on a different local time in every other zone, so the
 * bytes would depend on where the export ran.
 */
function zipEpoch(): Date {
	return new Date(1980, 0, 1, 0, 0, 0);
}

// Images are already compressed formats, so deflating them costs time and saves nothing. Both
// levels are pinned because the determinism promise covers the compressed bytes too.
const RECORD_LEVEL = 6;
const IMAGE_LEVEL = 0;

/**
 * Throws rather than returning an error, since the input is a record the app already holds. A
 * `downscaled` value that isn't a base64 data URL of an accepted type means something upstream
 * wrote a record intake never could, and an archive missing the image would be worse.
 */
export function serializeRecord(record: BrandRecord): Uint8Array {
	const epoch = zipEpoch();
	const files: Record<string, [Uint8Array, { level: 0 | 6; mtime: Date }]> = {};

	const images = record.images.map((image, index) => {
		const decoded = decodeDataUrl(image.downscaled);

		if (!decoded) {
			throw new Error(
				`image "${image.id}" is not stored as a base64 PNG, JPEG or WebP data URL, so it cannot be archived`,
			);
		}

		// Named by position, never by id. The schema lets an id be any non-empty string, including
		// `../x` and a lone UTF-16 surrogate, and no encoding turns every such string into a safe
		// entry name (`encodeURIComponent` throws on the surrogate). `downscaled` in record.json
		// carries the path, so the id never has to appear in it.
		const path = `images/${index}.${decoded.extension}`;
		files[path] = [decoded.bytes, { level: IMAGE_LEVEL, mtime: epoch }];

		return { ...image, downscaled: path };
	});

	const json = JSON.stringify(sortKeys({ ...record, images }), null, 2);
	files[RECORD_ENTRY] = [strToU8(json), { level: RECORD_LEVEL, mtime: epoch }];

	// fflate writes entries in key insertion order, so sorting here is what fixes their order.
	const sorted: Zippable = {};
	// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh.
	// oxlint-disable-next-line unicorn/no-array-sort
	for (const path of Object.keys(files).sort()) sorted[path] = files[path]!;

	return zipSync(sorted);
}

/**
 * Table of contents and size first, then checksums, then paths, then content. The central
 * directory is walked and its declared sizes summed before `unzipSync` runs, because fflate
 * allocates from those sizes and an archive refused as too large must never reach it. A damaged
 * archive is reported as damaged whatever it claims to contain, and every entry name is checked
 * before anything is parsed out of `record.json`, so a hostile name is refused in an archive that
 * is otherwise well formed.
 */
export function deserializeRecord(bytes: Uint8Array): DeserializeResult {
	const directory = readDirectory(bytes);

	if (!directory) {
		return fail(
			'not-an-archive',
			'This file is not a zip archive, or it is damaged: its table of contents cannot be read, or it lists an entry twice.',
		);
	}

	if (directory.unpackedBytes > MAX_UNPACKED_BYTES) {
		return fail(
			'too-large',
			`This archive would unpack to more than ${MAX_UNPACKED_BYTES / (1024 * 1024)} MiB, the most Cambium will open.`,
		);
	}

	let entries: Record<string, Uint8Array>;

	try {
		entries = unzipSync(bytes);
	} catch {
		return fail('not-an-archive', 'This file is not a zip archive, or it is cut short.');
	}

	const { checksums } = directory;

	if (checksums.size !== Object.keys(entries).length) {
		return fail(
			'not-an-archive',
			'This archive is damaged: its table of contents cannot be read, or it lists an entry twice.',
		);
	}

	for (const [name, contents] of Object.entries(entries)) {
		if (checksums.get(name) !== crc32(contents)) {
			return fail(
				'not-an-archive',
				`This archive is damaged or was altered: "${name}" does not match its checksum.`,
			);
		}
	}

	for (const [name, contents] of Object.entries(entries)) {
		// Info-ZIP's `zip -r` writes an empty `images/` entry for the folder, so an archive someone
		// unpacked and re-zipped carries one. It holds nothing, so it is dropped rather than refused.
		if (name.endsWith('/') && contents.length === 0 && isSafePath(name.slice(0, -1))) {
			delete entries[name];
			continue;
		}

		if (!isSafePath(name)) {
			return fail(
				'unsafe-path',
				`This archive holds an entry named "${name}", which is not a safe path inside the archive, so it was not opened.`,
			);
		}
	}

	const recordBytes = entries[RECORD_ENTRY];

	if (!recordBytes) {
		return fail(
			'missing-record',
			`This archive has no ${RECORD_ENTRY}, so it holds no brand record.`,
		);
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(strFromU8(recordBytes));
	} catch {
		return fail('invalid-record', `${RECORD_ENTRY} in this archive is not valid JSON.`);
	}

	const rehydrated = rehydrateImages(parsed, entries);

	if (!rehydrated.ok) return rehydrated;

	const result = BrandRecordSchema.safeParse(rehydrated.value);

	if (!result.success) {
		const [issue] = result.error.issues;
		const path = issue?.path.join('.') || '(root)';

		return fail(
			'invalid-record',
			`The record in this archive is not one this version of Cambium can read: ${path}: ${issue?.message ?? 'invalid'}.`,
		);
	}

	return { ok: true, record: result.data };
}

function fail(kind: ArchiveErrorKind, message: string): { ok: false; error: ArchiveError } {
	return { ok: false, error: { kind, message } };
}

/**
 * Leaves anything that isn't shaped like a record untouched, so `BrandRecordSchema` reports it in
 * its own words rather than this function inventing a second vocabulary for the same failures.
 */
function rehydrateImages(
	parsed: unknown,
	entries: Record<string, Uint8Array>,
): { ok: true; value: unknown } | { ok: false; error: ArchiveError } {
	if (!isObject(parsed) || !Array.isArray(parsed.images)) return { ok: true, value: parsed };

	const images: unknown[] = [];

	for (const image of parsed.images) {
		if (!isObject(image) || typeof image.downscaled !== 'string') {
			images.push(image);
			continue;
		}

		const path = image.downscaled;

		if (!isSafePath(path)) {
			return fail(
				'unsafe-path',
				`The record points an image at "${path}", which is outside the archive, so it was not opened.`,
			);
		}

		const contents = Object.hasOwn(entries, path) ? entries[path] : undefined;

		if (!contents) {
			return fail(
				'missing-image',
				`The record names the image "${path}", but the archive lacks it.`,
			);
		}

		const mediaType = MEDIA_TYPE_FOR.get(path.slice(path.lastIndexOf('.') + 1));

		if (!mediaType) {
			return fail(
				'invalid-record',
				`The image "${path}" is not a .png, .jpeg or .webp file, so it cannot be restored.`,
			);
		}

		images.push({ ...image, downscaled: `data:${mediaType};base64,${toBase64(contents)}` });
	}

	return { ok: true, value: { ...parsed, images } };
}

/**
 * Checked per segment rather than by substring, so a file name like `a..b.png` stays legal while
 * `images/../x` doesn't. Backslashes are refused outright because Windows extractors treat them as
 * separators, and an empty or `.` segment has no business in a path this module wrote.
 */
function isSafePath(path: string): boolean {
	if (path.length === 0 || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) {
		return false;
	}

	return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Arrays keep their order, since order is meaning in a record: versions run oldest first and
 * overrides apply in sequence. Only object keys are sorted.
 */
function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (!isObject(value)) return value;

	// Null-prototype because a plain `{}` treats an assigned `__proto__` key as a prototype setter,
	// and JSON.stringify would then drop it. Foreign `$extensions` payloads can carry that key as
	// data, and TokenExtensionsSchema passes them through.
	const sorted: Record<string, unknown> = Object.create(null);
	// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh.
	// oxlint-disable-next-line unicorn/no-array-sort
	for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);

	return sorted;
}

/**
 * Only the exact shape intake writes. A data URL with extra parameters would decode fine but
 * come back without them, and the round trip promises the record it was given.
 */
function decodeDataUrl(url: string): { bytes: Uint8Array; extension: string } | null {
	const match = /^data:([a-z]+\/[a-z]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
	const extension = match ? EXTENSION_FOR.get(match[1]!) : undefined;

	if (!match || !extension) return null;

	try {
		const binary = atob(match[2]!);
		return { bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)), extension };
	} catch {
		return null;
	}
}

/** Chunked for the same reason as `lib/image-intake.ts`: spreading a whole image blows the arg limit. */
function toBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = '';

	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}

	return btoa(binary);
}

/**
 * fflate's `unzipSync` never checks an entry's CRC, so a flipped byte in a stored (uncompressed)
 * image comes back as a different image with no error at all. This reads each entry's CRC from
 * the central directory so `deserializeRecord` can check it, and sums the uncompressed sizes
 * fflate will allocate so it can refuse an archive before fflate touches it. Names decode the way
 * fflate's own reader does, UTF-8 when general-purpose bit 11 is set and Latin-1 otherwise, so the
 * two agree on every key.
 *
 * Checking a CRC only helps if this walk sees every entry fflate extracts. A central directory
 * with two entries under one name, where fflate keeps the last, has to reach the duplicate check
 * below. So this returns null unless it walks exactly the entries fflate walks: it takes its
 * count and offset from the same fields fflate does, the classic end record's two counts agree,
 * and the walk ends where the central directory does. A zip64 archive with a locator still
 * imports when it walks cleanly, whether or not its classic fields carry 0xffff markers.
 */
function readDirectory(
	bytes: Uint8Array,
): { checksums: Map<string, number>; unpackedBytes: number } | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const EOCD = 0x06054b50;
	const CENTRAL = 0x02014b50;

	let end = bytes.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== EOCD) end -= 1;

	// The end record, comment included, has to finish exactly where the file does. fflate scans
	// back past trailing bytes and ignores them, so without this, junk appended to an archive would
	// go unnoticed.
	if (end < 0 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) return null;

	// fflate reads the this-disk count at +8. +10 is the total across disks, and a single-disk
	// archive holds the same number in both. Walking one count while fflate walks the other is how
	// a CRC-forged duplicate name slipped past the checks here, so a mismatch is refused outright.
	let count = view.getUint16(end + 8, true);

	if (view.getUint16(end + 10, true) !== count) return null;

	let offset = view.getUint32(end + 16, true);
	let directoryEnd = end;
	let zip64 = false;

	// Where a locator (the 20 bytes before the classic end record) points at a zip64 end record,
	// fflate takes the count and offset from that record instead, reading the same low 32 bits
	// read here. Mirrored so both walk one span, which then ends where the zip64 record begins.
	const ZIP64_LOCATOR = 0x07064b50;
	const ZIP64_END = 0x06064b50;

	if (end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR) {
		const zip64End = view.getUint32(end - 12, true);

		if (zip64End + 4 <= bytes.length && view.getUint32(zip64End, true) === ZIP64_END) {
			// fflate trusts this record from its signature alone, so one too short to hold its
			// fields can't be mirrored and is refused.
			if (zip64End + 56 > end - 20) return null;

			count = view.getUint32(zip64End + 32, true);
			offset = view.getUint32(zip64End + 48, true);
			directoryEnd = zip64End;
			zip64 = true;
		}
	}

	const checksums = new Map<string, number>();
	let unpackedBytes = 0;

	for (let i = 0; i < count; i += 1) {
		if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== CENTRAL) return null;

		const flags = view.getUint16(offset + 8, true);
		const crc = view.getUint32(offset + 16, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const nameEnd = offset + 46 + nameLength;

		if (nameEnd > directoryEnd) return null;

		const name = strFromU8(bytes.subarray(offset + 46, nameEnd), !(flags & 0x800));

		if (checksums.has(name)) return null;

		const size = declaredSize(bytes, offset, nameEnd, extraLength, zip64);

		if (size === null) return null;

		checksums.set(name, crc);
		unpackedBytes += size;
		offset = nameEnd + extraLength + commentLength;
	}

	// Stopping short means central entries this walk never saw, and fflate may have extracted them.
	if (offset !== directoryEnd) return null;

	return { checksums, unpackedBytes };
}

/**
 * The uncompressed size fflate's `z64hs` reads for one central entry, which is the size it
 * allocates. In a zip64 archive, a 0xffffffff in any of the three 32-bit fields sends it to the
 * zip64 extra field (id 1), with the size first there when its own field is the marked one.
 * fflate walks the extra fields and reads the 8 bytes with no bounds checks, and a byte past the
 * end of the file reads as 0, so this does too. Where fflate finds no zip64 field it throws, so
 * this returns null and the archive is refused as damaged.
 */
function declaredSize(
	bytes: Uint8Array,
	entry: number,
	extraStart: number,
	extraLength: number,
	zip64: boolean,
): number | null {
	const byteAt = (at: number) => bytes[at] ?? 0;
	const u16 = (at: number) => byteAt(at) | (byteAt(at + 1) << 8);
	const u32 = (at: number) => (u16(at) | (u16(at + 2) << 16)) >>> 0;
	const MARKER = 0xffffffff;

	const size = u32(entry + 24);
	const marked = size === MARKER || u32(entry + 20) === MARKER || u32(entry + 42) === MARKER;

	if (!zip64 || !marked) return size;

	const extraEnd = extraStart + extraLength;

	for (let field = extraStart; field + 4 < extraEnd; field += 4 + u16(field + 2)) {
		if (u16(field) === 1) {
			return size === MARKER ? u32(field + 4) + u32(field + 8) * 2 ** 32 : size;
		}
	}

	return null;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n += 1) {
			let c = n;
			for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}

	let crc = 0xffffffff;
	for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);

	return (crc ^ 0xffffffff) >>> 0;
}
