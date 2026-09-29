import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BrandSeedSchema } from '../brand-seed';
import { repairContrast, withContrastRepairs } from '../contrast/repair';
import { cssNaming } from '../css/globals-css';
import { toThemeBlock } from '../css/theme-block';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { buildTokenSet } from '../semantic-layer';
import { type ExportArchiveInput, buildExportArchive, exportArchiveEntries } from './archive';
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

describe('buildExportArchive', () => {
	it('round-trips through fflate to exactly the assembled entries', () => {
		const unzipped = unzipSync(buildExportArchive(input));
		const decoded = Object.fromEntries(
			Object.entries(unzipped).map(([path, bytes]) => [path, strFromU8(bytes)]),
		);

		expect(decoded).toEqual(exportArchiveEntries(input));
	});

	// `exportArchiveEntries` inserts light before dark, so this fails if the zipper stops sorting.
	it('writes its directory in sorted path order', () => {
		expect(Object.keys(unzipSync(buildExportArchive(input)))).toEqual(EXPECTED_PATHS);
	});

	it('produces identical bytes on every call', () => {
		expect(buildExportArchive(input)).toEqual(buildExportArchive(input));
	});

	/**
	 * fflate stamps each entry's DOS time from the local-time fields of its `mtime`. A fixed UTC
	 * instant lands on a different local date in each zone, and west of UTC the 1980 epoch reads as
	 * 1979, where fflate throws. Same check as `core/record-archive.test.ts`.
	 */
	it('produces the same bytes in every time zone, including west of UTC', () => {
		const original = process.env.TZ;

		try {
			process.env.TZ = 'America/Los_Angeles';
			const west = buildExportArchive(input);
			process.env.TZ = 'Asia/Tokyo';
			const east = buildExportArchive(input);

			expect(west).toEqual(east);
		} finally {
			process.env.TZ = original;
		}
	});

	// Its own guard: a stray call added only here would slip past `exportArchiveEntries`'s.
	it('runs with no network and no DOM', () => {
		vi.stubGlobal('fetch', () => {
			throw new Error('the pure core must not reach the network');
		});

		const bytes = buildExportArchive(input);

		// `PK\x03\x04`, the local file header signature that opens any zip holding an entry.
		expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(typeof document).toBe('undefined');
	});
});

/**
 * "Opens in standard tools with no warnings" in the tool's own words. fflate reading back what
 * fflate wrote proves only that it agrees with itself, so Info-ZIP reads the file instead. A
 * checkout without `unzip` skips rather than fails, the way `scripts/demo-fixture.test.ts` treats
 * a missing `magick`.
 */
const hasUnzip = spawnSync('unzip', ['-v']).status === 0;

if (!hasUnzip) {
	// `describe.skipIf` reports a skip with no reason of its own, so say why in the run's output.
	console.warn('core/export/archive.test.ts: skipping Info-ZIP tests—`unzip` is not on PATH');
}

describe.skipIf(!hasUnzip)('the archive as Info-ZIP reads it', () => {
	let dir: string;
	let file: string;

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), 'cambium-export-archive-'));
		file = join(dir, 'export.zip');
		writeFileSync(file, buildExportArchive(input));
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('tests clean with no warnings', () => {
		const result = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('No errors detected');
		expect(result.stdout).not.toMatch(/warning/i);
	});

	it('lists the documented manifest, in order', () => {
		const result = spawnSync('zipinfo', ['-1', file], { encoding: 'utf8' });

		expect(result.status).toBe(0);
		expect(result.stdout.trimEnd().split('\n')).toEqual(EXPECTED_PATHS);
	});

	it.each(EXPECTED_PATHS)('extracts %s byte-identical to its adapter', (path) => {
		const result = spawnSync('unzip', ['-p', file, path], { maxBuffer: 16 * 1024 * 1024 });

		expect(result.status).toBe(0);
		expect(Buffer.compare(result.stdout, Buffer.from(standaloneOutputs(input)[path]!))).toBe(0);
	});
});
