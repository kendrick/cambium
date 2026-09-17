import type { FontTableRef } from '../../core/brand-record';
import type { FontTable } from '../../core/font-table';

/**
 * Holds the only `import()` of the fallback table, which is what keeps sixty families' worth of
 * rows out of the first-load chunk. `lib/bundle-budget.ts` leaves roughly 24 kB of headroom under
 * the 200 kB first-load budget, and the landing route is an upload screen that needs no font data.
 *
 * `pnpm test:bundle` cannot defend that headroom yet. It measures a real build, and nothing
 * imports this module until #42 wires the table provider, so the budget currently passes whatever
 * these rows weigh. The gzipped-size assertion in fallback-table.test.ts is the one that holds the
 * line in the meantime.
 */
export async function loadFallbackFontTable(): Promise<{ table: FontTable; ref: FontTableRef }> {
	const { FALLBACK_FONT_TABLE, FALLBACK_FONT_TABLE_REF } = await import('./fallback-table');

	return { table: FALLBACK_FONT_TABLE, ref: FALLBACK_FONT_TABLE_REF };
}
