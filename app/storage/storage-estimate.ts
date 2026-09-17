/**
 * Usage, durability, and the quota failure sit beside `RecordStore` as exports rather than on it.
 * The interface describes moving records, and how much room the origin has left is a fact about
 * the browser rather than about any one store. An HTTP implementation could not answer it at all.
 */

/** Both numbers are bytes. The platform's own `usage` and `quota` name no unit. */
export type StorageUsage = {
	usedBytes: number;
	quotaBytes: number;
};

/**
 * The figure covers the whole origin rather than Cambium's records alone. IndexedDB, Cache
 * Storage, and the rest share one budget, and the platform reports the sum.
 *
 * Resolves null wherever the browser declines to answer. `estimate()` did not reach Safari until
 * 17, and it is absent under Node and under `fake-indexeddb`, which fakes the IndexedDB globals
 * and nothing else. A browser that will not answer leaves the caller with nothing to display;
 * throwing would turn that into an error path.
 *
 * Taking the `StorageManager` as a parameter is what lets a Node test exercise the reporting.
 */
export async function estimateStorageUsage(
	storage: StorageManager | undefined = globalThis.navigator?.storage,
): Promise<StorageUsage | null> {
	if (!storage?.estimate) {
		return null;
	}

	const { usage, quota } = await storage.estimate();

	return usage === undefined || quota === undefined
		? null
		: { usedBytes: usage, quotaBytes: quota };
}

/**
 * Asks the browser to keep this origin's data when the device runs short of room. Until something
 * asks, the data is best-effort and eviction-eligible, and an evicted origin takes every saved
 * token set with it. A record holds a brand's whole version history, so a single eviction is a lot
 * of lost work that the user is never told about.
 *
 * Deliberately not called from `put`. A durability request belongs to a moment the user chose.
 * Firefox answers one with a permission prompt, and a prompt raised by a background write lands in
 * front of someone who did nothing to summon it. `put` runs whenever a record is written and
 * cannot tell a user's save from any other write, so the flow that saves a brand for the first
 * time owns the call instead. That timing is what `docs/research/oss-landscape.md` section 7a
 * recommends.
 *
 * Resolves true once the origin is persistent, false when the browser declined, and null where the
 * API does not exist, which is the same answer `estimateStorageUsage` gives. A decline is worth
 * telling apart from a missing `persist()`, because the same request can be granted later, once
 * the user has more history with the site. A rejection propagates rather than flattening to null,
 * so whoever calls this during a save must not let it take the save down with it.
 */
export async function requestPersistentStorage(
	storage: StorageManager | undefined = globalThis.navigator?.storage,
): Promise<boolean | null> {
	if (!storage?.persist) {
		return null;
	}

	return storage.persist();
}

/**
 * Thrown when a write runs the origin out of room. `kind` follows the same discriminated-error
 * convention as `SeedParseError` in the core, so a caller branches on a field rather than on a
 * message. #39 has to tell a full origin apart from a schema rejection, because only a full origin
 * is worth offering to free storage for.
 */
export class StorageQuotaExceededError extends Error {
	readonly kind = 'storage-quota-exceeded';

	constructor(options?: { cause?: unknown }) {
		super('the origin is out of storage', options);
		this.name = 'StorageQuotaExceededError';
	}
}

/**
 * Keyed on the name rather than on `instanceof DOMException`, because the platform is moving quota
 * failures off DOMException and onto a `QuotaExceededError` class of their own. Both shapes carry
 * the same name.
 */
function isQuotaExceeded(cause: unknown): boolean {
	return cause instanceof Error && cause.name === 'QuotaExceededError';
}

/**
 * Translates a rejected IndexedDB write into something a caller can act on. Everything that is not
 * a quota failure passes through unchanged, aborts included. An abort means the browser killed the
 * transaction mid-flight, which is worth surfacing as it arrived rather than renaming.
 *
 * Returns the error rather than throwing it, so the store keeps the throw at its own call site
 * where the failing operation is still in view.
 */
export function toStorageWriteError(cause: unknown): Error {
	if (isQuotaExceeded(cause)) {
		return new StorageQuotaExceededError({ cause });
	}

	// IndexedDB rejects with a DOMException, so the fallback covers a caller that arrived some other
	// way. Wrapping keeps the original reachable through `cause`.
	return cause instanceof Error ? cause : new Error(String(cause), { cause });
}
