import { describe, expect, it } from 'vitest';

import {
	StorageQuotaExceededError,
	estimateStorageUsage,
	requestPersistentStorage,
	toStorageWriteError,
} from './storage-estimate';

function stubStorageManager(estimate: StorageEstimate): StorageManager {
	return { estimate: async () => estimate } as StorageManager;
}

describe('estimateStorageUsage', () => {
	it('reports what the browser estimates, in bytes', async () => {
		const storage = stubStorageManager({ usage: 12_345, quota: 2_000_000_000 });

		expect(await estimateStorageUsage(storage)).toEqual({
			usedBytes: 12_345,
			quotaBytes: 2_000_000_000,
		});
	});

	// Safari did not ship `estimate()` until 17, and `fake-indexeddb` fakes the IndexedDB globals
	// alone, so the missing-API path is the one Cambium's own tests run in.
	it('resolves null where the Storage API is unavailable', async () => {
		expect(await estimateStorageUsage(undefined)).toBeNull();
		expect(await estimateStorageUsage({} as StorageManager)).toBeNull();
	});

	it('resolves null when the browser answers with no figures', async () => {
		expect(await estimateStorageUsage(stubStorageManager({}))).toBeNull();
	});

	// Covers the default parameter rather than an injected stub. Node defines `navigator` and gives
	// it no `storage`, which is the same shape a browser too old for the API presents, so the
	// no-argument call every caller will actually write has to resolve here rather than throw.
	it('resolves null when nothing is injected and the platform has no Storage API', async () => {
		expect(await estimateStorageUsage()).toBeNull();
	});
});

describe('requestPersistentStorage', () => {
	it('reports a granted origin', async () => {
		const storage = { persist: async () => true } as StorageManager;

		expect(await requestPersistentStorage(storage)).toBe(true);
	});

	// A decline is not a failure. Chrome grants persistence on engagement heuristics, so the same
	// request can be worth making again once the user has more history with the site.
	it('reports a refusal as a refusal rather than an error', async () => {
		const storage = { persist: async () => false } as StorageManager;

		expect(await requestPersistentStorage(storage)).toBe(false);
	});

	it('resolves null where the Storage API is unavailable', async () => {
		expect(await requestPersistentStorage(undefined)).toBeNull();
		expect(await requestPersistentStorage({} as StorageManager)).toBeNull();
	});

	it('resolves null when nothing is injected and the platform has no Storage API', async () => {
		expect(await requestPersistentStorage()).toBeNull();
	});
});

/**
 * Tested here rather than against a full database, because `fake-indexeddb` enforces no quota, so
 * no write in it ever runs out of room. The mapping is the part a caller depends on either way.
 */
describe('toStorageWriteError', () => {
	it('types a quota failure so a caller can branch on it', () => {
		const cause = new DOMException('out of room', 'QuotaExceededError');

		const mapped = toStorageWriteError(cause);

		expect(mapped).toBeInstanceOf(StorageQuotaExceededError);
		expect(mapped).toMatchObject({ kind: 'storage-quota-exceeded', cause });
	});

	// The platform is moving quota failures off DOMException and onto a `QuotaExceededError` class
	// of their own. Both shapes carry the same name, which is why the name is what the mapping reads.
	it('types a quota failure that is not a DOMException', () => {
		const cause = Object.assign(new Error('out of room'), { name: 'QuotaExceededError' });

		expect(toStorageWriteError(cause)).toBeInstanceOf(StorageQuotaExceededError);
	});

	// An abort means the browser killed the transaction mid-flight, which iOS does when it suspends a
	// page. It reaches the caller as it arrived, because it is a lost write while the origin still
	// has room.
	it('passes anything else through unchanged', () => {
		const cause = new DOMException('transaction aborted', 'AbortError');

		expect(toStorageWriteError(cause)).toBe(cause);
	});
});
