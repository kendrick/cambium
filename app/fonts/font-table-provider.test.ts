import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FALLBACK_FONT_TABLE, FALLBACK_FONT_TABLE_REF } from './fallback-table';
import {
	UNPARSEABLE_FAMILIES_CSV,
	VALID_FAMILIES_CSV,
	VALID_FAMILIES_ROWS,
} from './fixtures/families.csv';
import { resetFontTableCacheForTests, resolveFontTable } from './font-table-provider';

const PINNED_URL =
	'https://cdn.jsdelivr.net/gh/google/fonts@ead515ad8b1a6723071ddf7c33f8b35dcf1c97e1/tags/all/families.csv';

function okResponse(body: string): Response {
	return new Response(body, { status: 200 });
}

function errorResponse(status: number): Response {
	return new Response('', { status });
}

/**
 * Lets a test make the fallback's own dynamic import fail, standing in for a chunk that did not
 * load. Every call beyond `failures` runs the real module, so the fallback assertions below still
 * compare against the real curated rows.
 *
 * A count rather than a flag, because the tests that need this have a resolution in flight when
 * they set it. A flag would be read whenever the pending fetch happened to settle, which is a
 * different moment from the one the test meant.
 */
const fallback = vi.hoisted(() => ({ failures: 0 }));

vi.mock('./load-fallback-table', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./load-fallback-table')>();

	return {
		loadFallbackFontTable: () => {
			if (fallback.failures > 0) {
				fallback.failures -= 1;

				return Promise.reject(new Error('chunk load failed'));
			}

			return actual.loadFallbackFontTable();
		},
	};
});

// The offline rule, enforced rather than remembered: a test that forgets to stub `fetch` gets one
// that throws rather than one that reaches jsDelivr. `core/purity.test.ts` guards the core the same
// way. Each test below stubs its own over the top of this.
beforeEach(() => {
	resetFontTableCacheForTests();
	fallback.failures = 0;
	vi.stubGlobal('fetch', () => {
		throw new Error('the test suite must not reach the network');
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('resolveFontTable', () => {
	it('fetches the pinned jsDelivr URL and parses the response into a table', async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(okResponse(VALID_FAMILIES_CSV));
		vi.stubGlobal('fetch', fetchMock);

		const { table, ref } = await resolveFontTable();

		expect(fetchMock).toHaveBeenCalledWith(PINNED_URL);
		expect(table).toEqual(VALID_FAMILIES_ROWS);
		expect(ref).toEqual({
			source: 'google/fonts/tags/all/families.csv',
			version: 'ead515ad8b1a6723071ddf7c33f8b35dcf1c97e1',
		});
	});

	it('drops the axis-position row rather than keeping a second score for the same family and tag', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(VALID_FAMILIES_CSV)));

		const { table } = await resolveFontTable();

		expect(
			table.filter((row) => row.family === 'Geo Sans' && row.tag === '/Sans/Geometric'),
		).toHaveLength(1);
	});

	it('passes a tag outside the curated TagName union through unchanged', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(VALID_FAMILIES_CSV)));

		const { table } = await resolveFontTable();

		expect(table).toContainEqual({ family: 'Geo Sans', tag: '/Upstream/NewTag', score: 55 });
	});

	it('falls back to the in-repo table on an HTTP error rather than throwing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(500)));

		const { table, ref } = await resolveFontTable();

		expect(table).toBe(FALLBACK_FONT_TABLE);
		expect(ref).toEqual(FALLBACK_FONT_TABLE_REF);
	});

	it('falls back to the in-repo table when fetch itself throws rather than throwing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

		const { table, ref } = await resolveFontTable();

		expect(table).toBe(FALLBACK_FONT_TABLE);
		expect(ref).toEqual(FALLBACK_FONT_TABLE_REF);
	});

	it('falls back to the in-repo table on an unparseable body rather than throwing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(UNPARSEABLE_FAMILIES_CSV)));

		const { table, ref } = await resolveFontTable();

		expect(table).toBe(FALLBACK_FONT_TABLE);
		expect(ref).toEqual(FALLBACK_FONT_TABLE_REF);
	});

	it('caches the in-flight promise so two concurrent callers share one fetch', async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(okResponse(VALID_FAMILIES_CSV));
		vi.stubGlobal('fetch', fetchMock);

		const [first, second] = await Promise.all([resolveFontTable(), resolveFontTable()]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(first).toEqual(second);
	});

	// The reset in the middle is what proves the cache caused the suppression rather than something
	// else about the second call.
	it('fetches once per session, and again only after the cache is cleared', async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(okResponse(VALID_FAMILIES_CSV));
		vi.stubGlobal('fetch', fetchMock);

		await resolveFontTable();
		await resolveFontTable();

		expect(fetchMock).toHaveBeenCalledTimes(1);

		resetFontTableCacheForTests();
		await resolveFontTable();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	// A failed fetch caches its fallback, which is the point of resolving once. A failure of the
	// fallback itself must not: that is a chunk that did not load, and remembering the rejection
	// would pin one bad moment for the rest of the session.
	it('forgets a rejection so a later call can still resolve', async () => {
		fallback.failures = 1;
		vi.stubGlobal('fetch', vi.fn<() => Promise<Response>>().mockResolvedValue(errorResponse(500)));

		await expect(resolveFontTable()).rejects.toThrow('chunk load failed');

		const { ref } = await resolveFontTable();

		expect(ref).toEqual(FALLBACK_FONT_TABLE_REF);
	});

	// A reset can land while a resolution is still in flight, and the loser's own rejection must not
	// take the winner with it. The fetch count is what tells the two apart: a third call here means
	// the first resolution wiped a cache entry that was no longer its own.
	it('clears only its own resolution when a reset lands mid-flight', async () => {
		const fetchMock = vi.fn<() => Promise<Response>>().mockResolvedValue(errorResponse(500));
		vi.stubGlobal('fetch', fetchMock);

		// Only the first trip to the fallback fails, so the doomed resolution rejects and the one
		// installed after the reset does not.
		fallback.failures = 1;
		const doomed = resolveFontTable();

		resetFontTableCacheForTests();
		const survivor = resolveFontTable();

		await expect(doomed).rejects.toThrow('chunk load failed');
		await survivor;
		await resolveFontTable();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
