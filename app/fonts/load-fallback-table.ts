import type { FontTableRef } from '../../core/brand-record';
import type { FontTable } from '../../core/font-table';

/**
 * Holds the only `import()` of the fallback table, which is what keeps sixty families' worth of
 * rows out of the first-load chunk. `lib/bundle-budget.ts` leaves roughly 24 kB of headroom under
 * the 200 kB first-load budget, and the landing route is an upload screen that needs no font data.
 *
 * `font-table-provider.ts` now imports this module on every fetch failure, so the dynamic import
 * chain is real code rather than an orphan accessor. That still gives `pnpm test:bundle` nothing to
 * defend: Next only emits a chunk for a module a route's graph reaches, and no route imports the
 * provider, so a real build never touches these rows and the budget passes whatever they weigh.
 * The gzipped-size assertion in fallback-table.test.ts is what holds the line.
 */
export async function loadFallbackFontTable(): Promise<{ table: FontTable; ref: FontTableRef }> {
	const { FALLBACK_FONT_TABLE, FALLBACK_FONT_TABLE_REF } = await import('./fallback-table');

	return { table: FALLBACK_FONT_TABLE, ref: FALLBACK_FONT_TABLE_REF };
}
