import type { BrandSeed } from '../brand-seed';
import type { RepairEntry } from '../contrast/repair';
import { cssNaming } from '../css/globals-css';
import { toThemeBlock } from '../css/theme-block';
import type { TokenSet } from '../token-set';
import { exportArtifacts } from './artifacts';
import { designDoc } from './design-doc';
import { toUnbrandedDsSource, toUnbrandedDsTheme } from './unbranded-ds';

/** `designDoc`'s own input: the archive needs nothing the design doc doesn't. */
export type ExportArchiveInput = {
	tokens: TokenSet;
	seed: BrandSeed;
	repairs: readonly RepairEntry[];
};

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
 *     tokens/theme.css                                     toThemeBlock alone, for a project that
 *                                                          already has a globals.css
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
