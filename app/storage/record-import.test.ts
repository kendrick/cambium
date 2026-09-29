import { crc32 } from 'node:zlib';

import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import {
	type BrandRecord,
	type BrandVersion,
	FIRST_REVISION,
	SCHEMA_VERSION,
} from '../../core/brand-record';
import { type ArchiveErrorKind, serializeRecord } from '../../core/record-archive';

import { createInMemoryRecordStore } from './in-memory-record-store';
import { importRecordArchive } from './record-import';
import type { RecordStore } from './record-store';

const IMAGE_ID = 'img-1';
const IMAGE_DATA_URL = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

function makeVersion(overrides: Partial<BrandVersion> = {}): BrandVersion {
	return {
		createdAt: '2026-01-01T00:00:00.000Z',
		ordinal: 1,
		seed: null,
		tokenSet: null,
		provider: 'anthropic',
		model: 'claude-opus-5',
		promptVersion: 'seed-v4',
		rawResponse: null,
		scaleEngine: 'cambium-oklch-1',
		fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		interpretation: 'balanced',
		overrides: [],
		pins: [],
		...overrides,
	};
}

function makeRecord(overrides: Partial<BrandRecord> = {}): BrandRecord {
	return {
		id: crypto.randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl: 'acme.com',
		images: [{ id: IMAGE_ID, downscaled: IMAGE_DATA_URL, originalHash: 'sha256:abc', tag: 'auto' }],
		versions: [makeVersion()],
		...overrides,
	};
}

/**
 * A store whose `put` is a spy over a real in-memory store, so a test can assert `put` was never
 * called against actual write behaviour rather than against a store double that only records calls.
 */
function spyStore(): { store: RecordStore; put: ReturnType<typeof vi.fn> } {
	const real = createInMemoryRecordStore();
	const put = vi.fn<RecordStore['put']>(real.put);

	return { store: { ...real, put }, put };
}

/** Unzips, lets `change` rewrite the entries, and zips them back up. */
function rezip(
	bytes: Uint8Array,
	change: (entries: Record<string, Uint8Array>) => void,
): Uint8Array {
	const entries = unzipSync(bytes);
	change(entries);
	return zipSync(entries);
}

const validBytes = serializeRecord(makeRecord());

/**
 * The red-team archive from #20, rebuilt here so this test doesn't lean on a scratch script: a
 * second central entry for the image, placed last so fflate keeps it, holding different bytes
 * with the original's CRC, and an end record whose total count at +10 stops one entry short.
 * `core/record-archive.test.ts` builds the same shape to test `deserializeRecord` directly.
 */
function twinArchive(): { bytes: Uint8Array; twin: Uint8Array } {
	const table = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
		return c >>> 0;
	});
	const original = unzipSync(validBytes);
	const image = original['images/0.webp']!;
	const prefix = strToU8('EVIL-TWIN');

	// Four appended bytes steer the CRC register onto the original image's CRC.
	const indices: number[] = [];
	let t = (crc32(image) ^ 0xffffffff) >>> 0;
	for (let i = 0; i < 4; i += 1) {
		const j = table.findIndex((entry) => entry >>> 24 === t >>> 24);
		indices.unshift(j);
		t = ((t ^ table[j]!) << 8) >>> 0;
	}
	let register = (crc32(prefix) ^ 0xffffffff) >>> 0;
	const twin = Uint8Array.from([
		...prefix,
		...indices.map((j) => {
			const byte = (register ^ j) & 0xff;
			register = ((register >>> 8) ^ table[j]!) >>> 0;
			return byte;
		}),
	]);

	const decoy = 'images/0.webX';
	const zipped = zipSync(
		{
			['images/0.webp']: image,
			'record.json': original['record.json']!,
			[decoy]: twin,
		},
		{ level: 0 },
	);

	const from = strToU8(decoy);
	const to = strToU8('images/0.webp');
	for (let i = 0; i + from.length <= zipped.length; i += 1) {
		if (from.every((byte, j) => zipped[i + j] === byte)) zipped.set(to, i);
	}

	const view = new DataView(zipped.buffer, zipped.byteOffset, zipped.byteLength);
	const end = zipped.length - 22;
	view.setUint16(end + 10, view.getUint16(end + 8, true) - 1, true);

	return { bytes: zipped, twin };
}

/**
 * `validBytes` with record.json's central header declaring 0xffffffff uncompressed bytes. The
 * archive has no zip64 locator, so that's a literal 4 GiB, well past the cap.
 */
function oversizedArchive(): Uint8Array {
	const bytes = validBytes.slice();
	const view = new DataView(bytes.buffer);
	const name = strToU8('record.json');
	const central = 0x02014b50;

	for (let at = 0; at + 46 <= bytes.length; at += 1) {
		const named = name.every((byte, j) => bytes[at + 46 + j] === byte);

		if (view.getUint32(at, true) === central && named) {
			view.setUint32(at + 24, 0xffffffff, true);
			return bytes;
		}
	}

	throw new Error('no central header for record.json');
}

/**
 * One archive per `ArchiveError` kind `deserializeRecord` can return, exercised here only to prove
 * `importRecordArchive` calls `put` zero times on each — the kinds themselves, and the message each
 * one carries, are `core/record-archive.test.ts`'s job.
 */
