/**
 * Holds the Anthropic key for one tab. `sessionStorage` survives a reload and dies with the tab,
 * which is the lifetime #23 asks for. There is deliberately no fallback when it throws: every
 * other place a browser can keep a string outlives the tab, so a fallback would quietly break the
 * one promise this module makes. A failed write leaves the caller holding the key in memory for
 * that one generation, and the dialog asks again next time.
 *
 * The key goes to `anthropicAuth(key)` and nowhere else, so nothing here logs, and nothing here
 * puts it in an error message.
 */

/** Namespaced so a dev tools inspection of the tab's storage says what the entry is. */
export const SESSION_KEY_STORAGE_KEY = 'cambium.anthropic-api-key';

/**
 * The accessor sits inside each caller's try, because some browsers throw from `sessionStorage`
 * itself (a `SecurityError` with site data blocked) before any method gets a chance to.
 */
function resolve(storage: Storage | undefined): Storage | undefined {
	return storage ?? globalThis.sessionStorage;
}

/** The stored key, or null when there is none, it is empty, or storage throws. */
export function getSessionKey(storage?: Storage): string | null {
	try {
		const key = resolve(storage)?.getItem(SESSION_KEY_STORAGE_KEY);
		return key ? key : null;
	} catch {
		return null;
	}
}

/**
 * Returns false when the key could not be kept, so the caller knows not to show the loaded-key
 * indicator for a key the next generation won't find.
 */
export function setSessionKey(key: string, storage?: Storage): boolean {
	try {
		const target = resolve(storage);
		if (!target) {
			return false;
		}
		target.setItem(SESSION_KEY_STORAGE_KEY, key);
		return true;
	} catch {
		return false;
	}
}

/** Never throws. Storage that can't be read holds no key to clear. */
export function clearSessionKey(storage?: Storage): void {
	try {
		resolve(storage)?.removeItem(SESSION_KEY_STORAGE_KEY);
	} catch {
		// Nothing to recover: a storage that throws on remove also reads as no key.
	}
}
