import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, FIRST_REVISION } from '../../core/brand-record';
import { createInMemoryRecordStore } from '../storage/in-memory-record-store';

import { DEMO_FIXTURES } from './demo-fixtures';
import { openDemoRecord } from './open-demo-record';

function fixture(slug: string): unknown {
	return JSON.parse(readFileSync(new URL(`./fixtures/${slug}.json`, import.meta.url), 'utf-8'));
}

const WINDOW = BrandRecordSchema.parse(fixture('photo-window'));

describe('openDemoRecord', () => {
	it('stores the fixture under a fresh id, at the first revision, with its images and versions intact', async () => {
		const store = createInMemoryRecordStore();
		const id = await openDemoRecord(store, fixture('photo-window'), 'Window photo (demo)');
		const stored = await store.get(id);

		expect(id).not.toBe(WINDOW.id);
		expect(stored?.revision).toBe(FIRST_REVISION);
		expect(stored?.images).toEqual(WINDOW.images);
		expect(stored?.versions).toEqual(WINDOW.versions);
		expect(stored?.name).toBe('Window photo (demo)');
		expect(await store.get(WINDOW.id)).toBeNull();
	});

	it('opens one fixture twice as two records', async () => {
		const store = createInMemoryRecordStore();
		const first = await openDemoRecord(store, fixture('photo-window'), 'Window photo (demo)');
		const second = await openDemoRecord(store, fixture('photo-window'), 'Window photo (demo)');

		expect(second).not.toBe(first);
		const ids = (await store.list()).map((record) => record.id);

		expect(ids).toHaveLength(2);
		expect(new Set(ids)).toEqual(new Set([first, second]));
	});

	// #122: a demo reopened after its record was deleted must not bring that id back.
	it('never recreates a deleted demo record’s id', async () => {
		const store = createInMemoryRecordStore();
		const deleted = await openDemoRecord(store, fixture('photo-window'), 'Window photo (demo)');

		await store.delete(deleted);

		const reopened = await openDemoRecord(store, fixture('photo-window'), 'Window photo (demo)');

		expect(reopened).not.toBe(deleted);
		expect(await store.get(deleted)).toBeNull();
	});

	// `put` refuses an insert carrying an incarnation (#39). A fixture regenerated from a stored
	// record would carry one, and the demo must still open.
	it('drops an incarnation the fixture carries, so storage takes it as a new record', async () => {
		const store = createInMemoryRecordStore();
		const carried = crypto.randomUUID();
		const id = await openDemoRecord(
			store,
			{ ...WINDOW, incarnation: carried },
			'Window photo (demo)',
		);

		expect((await store.get(id))?.incarnation).not.toBe(carried);
	});

	it('keeps a name the fixture already carries', async () => {
		const store = createInMemoryRecordStore();
		const id = await openDemoRecord(store, { ...WINDOW, name: 'Kept' }, 'Window photo (demo)');

		expect((await store.get(id))?.name).toBe('Kept');
	});

	it('refuses a body that isn’t a brand record and writes nothing', async () => {
		const store = createInMemoryRecordStore();

		await expect(openDemoRecord(store, { not: 'a record' }, 'x')).rejects.toThrow(
			/brand|invalid|expected|required/i,
		);
		expect(await store.list()).toEqual([]);
	});

	it.each(DEMO_FIXTURES)('opens the committed $slug fixture', async ({ slug, label }) => {
		const store = createInMemoryRecordStore();
		const id = await openDemoRecord(store, fixture(slug), label);

		expect((await store.get(id))?.versions).toEqual(
			BrandRecordSchema.parse(fixture(slug)).versions,
		);
	});
});
