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
 * One archive per `ArchiveError` kind `deserializeRecord` can return, exercised here only to prove
 * `importRecordArchive` calls `put` zero times on each — the kinds themselves, and the message each
 * one carries, are `core/record-archive.test.ts`'s job.
 */
const FAILURE_ARCHIVES: Record<ArchiveErrorKind, Uint8Array> = {
	'not-an-archive': strToU8('this is not a zip archive'),
	'missing-record': rezip(validBytes, (entries) => {
		delete entries['record.json'];
	}),
	'unsafe-path': rezip(validBytes, (entries) => {
		entries['../escape'] = strToU8('x');
	}),
	'missing-image': rezip(validBytes, (entries) => {
		delete entries[`images/${IMAGE_ID}.webp`];
	}),
	'invalid-record': rezip(validBytes, (entries) => {
		entries['record.json'] = strToU8('{ not json');
	}),
};

describe('importRecordArchive', () => {
	it('writes one record under a fresh id at FIRST_REVISION and leaves the original id untouched', async () => {
		const { store, put } = spyStore();
		const original = await store.put(makeRecord());

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

		expect(await store.get(original.id)).toEqual(original);

		const imported = await store.get(result.id);
		const { id: _droppedId, ...importedRest } = imported!;
		const { id: _droppedOriginalId, ...originalRest } = original;

		expect(imported!.revision).toBe(FIRST_REVISION);
		expect(importedRest).toEqual(originalRest);
	});

	it('round-trips export, delete, import to an equal record apart from id and revision', async () => {
		const store = createInMemoryRecordStore();
		const original = await store.put(makeRecord());
		const bytes = serializeRecord(original);

		await store.delete(original.id);

		const result = await importRecordArchive(store, bytes);

		if (!result.ok) throw new Error(result.error.message);

		const imported = await store.get(result.id);
		const { id: _droppedId, revision: _droppedRevision, ...importedRest } = imported!;
		const {
			id: _droppedOriginalId,
			revision: _droppedOriginalRevision,
			...originalRest
		} = original;

		expect(importedRest).toEqual(originalRest);
	});

	it('gives two records when the same archive is imported twice', async () => {
		const store = createInMemoryRecordStore();

		const first = await importRecordArchive(store, validBytes);
		const second = await importRecordArchive(store, validBytes);

		if (!first.ok) throw new Error(first.error.message);
		if (!second.ok) throw new Error(second.error.message);

		expect(first.id).not.toBe(second.id);

		const all = await store.list();
		// `list` makes no ordering promise, so the ids are compared as a set.
		// oxlint-disable-next-line unicorn/no-array-sort
		expect(all.map((record) => record.id).sort()).toEqual([first.id, second.id].sort());
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
