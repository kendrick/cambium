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
	it('writes record.json plus one images/<id>.<ext> entry per image, and nothing else', () => {
		const entries = unzipSync(serializeRecord(record));

		// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh.
		// oxlint-disable-next-line unicorn/no-array-sort
		expect(Object.keys(entries).sort()).toEqual([
			'images/img-1.webp',
			'images/img-2.png',
			'record.json',
		]);
	});

	it('stores each image as the bytes its data URL decodes to', () => {
		const entries = unzipSync(serializeRecord(record));

		expect(entries['images/img-1.webp']).toEqual(WEBP_BYTES);
		expect(entries['images/img-2.png']).toEqual(PNG_BYTES);
	});

	it('writes record.json with each image pointing at its archive path', () => {
		const json = JSON.parse(strFromU8(unzipSync(serializeRecord(record))['record.json']!));

		expect(json.images.map((image: { downscaled: string }) => image.downscaled)).toEqual([
			'images/img-1.webp',
			'images/img-2.png',
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

	it('restores an image id that would not be a safe path on its own', () => {
		const awkward = {
			...record,
			images: [{ ...record.images[0]!, id: '../a\\b/..' }],
			versions: [],
		};
		const result = deserializeRecord(serializeRecord(awkward));

		if (!result.ok) throw new Error(result.error.message);

		expect(result.record).toEqual(awkward);
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
			const error = refusal(flipByte(bytes, dataOffset(bytes, 'images/img-1.webp') + 3));

			expect(error.kind).toBe('not-an-archive');

			expect(error.message).toContain('images/img-1.webp');
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

		it.each(['../x', '/etc/x', 'images\\x.webp', 'images/../../x.webp'])(
			'an entry named %s as unsafe-path',
			(name) => {
				const bytes = rezip(serializeRecord(record), (entries) => {
					entries[name] = strToU8('x');
				});
				const error = refusal(bytes);

				expect(error.kind).toBe('unsafe-path');

				expect(error.message).toContain(name);
			},
		);

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

		it('a record naming an image the archive lacks as missing-image', () => {
			const bytes = rezip(serializeRecord(record), (entries) => {
				delete entries['images/img-2.png'];
			});
			const error = refusal(bytes);

			expect(error.kind).toBe('missing-image');

			expect(error.message).toContain('images/img-2.png');
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
 * `core/purity.test.ts` guards the modules in its table and discovers nothing new, and this wave
 * leaves that file alone, so this module's guard lives here.
 */
describe('record-archive purity', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('round-trips with no browser global and fetch stubbed to throw', () => {
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');

		vi.stubGlobal('fetch', () => {
			throw new Error('record-archive reached for the network');
		});

		const result = deserializeRecord(serializeRecord(record));

		expect(result.ok).toBe(true);
	});
});
