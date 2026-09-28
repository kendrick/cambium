import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import { type BrandRecord, BrandRecordSchema } from './brand-record';

/**
 * A brand record as a zip: `record.json` plus `images/<id>.<ext>` for each reference image, with
 * each image's `downscaled` in `record.json` holding that path instead of the data URL. Images go
 * in as decoded bytes, which saves the third that base64 adds.
 *
 * Everything here runs on `Uint8Array`, so the browser can build and read an archive with no
 * server, and the headless CLI can too.
 */

export type ArchiveErrorKind =
	| 'not-an-archive'
	| 'missing-record'
	| 'unsafe-path'
	| 'missing-image'
	| 'invalid-record';

export type ArchiveError = { kind: ArchiveErrorKind; message: string };

export type DeserializeResult =
	| { ok: true; record: BrandRecord }
	| { ok: false; error: ArchiveError };

const RECORD_ENTRY = 'record.json';

/** The three types `lib/image-intake.ts` accepts, which is every type a stored image can be. */
const EXTENSION_FOR: Record<string, string> = {
	'image/webp': 'webp',
	'image/png': 'png',
	'image/jpeg': 'jpeg',
};
// A Map so an extension like `toString` can't resolve to something on Object.prototype.
const MEDIA_TYPE_FOR = new Map(
	Object.entries(EXTENSION_FOR).map(([mediaType, extension]) => [extension, mediaType]),
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

	const images = record.images.map((image) => {
		const decoded = decodeDataUrl(image.downscaled);

		if (!decoded) {
			throw new Error(
				`image "${image.id}" is not stored as a base64 PNG, JPEG or WebP data URL, so it cannot be archived`,
			);
		}

		// Encoded because the schema lets an id be any non-empty string, and one holding `/` or
		// `..` would otherwise name a path deserializeRecord rightly refuses.
		const path = `images/${encodeURIComponent(image.id)}.${decoded.extension}`;
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
 * Integrity first, then paths, then content. A damaged archive is reported as damaged whatever it
 * claims to contain, and every entry name is checked before anything is parsed out of
 * `record.json`, so a hostile name is refused in an archive that is otherwise well formed.
 */
export function deserializeRecord(bytes: Uint8Array): DeserializeResult {
	let entries: Record<string, Uint8Array>;

	try {
		entries = unzipSync(bytes);
	} catch {
		return fail('not-an-archive', 'This file is not a zip archive, or it is cut short.');
	}

	const checksums = readChecksums(bytes);

	if (!checksums || checksums.size !== Object.keys(entries).length) {
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

	for (const name of Object.keys(entries)) {
		if (!isSafePath(name)) {
			return fail(
				'unsafe-path',
				`This archive holds an entry named "${name}", which points outside the archive, so it was not opened.`,
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
 * Checked per segment rather than by substring, so an encoded id like `...webp` stays legal while
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

	const sorted: Record<string, unknown> = {};
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
	const extension = match ? EXTENSION_FOR[match[1]!] : undefined;

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
 * the central directory so `deserializeRecord` can check it. Names decode the way fflate's own
 * reader does, UTF-8 when general-purpose bit 11 is set and Latin-1 otherwise, so the two agree on
 * every key. Returns null for anything it can't walk cleanly, zip64 included, since this module
 * never writes an archive large enough to need it.
 */
function readChecksums(bytes: Uint8Array): Map<string, number> | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const EOCD = 0x06054b50;
	const CENTRAL = 0x02014b50;

	let end = bytes.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== EOCD) end -= 1;

	// The end record, comment included, has to finish exactly where the file does. fflate scans
	// back past trailing bytes and ignores them, so without this, junk appended to an archive would
	// go unnoticed.
	if (end < 0 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) return null;

	const count = view.getUint16(end + 10, true);
	let offset = view.getUint32(end + 16, true);
	const checksums = new Map<string, number>();

	if (count === 0xffff || offset === 0xffffffff) return null;

	for (let i = 0; i < count; i += 1) {
		if (offset + 46 > end || view.getUint32(offset, true) !== CENTRAL) return null;

		const flags = view.getUint16(offset + 8, true);
		const crc = view.getUint32(offset + 16, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const nameEnd = offset + 46 + nameLength;

		if (nameEnd > end) return null;

		const name = strFromU8(bytes.subarray(offset + 46, nameEnd), !(flags & 0x800));

		if (checksums.has(name)) return null;

		checksums.set(name, crc);
		offset = nameEnd + extraLength + commentLength;
	}

	return checksums;
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