const FAILURE_ARCHIVES: Record<ArchiveErrorKind, Uint8Array> = {
	'not-an-archive': strToU8('this is not a zip archive'),
	'too-large': oversizedArchive(),
	'missing-record': rezip(validBytes, (entries) => {
		delete entries['record.json'];
	}),
	'unsafe-path': rezip(validBytes, (entries) => {
		entries['../escape'] = strToU8('x');
	}),
	'missing-image': rezip(validBytes, (entries) => {
		delete entries['images/0.webp'];
	}),
	'invalid-record': rezip(validBytes, (entries) => {
		entries['record.json'] = strToU8('{ not json');
	}),
};

describe('importRecordArchive', () => {
	it('writes one record under a fresh id at FIRST_REVISION and leaves the original id untouched', async () => {
		const { store, put } = spyStore();
		const inserted = await store.put(makeRecord());
		// A second commit moves the source past FIRST_REVISION, so the archive carries a revision
		// that import has to reset.
		const original = await store.put({ ...inserted, brandUrl: 'acme.org' });

		expect(original.revision).toBeGreaterThan(FIRST_REVISION);

		put.mockClear();

		const bytes = serializeRecord(original);
		const result = await importRecordArchive(
			store,
			bytes,
			() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		);

		if (!result.ok) throw new Error(result.error.message);

		expect(result.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
		expect(result.id).not.toBe(original.id);
		expect(put).toHaveBeenCalledTimes(1);
		// Asserted on what `put` received, because `nextCommit` stamps FIRST_REVISION over any insert
		// anyway, so the stored record alone can't show whether import reset the revision.
		expect(put.mock.calls[0]![0].revision).toBe(FIRST_REVISION);

		expect(await store.get(original.id)).toEqual(original);

		const imported = await store.get(result.id);
		const {
			id: _droppedId,
			revision: _importedRevision,
			incarnation: _importedIncarnation,
			...importedRest
		} = imported!;
		const {
			id: _droppedOriginalId,
			revision: _originalRevision,
			incarnation: _originalIncarnation,
			...originalRest
		} = original;

		expect(imported!.revision).toBe(FIRST_REVISION);
		expect(importedRest).toEqual(originalRest);
	});

	it('round-trips export, delete, import to an equal record apart from id, revision and incarnation', async () => {
		const store = createInMemoryRecordStore();
		const original = await store.put(makeRecord());
		const bytes = serializeRecord(original);

		await store.delete(original.id);

		const result = await importRecordArchive(store, bytes);

		if (!result.ok) throw new Error(result.error.message);

		const imported = await store.get(result.id);
		const {
			id: _droppedId,
			revision: _droppedRevision,
			incarnation: _droppedIncarnation,
			...importedRest
		} = imported!;
		const {
			id: _droppedOriginalId,
			revision: _droppedOriginalRevision,
			incarnation: _droppedOriginalIncarnation,
			...originalRest
		} = original;

		expect(importedRest).toEqual(originalRest);
	});

	// The archive's incarnation names the record it was exported from. Import makes a new record, so
	// storage has to mint it a new one, and the name the person gave it comes along.
	it('imports under a fresh incarnation and keeps the record name', async () => {
		const store = createInMemoryRecordStore();
		const exported = await store.put(makeRecord({ name: 'Acme Coffee' }));
		const freshId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

		const result = await importRecordArchive(store, serializeRecord(exported), () => freshId);
		if (!result.ok) throw new Error(result.error.message);

		const imported = await store.get(freshId);
		expect(imported?.name).toBe('Acme Coffee');
		expect(imported?.incarnation).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(imported?.incarnation).not.toBe(exported.incarnation);
	});

	it('gives two records when the same archive is imported twice', async () => {
		const store = createInMemoryRecordStore();

		const first = await importRecordArchive(store, validBytes);
		const second = await importRecordArchive(store, validBytes);

		if (!first.ok) throw new Error(first.error.message);
		if (!second.ok) throw new Error(second.error.message);

		expect(first.id).not.toBe(second.id);

		const all = await store.list();
		// `list` makes no ordering promise, so the ids are compared as a set. `toSorted` is ES2023 and
		// tsconfig targets ES2022, and both arrays are fresh.
		// oxlint-disable-next-line unicorn/no-array-sort
		expect(all.map((record) => record.id).sort()).toEqual([first.id, second.id].sort());
	});

	it('refuses a CRC-forged duplicate image entry and calls put zero times', async () => {
		const { bytes, twin } = twinArchive();

		// fflate alone would hand back the twin, whose CRC matches the image it replaces.
		expect(unzipSync(bytes)['images/0.webp']).toEqual(twin);
		expect(crc32(twin)).toBe(crc32(unzipSync(validBytes)['images/0.webp']!));

		const { store, put } = spyStore();
		const result = await importRecordArchive(store, bytes);

		expect(result).toMatchObject({ ok: false, error: { kind: 'not-an-archive' } });
		expect(put).not.toHaveBeenCalled();
	});

	it.each(Object.entries(FAILURE_ARCHIVES) as [ArchiveErrorKind, Uint8Array][])(
		'returns the archive error and calls put zero times for a %s archive',
		async (kind, bytes) => {
			const { store, put } = spyStore();
			const result = await importRecordArchive(store, bytes);

			expect(result.ok).toBe(false);
			if (result.ok) return;

			expect(result.error.kind).toBe(kind);
			expect(put).not.toHaveBeenCalled();
		},
	);
});
