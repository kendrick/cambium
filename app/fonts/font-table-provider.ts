import type { FontTableRef } from '../../core/brand-record';
import type { FontTable, FontTableRow, ResolvedFontTable } from '../../core/font-table';

import { loadFallbackFontTable } from './load-fallback-table';

// jsDelivr serves a commit-pinned path as immutable for a year; `raw.githubusercontent.com` caches
// the same file for only 300 seconds. ADR-0001 pins the SHA rather than tracking `main` so this
// URL keeps serving the same bytes indefinitely, not just for the life of one session.
const UPSTREAM_SHA = 'ead515ad8b1a6723071ddf7c33f8b35dcf1c97e1';
const UPSTREAM_URL = `https://cdn.jsdelivr.net/gh/google/fonts@${UPSTREAM_SHA}/tags/all/families.csv`;

const FETCHED_FONT_TABLE_REF: FontTableRef = {
	source: 'google/fonts/tags/all/families.csv',
	version: UPSTREAM_SHA,
};

/**
 * Splits a `tags/all/families.csv` line into fields by hand instead of pulling in a CSV package.
 * The grammar this file needs is small: comma-separated fields, double-quote grouping, and `""`
 * as an escaped quote—not enough to justify a new dependency.
 *
 * Deliberately lenient about the two ways a field can be malformed under RFC 4180, because neither
 * appears upstream and both have a safe landing. A quote part-way through an unquoted field opens
 * quoting, so `a"b` runs to the next quote or throws; text after a closing quote is appended, so
 * `"a"b` reads as `ab`. Tightening either would trade a fallback to the in-repo table for a
 * different fallback to the in-repo table.
 *
 * Reads the whole body as one token stream instead of splitting on `\n` first, because a quoted
 * field is allowed to contain a literal newline; splitting on lines first would cut such a field
 * in half.
 */
function parseRows(csv: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;

	while (i < csv.length) {
		const char = csv[i];

		if (inQuotes) {
			if (char === '"') {
				if (csv[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i += 1;
				continue;
			}
			field += char;
			i += 1;
			continue;
		}

		if (char === '"') {
			inQuotes = true;
			i += 1;
			continue;
		}

		if (char === ',') {
			row.push(field);
			field = '';
			i += 1;
			continue;
		}

		if (char === '\n' || char === '\r') {
			if (char === '\r' && csv[i + 1] === '\n') {
				i += 1;
			}
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			i += 1;
			continue;
		}

		field += char;
		i += 1;
	}

	// A quote that never closes means the rest of the body is ambiguous rather than merely
	// empty, so this is the one case `parseRows` treats as a parse failure instead of a short row.
	if (inQuotes) {
		throw new Error('font table CSV: unterminated quoted field');
	}

	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows;
}

/**
 * Turns parsed CSV rows into a `FontTable`. Rows with a populated axis-position column (the
 * second field, e.g. `wght@900`) score one variable-font instance rather than the family as a
 * whole, and keeping them would give one family two scores for one tag with no rule for which
 * wins — so only the default instance, the rows where that column is empty, survives.
 *
 * `tag` is copied through untouched rather than checked against `TagName`. That union is
 * Cambium's own curated subset (see `core/font-table.ts`), and narrowing here would silently drop
 * whatever upstream tag the ranker's `/Theme/` exclusion is supposed to see.
 */
function toFontTable(rows: readonly string[][]): FontTable {
	const table: FontTableRow[] = [];

	for (const fields of rows) {
		if (fields.length === 1 && fields[0] === '') {
			continue; // a trailing blank line, not a row
		}

		if (fields.length !== 4) {
			throw new Error(`font table CSV: expected 4 columns, got ${fields.length}`);
		}

		const [family, axisPosition, tag, scoreText] = fields;

		if (axisPosition !== '') {
			continue;
		}

		const score = Number(scoreText);

		if (family === '' || tag === '' || !Number.isFinite(score)) {
			throw new Error('font table CSV: malformed row');
		}

		table.push({ family, tag, score });
	}

	if (table.length === 0) {
		throw new Error('font table CSV: no rows parsed');
	}

	return table;
}

function parseFontTable(csv: string): FontTable {
	return toFontTable(parseRows(csv));
}

async function fetchFontTable(): Promise<ResolvedFontTable> {
	try {
		const response = await fetch(UPSTREAM_URL);

		if (response.ok) {
			return { table: parseFontTable(await response.text()), ref: FETCHED_FONT_TABLE_REF };
		}
	} catch {
		// A blocked CDN, an offline visitor, a CSP that refuses jsDelivr, and a body `parseFontTable`
		// can't make sense of are all the same case here. The keyless demo has to work with no
		// network at all, so a failed fetch reaches the fallback table as an ordinary path, not as
		// an exception the caller has to handle.
	}

	// Outside the `try` on purpose. Reached from one place, so a failure of the fallback's own
	// dynamic import surfaces instead of being caught and retried into the same failure.
	return loadFallbackFontTable();
}

let cachedResolution: Promise<ResolvedFontTable> | undefined;

/**
 * Resolves the font table for this session: the fetched upstream taxonomy when that succeeds, the
 * in-repo fallback otherwise. Callers get the table beside a `FontTableRef` naming which one
 * answered, because a client that fell back ranks a seed differently from one that fetched the
 * full taxonomy — ADR-0001 makes that recorded identity the thing that keeps "the same seed always
 * produces the same tokens" true across the boundary between them.
 *
 * Caches the in-flight promise, not just its resolved value, so two callers racing on a cold start
 * share one fetch instead of each starting their own.
 */
export function resolveFontTable(): Promise<ResolvedFontTable> {
	if (cachedResolution === undefined) {
		const resolution: Promise<ResolvedFontTable> = fetchFontTable().catch((cause: unknown) => {
			// A rejection must not become what the session remembers. `fetchFontTable` already turns a
			// failed fetch into the fallback table, so a rejection here means the fallback's own chunk
			// did not load, which is a transient browser condition the next call may not hit. Caching
			// it would pin one bad moment for the rest of the session.
			//
			// Clears this resolution and no other. Nothing can replace it while it is pending except
			// `resetFontTableCacheForTests`, and an unconditional clear would then throw away the
			// newer resolution that a caller after the reset is already waiting on.
			if (cachedResolution === resolution) {
				cachedResolution = undefined;
			}

			throw cause;
		});

		cachedResolution = resolution;
	}

	return cachedResolution;
}

/**
 * Test-only escape hatch for the module-level cache above. Production code never calls this: the
 * whole point of caching is that a session fetches at most once, and a test that wants to exercise
 * a cold start again needs a way to clear it deliberately.
 */
export function resetFontTableCacheForTests(): void {
	cachedResolution = undefined;
}
