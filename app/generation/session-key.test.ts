import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	SESSION_KEY_STORAGE_KEY,
	clearSessionKey,
	getSessionKey,
	setSessionKey,
} from './session-key';

/** A Storage-shaped map, so Node can stand in for a tab without jsdom. */
function memoryStorage(): Storage {
	const items = new Map<string, string>();

	return {
		get length() {
			return items.size;
		},
		clear: () => items.clear(),
		getItem: (name) => items.get(name) ?? null,
		key: (index) => [...items.keys()][index] ?? null,
		removeItem: (name) => {
			items.delete(name);
		},
		setItem: (name, value) => {
			items.set(name, String(value));
		},
	};
}

function fail(): never {
	throw new DOMException('The operation is insecure.', 'SecurityError');
}

/** What Safari's private mode and a blocked-cookies origin hand back: every call throws. */
function throwingStorage(): Storage {
	return {
		get length() {
			return fail();
		},
		clear: fail,
		getItem: fail,
		key: fail,
		removeItem: fail,
		setItem: fail,
	};
}

/**
 * Every storage the key must never reach, stubbed as globals and spied on. Node has none of them,
 * so without the stubs a stray write would throw a ReferenceError the code under test might
 * swallow, and the test could not tell "never wrote" from "tried and failed".
 */
function watchOtherStorage() {
	const local = memoryStorage();
	const localSet = vi.spyOn(local, 'setItem');
	const indexedDbOpen = vi.fn<(name: string) => void>();
	vi.stubGlobal('localStorage', local);
	vi.stubGlobal('indexedDB', {
		open: indexedDbOpen,
		deleteDatabase: vi.fn<(name: string) => void>(),
	});
	const consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
		vi.spyOn(console, method).mockImplementation(() => {}),
	);

	return { local, localSet, indexedDbOpen, consoleCalls };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('session key', () => {
	it('round-trips set, get and clear through the storage it is handed', () => {
		const storage = memoryStorage();

		expect(getSessionKey(storage)).toBeNull();
		expect(setSessionKey('sk-ant-test-1', storage)).toBe(true);
		expect(getSessionKey(storage)).toBe('sk-ant-test-1');

		clearSessionKey(storage);

		expect(getSessionKey(storage)).toBeNull();
		expect(storage.length).toBe(0);
	});

	// Asserting the key comes back is what pins the default to `sessionStorage`. A null would
	// survive deleting the default outright, since everything here answers null when handed nothing.
	it('reads and writes sessionStorage when nothing is injected', () => {
		const session = memoryStorage();
		vi.stubGlobal('sessionStorage', session);

		setSessionKey('sk-ant-default');

		expect(session.getItem(SESSION_KEY_STORAGE_KEY)).toBe('sk-ant-default');
		expect(getSessionKey()).toBe('sk-ant-default');

		clearSessionKey();

		expect(session.getItem(SESSION_KEY_STORAGE_KEY)).toBeNull();
	});

	it('replaces an earlier key rather than keeping both', () => {
		const storage = memoryStorage();

		setSessionKey('sk-ant-old', storage);
		setSessionKey('sk-ant-new', storage);

		expect(getSessionKey(storage)).toBe('sk-ant-new');
		expect(storage.length).toBe(1);
	});

	// An empty entry is not a key. Handing it to `anthropicAuth` would buy a guaranteed 401, which
	// the landing page would then show as a rejected key the user never typed.
	it('reads an empty stored value as no key', () => {
		const storage = memoryStorage();
		storage.setItem(SESSION_KEY_STORAGE_KEY, '');

		expect(getSessionKey(storage)).toBeNull();
	});

	describe('when storage throws', () => {
		it('reads as no key, reports the write as failed, and clears without throwing', () => {
			const storage = throwingStorage();

			expect(getSessionKey(storage)).toBeNull();
			expect(setSessionKey('sk-ant-test-1', storage)).toBe(false);
			expect(() => clearSessionKey(storage)).not.toThrow();
		});

		// Some browsers throw from the `sessionStorage` accessor itself, before any method runs, so
		// reaching for the default has to sit inside the same guard as the calls.
		it('survives an accessor that throws on read', () => {
			Object.defineProperty(globalThis, 'sessionStorage', {
				configurable: true,
				get() {
					throw new DOMException('The operation is insecure.', 'SecurityError');
				},
			});

			try {
				expect(getSessionKey()).toBeNull();
				expect(setSessionKey('sk-ant-test-1')).toBe(false);
				expect(() => clearSessionKey()).not.toThrow();
			} finally {
				Reflect.deleteProperty(globalThis, 'sessionStorage');
			}
		});
	});

	it('reads as no key where sessionStorage does not exist', () => {
		expect(typeof sessionStorage).toBe('undefined');

		expect(getSessionKey()).toBeNull();
		expect(setSessionKey('sk-ant-test-1')).toBe(false);
		expect(() => clearSessionKey()).not.toThrow();
	});

	describe('reaches no other storage', () => {
		it('writes only to sessionStorage on success', () => {
			const watch = watchOtherStorage();
			const session = memoryStorage();
			vi.stubGlobal('sessionStorage', session);

			setSessionKey('sk-ant-secret');
			getSessionKey();
			clearSessionKey();

			expect(watch.localSet).not.toHaveBeenCalled();
			expect(watch.local.length).toBe(0);
			expect(watch.indexedDbOpen).not.toHaveBeenCalled();
			for (const call of watch.consoleCalls) {
				expect(call).not.toHaveBeenCalled();
			}
		});

		// The constraint this module exists under. A fallback here would outlive the tab, which is
		// the one property the issue asks the key to have.
		it('falls back to nothing when sessionStorage throws', () => {
			const watch = watchOtherStorage();
			vi.stubGlobal('sessionStorage', throwingStorage());

			expect(setSessionKey('sk-ant-secret')).toBe(false);
			expect(getSessionKey()).toBeNull();

			expect(watch.localSet).not.toHaveBeenCalled();
			expect(watch.local.length).toBe(0);
			expect(watch.indexedDbOpen).not.toHaveBeenCalled();
			for (const call of watch.consoleCalls) {
				expect(call).not.toHaveBeenCalled();
			}
		});
	});
});
