import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32 } from 'node:zlib';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BrandRecord, BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { type BrandSeed, BrandSeedSchema } from './brand-seed';
import { withContrastRepairs } from './contrast/repair';
import { serializeDtcg } from './dtcg/serialize';
import { BALANCED } from './interpretation';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { deserializeRecord, serializeRecord } from './record-archive';
import { repairPinsFor, type SeedPinPath } from './seed-pins';
import { buildTokenSet } from './semantic-layer';
import { applyOverrides, type TokenOverride } from './token-overrides';

const WEBP_BYTES = Uint8Array.from(
	atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='),
	(char) => char.charCodeAt(0),
);
// The PNG signature plus a byte, so the payload is non-trivial and its base64 is canonical.
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2a]);

function dataUrl(mediaType: string, bytes: Uint8Array): string {
	return `data:${mediaType};base64,${btoa(String.fromCharCode(...bytes))}`;
}

const seed = BrandSeedSchema.parse({
	keyColors: [
		{
			oklch: [0.6231, 0.188, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: [{ imageId: 'img-2', detected: 'logo' }],
	expressive: null,
});

/**
 * The derivation `app/state/workspace-store.ts` runs for a version: engine, `buildTokenSet`,
 * `withContrastRepairs` with the version's pins, then its overrides. `PRESET_PARAMS` there is
 * private and maps every preset to `BALANCED`, so this uses `BALANCED` directly. The result goes
 * through `serializeDtcg`, because the DTCG documents are what an export consumer actually reads.
 */
function resolve(versionSeed: BrandSeed, pins: SeedPinPath[], overrides: TokenOverride[]) {
	const generated = createOklchScaleEngine().generate(versionSeed, BALANCED);

	if (!generated.ok) throw new Error(`the scale engine rejected the seed: ${generated.error.kind}`);

	const base = buildTokenSet(generated.schemes, versionSeed, BALANCED);
	const { tokenSet: repaired } = withContrastRepairs(base, {
		pinned: repairPinsFor(versionSeed, pins),
	});
	const applied = applyOverrides(repaired, overrides);

	if (!applied.ok) throw new Error(`an override did not apply: ${applied.key}`);

	return applied.tokenSet;
}

const edit: TokenOverride = { kind: 'value', category: 'radius', path: ['lg', 'value'], value: 3 };

// The first version's tokens are built without the edit and the second's with it, so a restored
// history that dropped `overrides` or swapped versions would resolve to different values.
const record: BrandRecord = BrandRecordSchema.parse({
	id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
	schemaVersion: SCHEMA_VERSION,
	revision: 4,
	brandUrl: 'acme.com',
	images: [
		{
			id: 'img-1',
			downscaled: dataUrl('image/webp', WEBP_BYTES),
			originalHash: 'sha256:abc',
			tag: 'auto',
		},
		{
			id: 'img-2',
			downscaled: dataUrl('image/png', PNG_BYTES),
			originalHash: 'sha256:def',
			tag: 'logo',
		},
	],
	versions: [
		{
			createdAt: '2026-09-16T12:00:00.000Z',
			ordinal: 1,
			seed,
			tokenSet: resolve(seed, [], []),
			provider: 'anthropic',
			model: 'claude-opus-5',
			promptVersion: 'seed-v4',
			rawResponse: '{"keyColors":[{"proposedRole":"brand"}]}',
			scaleEngine: 'cambium-oklch-1',
			fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
			interpretation: 'balanced',
			overrides: [],
			pins: [],
		},
		{
			createdAt: '2026-09-17T08:30:00.000Z',
			ordinal: 2,
			seed,
			tokenSet: resolve(seed, ['keyColors.0'], [edit]),
			provider: 'openai',
			model: 'gpt-6-luna',
			promptVersion: 'seed-v4',
			rawResponse: null,
			scaleEngine: 'cambium-oklch-1',
			fontTable: { source: 'google-fonts', version: '2026-09-01' },
			interpretation: 'expressive',
			overrides: [edit],
			pins: ['keyColors.0'],
		},
	],
});

/** Unzips, lets `change` rewrite the entries, and zips them back with valid checksums. */
function rezip(bytes: Uint8Array, change: (entries: Record<string, Uint8Array>) => void) {
	const entries = unzipSync(bytes);
	change(entries);
	return zipSync(entries);
}

function editRecordJson(bytes: Uint8Array, change: (json: Record<string, unknown>) => void) {
	return rezip(bytes, (entries) => {
		const json = JSON.parse(strFromU8(entries['record.json']!)) as Record<string, unknown>;
		change(json);
		entries['record.json'] = strToU8(JSON.stringify(json));
	});
}

/** Where an entry's stored bytes start, read from its local header rather than assumed. */
function dataOffset(archive: Uint8Array, name: string): number {
	const nameBytes = strToU8(name);

	for (let i = 30; i < archive.length; i += 1) {
		if (nameBytes.every((byte, j) => archive[i + j] === byte)) {
			const header = i - 30;
			const localSignature = 0x04034b50;
			const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

			if (view.getUint32(header, true) !== localSignature) continue;

			return i + nameBytes.length + view.getUint16(header + 28, true);
		}
	}

	throw new Error(`no local header for ${name}`);
}

/** Rewrites the end record's this-disk count (+8) and total count (+10). */
function setCounts(bytes: Uint8Array, thisDisk: number, total: number): Uint8Array {
	const copy = bytes.slice();
	const view = new DataView(copy.buffer);
	const end = copy.length - 22;
	view.setUint16(end + 8, thisDisk, true);
	view.setUint16(end + 10, total, true);
	return copy;
}

/** Rewrites every occurrence of one name's bytes, in local and central headers alike. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
	return c >>> 0;
});

/** Appends four bytes to `prefix` so the result's CRC-32 is `target`. */
function forgeCrc(prefix: Uint8Array, target: number): Uint8Array {
	const indices: number[] = [];
	let t = (target ^ 0xffffffff) >>> 0;

	for (let i = 0; i < 4; i += 1) {
		const j = CRC_TABLE.findIndex((entry) => entry >>> 24 === t >>> 24);
		indices.unshift(j);
		t = ((t ^ CRC_TABLE[j]!) << 8) >>> 0;
	}

	let register = (crc32(prefix) ^ 0xffffffff) >>> 0;
	const suffix = indices.map((j) => {
		const byte = (register ^ j) & 0xff;
		register = ((register >>> 8) ^ CRC_TABLE[j]!) >>> 0;
		return byte;
	});

	return Uint8Array.from([...prefix, ...suffix]);
}

/**
 * A second central entry named `images/1.png` whose different bytes carry the original's
 * CRC, placed last so fflate keeps it. The end record's total at +10 is one short of the this-disk
 * count at +8, so a walk that trusts +10 stops before the twin, sees three distinct names, and
 * agrees with fflate's three keys.
 */
function twinArchive(): { bytes: Uint8Array; twin: Uint8Array } {
	const original = unzipSync(serializeRecord(record));
	const png = original['images/1.png']!;
	const twin = forgeCrc(
		Uint8Array.from([...PNG_BYTES.subarray(0, 8), ...strToU8('EVIL-TWIN')]),
		crc32(png),
	);
	const zipped = zipSync(
		{
			'images/0.webp': original['images/0.webp']!,
			'images/1.png': png,
			'record.json': original['record.json']!,
			'images/1.pnX': twin,
		},
		{ level: 0 },
	);
	const bytes = renameEverywhere(zipped, 'images/1.pnX', 'images/1.png');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const end = bytes.length - 22;

	view.setUint16(end + 10, view.getUint16(end + 8, true) - 1, true);

	return { bytes, twin };
}

function renameEverywhere(archive: Uint8Array, from: string, to: string): Uint8Array {
	const source = strToU8(from);
	const target = strToU8(to);
	const copy = archive.slice();

	if (source.length !== target.length) throw new Error('names must be the same length');

	for (let i = 0; i + source.length <= copy.length; i += 1) {
		if (source.every((byte, j) => copy[i + j] === byte)) copy.set(target, i);
	}

	return copy;
}

function flipByte(archive: Uint8Array, offset: number): Uint8Array {
	const copy = archive.slice();
	copy[offset] = copy[offset]! ^ 0xff;
	return copy;
}

/** The error `deserializeRecord` refused with, after checking it carries a message to show. */
function refusal(bytes: Uint8Array) {
	const result = deserializeRecord(bytes);

	if (result.ok) throw new Error('expected the archive to be refused, got a record');

	expect(result.error.message.length).toBeGreaterThan(0);

	return result.error;
}

/** Rebuilds a value with every object's keys inserted in reverse order. */
function reverseKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(reverseKeys);
	if (value === null || typeof value !== 'object') return value;

	const entries = Object.entries(value).map(([key, inner]) => [key, reverseKeys(inner)]);

	// `toReversed` is ES2023 and tsconfig targets ES2022. The array is fresh.
	// oxlint-disable-next-line unicorn/no-array-reverse
	return Object.fromEntries(entries.reverse());
}

describe('serializeRecord', () => {
	it('writes record.json plus one images/<index>.<ext> entry per image, and nothing else', () => {
		const entries = unzipSync(serializeRecord(record));

		// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh.
		// oxlint-disable-next-line unicorn/no-array-sort
		expect(Object.keys(entries).sort()).toEqual(['images/0.webp', 'images/1.png', 'record.json']);
	});

	it('stores each image as the bytes its data URL decodes to', () => {
		const entries = unzipSync(serializeRecord(record));

		expect(entries['images/0.webp']).toEqual(WEBP_BYTES);
		expect(entries['images/1.png']).toEqual(PNG_BYTES);
	});

	it('writes record.json with each image pointing at its archive path', () => {
		const json = JSON.parse(strFromU8(unzipSync(serializeRecord(record))['record.json']!));

		expect(json.images.map((image: { downscaled: string }) => image.downscaled)).toEqual([
			'images/0.webp',
			'images/1.png',
		]);
		expect(json.versions).toEqual(record.versions);
	});

	it('produces the same bytes for the same record twice', () => {
		expect(serializeRecord(record)).toEqual(serializeRecord(record));
	});

	it('produces the same bytes whatever order the record keys were inserted in', () => {
		const reordered = reverseKeys(record) as BrandRecord;

		expect(Object.keys(reordered)).not.toEqual(Object.keys(record));
		expect(serializeRecord(reordered)).toEqual(serializeRecord(record));
	});

	/**
	 * fflate stamps each entry's DOS time from the local-time fields of its `mtime`. A fixed UTC
	 * instant lands on a different local date in each zone, so bytes would depend on where the
	 * export ran, and west of UTC the 1980 epoch reads as 1979 and fflate throws outright.
	 */
	it('produces the same bytes in every time zone, including west of UTC', () => {
		const original = process.env.TZ;

		try {
			process.env.TZ = 'America/Los_Angeles';
			const west = serializeRecord(record);
			process.env.TZ = 'Asia/Tokyo';
			const east = serializeRecord(record);

			expect(west).toEqual(east);
		} finally {
			process.env.TZ = original;
		}
	});

	it('refuses an image whose downscaled value is not a base64 PNG, JPEG or WebP data URL', () => {
		const gif = {
			...record,
			images: [{ ...record.images[0]!, downscaled: 'data:image/gif;base64,R0lG' }],
		};

		expect(() => serializeRecord(gif)).toThrow(/img-1/);
	});
});

describe('deserializeRecord', () => {
	it('round-trips a record, version history included', () => {
		const result = deserializeRecord(serializeRecord(record));

		if (!result.ok) throw new Error(result.error.message);

		expect(result.record).toEqual(record);
		expect(
			result.record.versions.map(({ provider, model, seed: versionSeed, pins, overrides }) => ({
				provider,
				model,
				seed: versionSeed,
				pins,
				overrides,
			})),
		).toEqual([
			{ provider: 'anthropic', model: 'claude-opus-5', seed, pins: [], overrides: [] },
			{ provider: 'openai', model: 'gpt-6-luna', seed, pins: ['keyColors.0'], overrides: [edit] },
		]);
	});

	/**
	 * Re-derives each restored version the way the workspace does and compares DTCG documents, since
	 * those are what a person sees and exports. Both also have to match the token set the version
	 * stored.
	 */
	it('restores inputs that re-derive to the same DTCG documents as the original', () => {
		const result = deserializeRecord(serializeRecord(record));

		if (!result.ok) throw new Error(result.error.message);

		const [first, second] = record.versions.map((version) =>
			serializeDtcg(resolve(version.seed!, version.pins, version.overrides)),
		);

		// The edit really moves a resolved value, so the comparison below can tell versions apart.
		expect(second).not.toEqual(first);

		result.record.versions.forEach((version, index) => {
			const restored = serializeDtcg(resolve(version.seed!, version.pins, version.overrides));
			const original = serializeDtcg(
				resolve(
					record.versions[index]!.seed!,
					record.versions[index]!.pins,
					record.versions[index]!.overrides,
				),
			);

			expect(restored).toEqual(original);
			expect(restored).toEqual(serializeDtcg(version.tokenSet!));
		});
	});

	it('skips an empty directory entry, the kind a re-zipping tool adds', () => {
		const bytes = rezip(serializeRecord(record), (entries) => {
			entries['images/'] = new Uint8Array(0);
		});

		expect(Object.keys(unzipSync(bytes))).toContain('images/');

		const result = deserializeRecord(bytes);

		if (!result.ok) throw new Error(result.error.message);

		expect(result.record).toEqual(record);
	});

	/**
	 * The real workflow: someone unpacks an export and zips the folder back up with Info-ZIP. That
	 * tool, not fflate, decides what the entries look like, so this runs it for real. Skipped where
	 * `zip` isn't installed; the fflate-built case above covers the directory entry either way.
	 */
	it.skipIf(spawnSync('zip', ['-v']).status !== 0)(
		'reads an archive unpacked and re-zipped with Info-ZIP zip -X -r',
		() => {
			const dir = mkdtempSync(join(tmpdir(), 'cambium-archive-'));

			try {
				for (const [name, contents] of Object.entries(unzipSync(serializeRecord(record)))) {
					mkdirSync(join(dir, dirname(name)), { recursive: true });
					writeFileSync(join(dir, name), contents);
				}

				const zipped = spawnSync(
					'zip',
					['-q', '-X', '-r', 'infozip.zip', 'record.json', 'images'],
					{
						cwd: dir,
					},
				);

				expect(zipped.status).toBe(0);

				const bytes = new Uint8Array(readFileSync(join(dir, 'infozip.zip')));

				// Pins that Info-ZIP really wrote the directory entry this test exists for.
				expect(Object.keys(unzipSync(bytes))).toContain('images/');

				const result = deserializeRecord(bytes);

				if (!result.ok) throw new Error(result.error.message);

				expect(result.record).toEqual(record);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	// Ids never reach an entry name. `../a\\b/..` would be an unsafe path, and a lone surrogate makes
	// `encodeURIComponent` throw, yet both are ids BrandRecordSchema accepts.
	it.each(['../a\\b/..', '\uD800'])('round-trips the image id %j', (id) => {
		const awkward = BrandRecordSchema.parse({
			...record,
			images: [{ ...record.images[0]!, id }],
			versions: [],
		});
		const result = deserializeRecord(serializeRecord(awkward));

		if (!result.ok) throw new Error(result.error.message);

		expect(result.record.images[0]!.id).toBe(id);
		expect(result.record).toEqual(awkward);
	});

	/**
	 * TokenExtensionsSchema passes foreign `$extensions` through untouched, so a vendor payload can
	 * carry `__proto__` as a plain data key. Built two ways, since a computed key and JSON.parse
	 * are the two ways such a key arrives as an own property.
	 */
	it('keeps an own __proto__ key inside a foreign $extensions payload', () => {
		const tokenSet = structuredClone(record.versions[0]!.tokenSet!);
		const extensions = tokenSet.schemes.light.primitives.brand![0]!.$extensions as Record<
			string,
			unknown
		>;
		extensions['com.example.parsed'] = JSON.parse('{"__proto__": {"kept": true}, "plain": 1}');
		extensions['com.example.computed'] = { ['__proto__']: { kept: true } };

		const withForeign = BrandRecordSchema.parse({
			...record,
			versions: [{ ...record.versions[0]!, tokenSet }],
		});
		const parsedExtensions = withForeign.versions[0]!.tokenSet!.schemes.light.primitives.brand![0]!
			.$extensions as Record<string, object>;

		// The premise: the key survives the schema, so anything that loses it is the archive's fault.
		expect(Object.hasOwn(parsedExtensions['com.example.parsed']!, '__proto__')).toBe(true);
		expect(Object.hasOwn(parsedExtensions['com.example.computed']!, '__proto__')).toBe(true);

		const result = deserializeRecord(serializeRecord(withForeign));

		if (!result.ok) throw new Error(result.error.message);

		const restored = result.record.versions[0]!.tokenSet!.schemes.light.primitives.brand![0]!
			.$extensions as Record<string, object>;

		for (const key of ['com.example.parsed', 'com.example.computed']) {
			expect(Object.hasOwn(restored[key]!, '__proto__')).toBe(true);
			expect(JSON.stringify(restored[key])).toBe(JSON.stringify(parsedExtensions[key]));
		}
		expect(JSON.stringify(restored['com.example.parsed'])).toBe(
			'{"__proto__":{"kept":true},"plain":1}',
		);
	});

	describe('refuses', () => {
		it('a truncated archive as not-an-archive', () => {
			const bytes = serializeRecord(record);

			expect(refusal(bytes.subarray(0, bytes.length - 20)).kind).toBe('not-an-archive');
		});

		it('a flipped byte inside record.json as not-an-archive', () => {
			const bytes = serializeRecord(record);

			expect(refusal(flipByte(bytes, dataOffset(bytes, 'record.json') + 10)).kind).toBe(
				'not-an-archive',
			);
		});

		// Images are stored uncompressed, so inflate has nothing to trip over here. Only the
		// checksum can tell this archive from a good one.
		it('a flipped byte inside a stored image as not-an-archive', () => {
			const bytes = serializeRecord(record);
			const error = refusal(flipByte(bytes, dataOffset(bytes, 'images/0.webp') + 3));

			expect(error.kind).toBe('not-an-archive');

			expect(error.message).toContain('images/0.webp');
		});

		// fflate reads both of these without complaint: a duplicate name keeps whichever entry came
		// last, and it scans back past trailing bytes to find the end record.
		it('a CRC-forged duplicate name hidden behind a short total-entries count as not-an-archive', () => {
			const { bytes, twin } = twinArchive();

			// The attack is real: fflate keeps the twin, whose bytes differ and whose CRC matches.
			expect(unzipSync(bytes)['images/1.png']).toEqual(twin);
			expect(twin).not.toEqual(PNG_BYTES);
			expect(crc32(twin)).toBe(crc32(PNG_BYTES));

			const error = refusal(bytes);

			expect(error.kind).toBe('not-an-archive');
			expect(error.message).toContain('table of contents');
		});

		// Nothing here is extracted differently, since fflate walks +8, but two counts that disagree
		// mean the end record can't be trusted.
		it('an end record whose total count disagrees with its this-disk count as not-an-archive', () => {
			const error = refusal(setCounts(serializeRecord(record), 3, 4));

			expect(error.kind).toBe('not-an-archive');
			expect(error.message).toContain('table of contents');
		});

		// fflate stops after the counted entries and never sees the fourth, so the archive is
		// refused for holding a central entry nobody checked.
		it('a central directory holding more entries than its end record counts as not-an-archive', () => {
			const withExtra = rezip(serializeRecord(record), (entries) => {
				entries['zz-uncounted'] = strToU8('x');
			});
			const error = refusal(setCounts(withExtra, 3, 3));

			expect(error.kind).toBe('not-an-archive');
			expect(error.message).toContain('table of contents');
		});

		it('an archive listing record.json twice as not-an-archive', () => {
			const withTwin = rezip(serializeRecord(record), (entries) => {
				entries['record.jsoX'] = strToU8('{}');
			});
			const error = refusal(renameEverywhere(withTwin, 'record.jsoX', 'record.json'));

			expect(error.kind).toBe('not-an-archive');
			expect(error.message).toContain('table of contents');
		});

		it('an archive with bytes after its end record as not-an-archive', () => {
			const bytes = serializeRecord(record);
			const padded = new Uint8Array(bytes.length + 3);
			padded.set(bytes);
			padded.set([1, 2, 3], bytes.length);
			const error = refusal(padded);

			expect(error.kind).toBe('not-an-archive');
			expect(error.message).toContain('table of contents');
		});

		// 0xffffffff is the zip64 marker for "offset lives in the zip64 record". fflate reads past it
		// without throwing when no zip64 locator is present.
		it('an archive whose end record carries the zip64 offset marker as not-an-archive', () => {
			const bytes = serializeRecord(record).slice();
			bytes.fill(0xff, bytes.length - 22 + 16, bytes.length - 22 + 20);
			const error = refusal(bytes);

			expect(error.kind).toBe('not-an-archive');
			expect(error.message).toContain('table of contents');
		});

		it('something that is not a zip as not-an-archive', () => {
			expect(refusal(strToU8('this is a brand, honest')).kind).toBe('not-an-archive');
		});

		it('an archive with no record.json as missing-record', () => {
			const bytes = rezip(serializeRecord(record), (entries) => {
				delete entries['record.json'];
			});

			expect(refusal(bytes).kind).toBe('missing-record');
		});

		it.each([
			['../x', 'x'],
			['/etc/x', 'x'],
			['images\\x.webp', 'x'],
			['images/../../x.webp', 'x'],
			['C:x', 'x'],
			['images//x', 'x'],
			['./x', 'x'],
			// Directory-shaped names that don't qualify as a harmless directory entry: one that holds
			// data, and empty ones whose path is unsafe before the trailing slash.
			['images/', 'x'],
			['../', ''],
			['images//', ''],
		])('an entry named %s holding %j as unsafe-path', (name, contents) => {
			const bytes = rezip(serializeRecord(record), (entries) => {
				entries[name] = strToU8(contents);
			});
			const error = refusal(bytes);

			expect(error.kind).toBe('unsafe-path');

			expect(error.message).toContain(name);
		});

		// The path check has to come before record.json is parsed, or a hostile entry would only
		// be noticed in archives that were otherwise well formed.
		it('an unsafe entry ahead of a record.json that would fail on its own', () => {
			const bytes = rezip(serializeRecord(record), (entries) => {
				entries['record.json'] = strToU8('{ not json');
				entries['../x'] = strToU8('x');
			});

			expect(refusal(bytes).kind).toBe('unsafe-path');
		});

		it('a record whose image points outside the archive as unsafe-path', () => {
			const bytes = editRecordJson(serializeRecord(record), (json) => {
				(json.images as { downscaled: string }[])[0]!.downscaled = '../img-1.webp';
			});

			expect(refusal(bytes).kind).toBe('unsafe-path');
		});

		it('an image stored under an extension it cannot be restored from as invalid-record', () => {
			const bytes = editRecordJson(
				rezip(serializeRecord(record), (entries) => {
					entries['images/0.gif'] = entries['images/0.webp']!;
					delete entries['images/0.webp'];
				}),
				(json) => {
					(json.images as { downscaled: string }[])[0]!.downscaled = 'images/0.gif';
				},
			);
			const error = refusal(bytes);

			expect(error.kind).toBe('invalid-record');
			expect(error.message).toContain('images/0.gif');
		});

		it('a record naming an image the archive lacks as missing-image', () => {
			const bytes = rezip(serializeRecord(record), (entries) => {
				delete entries['images/1.png'];
			});
			const error = refusal(bytes);

			expect(error.kind).toBe('missing-image');

			expect(error.message).toContain('images/1.png');
		});

		it(`a record stamped schema version ${SCHEMA_VERSION + 1} as invalid-record`, () => {
			const bytes = editRecordJson(serializeRecord(record), (json) => {
				json.schemaVersion = SCHEMA_VERSION + 1;
			});
			const error = refusal(bytes);

			expect(error.kind).toBe('invalid-record');

			expect(error.message).toContain('schemaVersion');
		});

		it('a record.json that is not JSON as invalid-record', () => {
			const bytes = rezip(serializeRecord(record), (entries) => {
				entries['record.json'] = strToU8('{ "id": ');
			});

			expect(refusal(bytes).kind).toBe('invalid-record');
		});
	});
});

/**
 * `core/purity.test.ts` guards only the modules in its table. This module's row there lands in a
 * follow-up PR, so until then this is its guard, with the same three checks the central suite runs.
 */
describe('record-archive purity', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('round-trips with no browser global and fetch stubbed to throw', () => {
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');
		expect(typeof localStorage).toBe('undefined');

		vi.stubGlobal('fetch', () => {
			throw new Error('record-archive reached for the network');
		});

		const result = deserializeRecord(serializeRecord(record));

		expect(result.ok).toBe(true);
	});
});
