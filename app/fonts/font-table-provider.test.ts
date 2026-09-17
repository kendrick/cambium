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

// Every test in this file stubs fetch and none reaches the network, per the offline rule: a test
// that only passes with connectivity is a failing test.
beforeEach(() => {
	resetFontTableCacheForTests();
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

	it('fetches once per session: a second call after resolution reuses the cached result', async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(okResponse(VALID_FAMILIES_CSV));
		vi.stubGlobal('fetch', fetchMock);

		await resolveFontTable();
		await resolveFontTable();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('fetches again after the test-only cache reset, proving the cache is what suppressed the second fetch', async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(okResponse(VALID_FAMILIES_CSV));
		vi.stubGlobal('fetch', fetchMock);

		await resolveFontTable();
		resetFontTableCacheForTests();
		await resolveFontTable();

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
