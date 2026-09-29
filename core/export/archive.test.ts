import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrandSeedSchema } from '../brand-seed';
import { repairContrast, withContrastRepairs } from '../contrast/repair';
import { cssNaming } from '../css/globals-css';
import { toThemeBlock } from '../css/theme-block';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { buildTokenSet } from '../semantic-layer';
import { type ExportArchiveInput, exportArchiveEntries } from './archive';
import { exportArtifacts } from './artifacts';
import { designDoc } from './design-doc';
import { toUnbrandedDsSource, toUnbrandedDsTheme } from './unbranded-ds';

/**
 * The layout #15's plan documents, typed out rather than derived, so the manifest test checks the
 * archive against the requirement and not against the code that builds it. Sorted, because the
 * zip's own directory order is sorted (Task 2).
 */
const EXPECTED_PATHS = [
	'DESIGN.md',
	'tokens/dark.tokens.json',
	'tokens/light.tokens.json',
	'tokens/theme.css',
	'tokens/tokens.css',
	'unbranded-ds/theme.dark.json',
	'unbranded-ds/theme.light.json',
	'unbranded-ds/themes/theme/brand/dark.json',
	'unbranded-ds/themes/theme/brand/light.json',
];

/**
 * Magenta at mid-lightness, from `core/contrast/repair.test.ts`'s sweep: a real engine run that
 * needs contrast repair, so DESIGN.md's repairs section has rows to carry.
 */
const seed = BrandSeedSchema.parse({
	keyColors: [
		{ oklch: [0.55, 0.25, 330], proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null },
	],
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
});

function fixtureInput(): ExportArchiveInput {
	const generated = createOklchScaleEngine().generate(seed, BALANCED);

	if (!generated.ok)
		throw new Error(`the scale engine rejected the fixture seed: ${generated.error.kind}`);

	const base = buildTokenSet(generated.schemes, seed);

	// The repaired set is what the app exports and what the unbranded-ds adapters ask for; the
	// report is the moves that produced it, which is what DESIGN.md documents.
	return { tokens: withContrastRepairs(base).tokenSet, seed, repairs: repairContrast(base).report };
}

const input = fixtureInput();

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Each path's expected bytes, from calling its adapter directly. The criterion is "byte-identical
 * to that adapter's standalone output", so the adapter's own output is the oracle.
 */
function standaloneOutputs({
	tokens,
	seed: s,
	repairs,
}: ExportArchiveInput): Record<string, string> {
	const artifact = (filename: string) =>
		exportArtifacts(tokens, { brandUrl: null }).find((a) => a.filename === filename)!.contents;
	const source = toUnbrandedDsSource(tokens, 'brand');
	const theme = (scheme: 'light' | 'dark') =>
		json(toUnbrandedDsTheme(tokens, { name: 'brand', displayName: 'Brand', scheme }).theme);

	return {
		'DESIGN.md': designDoc({ tokens, seed: s, repairs }),
		'tokens/dark.tokens.json': artifact('dark.tokens.json'),
		'tokens/light.tokens.json': artifact('light.tokens.json'),
		'tokens/theme.css': toThemeBlock(tokens, cssNaming()),
		'tokens/tokens.css': artifact('tokens.css'),
		'unbranded-ds/theme.dark.json': theme('dark'),
		'unbranded-ds/theme.light.json': theme('light'),
		'unbranded-ds/themes/theme/brand/dark.json': json(source['themes/theme/brand/dark.json']),
		'unbranded-ds/themes/theme/brand/light.json': json(source['themes/theme/brand/light.json']),
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('exportArchiveEntries', () => {
	it('runs against a fixture contrast repair actually moved', () => {
		expect(input.repairs.length).toBeGreaterThan(0);
	});

	it('holds exactly the documented nine-file manifest', () => {
		// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh.
		// oxlint-disable-next-line unicorn/no-array-sort
		expect(Object.keys(exportArchiveEntries(input)).sort()).toEqual(EXPECTED_PATHS);
	});

	it.each(EXPECTED_PATHS)('carries %s byte for byte as its adapter writes it', (path) => {
		expect(exportArchiveEntries(input)[path]).toBe(standaloneOutputs(input)[path]);
	});

	it('is a pure function of its input', () => {
		vi.stubGlobal('fetch', () => {
			throw new Error('the pure core must not reach the network');
		});
		const before = structuredClone(input);

		const first = exportArchiveEntries(input);

		expect(exportArchiveEntries(input)).toEqual(first);
		expect(input).toEqual(before);
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');
	});
});
