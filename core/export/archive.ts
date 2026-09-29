import { strToU8, zipSync, type Zippable } from 'fflate';

import { cssNaming } from '../css/globals-css';
import { toThemeBlock } from '../css/theme-block';
import { exportArtifacts } from './artifacts';
import { designDoc, type DesignDocInput } from './design-doc';
import { toUnbrandedDsSource, toUnbrandedDsTheme } from './unbranded-ds';

/** `designDoc`'s own input: the archive needs nothing the design doc doesn't. */
export type ExportArchiveInput = DesignDocInput;

// Issue #1: "Cambium output corresponds to a `theme` identity in unbranded-ds's three-axis model:
// one named brand with light and dark variants." One theme per archive, so its name is fixed
// rather than taken from a brand URL, which would make the archive depend on more than the set.
const THEME_IDENTITY = 'brand';
const THEME_DISPLAY_NAME = 'Brand';

// The unbranded-ds adapters return objects with no serialization of their own. This is the
// convention `exportArtifacts` already uses for its DTCG files, so the archive has one, not two.
function json(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Every export adapter's output, keyed by its path in the archive:
 *
 *     DESIGN.md
 *     tokens/{light,dark}.tokens.json, tokens/tokens.css   exportArtifacts, filenames unchanged
 *     tokens/theme.css                                     toThemeBlock alone: the Tailwind v4 theme
 *                                                          block tokens.css also carries. Its prefixed
 *                                                          entries read properties only tokens.css's
 *                                                          :root/.dark rules declare, so it can't pair
 *                                                          with a stock shadcn globals.css
 *     unbranded-ds/theme.{light,dark}.json                 toUnbrandedDsTheme's runtime theme
 *     unbranded-ds/themes/theme/brand/{light,dark}.json    toUnbrandedDsSource's keys, unchanged,
 *                                                          so the subtree drops into that repo
 *
 * Pass the contrast-repaired set: the unbranded-ds adapters ask for it, and it's what the app
 * exports. Pure, like every adapter it calls.
 */
export function exportArchiveEntries({
	tokens,
	seed,
	repairs,
}: ExportArchiveInput): Record<string, string> {
	const entries: Record<string, string> = { 'DESIGN.md': designDoc({ tokens, seed, repairs }) };

	// No brand prefix: the outer .zip can carry one, and #40's download owns that name.
	for (const artifact of exportArtifacts(tokens, { brandUrl: null })) {
		entries[`tokens/${artifact.filename}`] = artifact.contents;
	}

	entries['tokens/theme.css'] = toThemeBlock(tokens, cssNaming());

	for (const scheme of ['light', 'dark'] as const) {
		const { theme } = toUnbrandedDsTheme(tokens, {
			name: THEME_IDENTITY,
			displayName: THEME_DISPLAY_NAME,
			scheme,
		});
		entries[`unbranded-ds/theme.${scheme}.json`] = json(theme);
	}

	for (const [path, document] of Object.entries(toUnbrandedDsSource(tokens, THEME_IDENTITY))) {
		entries[`unbranded-ds/${path}`] = json(document);
	}

	return entries;
}

/**
 * Built from local-time fields, not a UTC instant, because fflate writes each entry's DOS time from
 * `getFullYear()`, `getHours()` and the rest. `1980-01-01T00:00:00Z` is 1979 anywhere west of UTC,
 * where fflate throws, and a different local time everywhere else, so the bytes would depend on
 * where the export ran. Restated from `core/record-archive.ts`, which keeps its copy private.
 */
function zipEpoch(): Date {
	return new Date(1980, 0, 1, 0, 0, 0);
}

// Pinned because the determinism promise covers the compressed bytes, and a library default can
// move. Every entry is text, which is the case `core/record-archive.ts` also deflates at 6.
const ARCHIVE_LEVEL = 6;

/**
 * `exportArchiveEntries`, zipped. Same input, same bytes, in any time zone: entry order, `mtime`
 * and level are all fixed. #40's export pane downloads the result; it has no filename of its own.
 */
export function buildExportArchive(input: ExportArchiveInput): Uint8Array<ArrayBuffer> {
	const entries = exportArchiveEntries(input);
	const mtime = zipEpoch();
	const files: Zippable = {};

	// fflate writes entries in key insertion order, so sorting here is what fixes their order.
	// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh.
	// oxlint-disable-next-line unicorn/no-array-sort
	for (const path of Object.keys(entries).sort()) {
		files[path] = [strToU8(entries[path]!), { level: ARCHIVE_LEVEL, mtime }];
	}

	return zipSync(files);
}
