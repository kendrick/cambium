import { describe, expect, it } from 'vitest';

import type { BrandSeed } from '../brand-seed';
import { withContrastRepairs } from '../contrast/repair';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { buildTokenSet } from '../semantic-layer';

import { exportArchiveEntries } from './archive';
import { exportArtifacts } from './artifacts';
import { exportFiles } from './export-files';

const SEED: BrandSeed = {
	keyColors: [
		{
			oklch: [0.6231, 0.188, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
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
};

const derived = createOklchScaleEngine().generate(SEED, BALANCED);

if (!derived.ok) throw new Error(`fixture seed failed to derive: ${derived.error.kind}`);

const { tokenSet, report } = withContrastRepairs(buildTokenSet(derived.schemes, SEED, BALANCED));
const entries = exportArchiveEntries({ tokens: tokenSet, seed: SEED, repairs: report });

/** The archive layout documented on `exportArchiveEntries`, in the zip's sorted order, typed out rather than read off `entries`. */
const PATHS = [
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

describe('exportFiles', () => {
	it('lists one file per archive path, in the archive order, each carrying that entry text', () => {
		const files = exportFiles(entries, null);

		expect(files.map((file) => file.path)).toEqual(PATHS);

		expect(files.map((file) => [file.path, file.contents])).toEqual(
			PATHS.map((path) => [path, entries[path]]),
		);
	});

	// The three files #29 shipped keep the names, types and bytes a person already downloads.
	it.each(['acme.example', null])(
		'downloads the #29 artifacts exactly as exportArtifacts names and types them (brandUrl %j)',
		(brandUrl) => {
			const byName = new Map(exportFiles(entries, brandUrl).map((file) => [file.filename, file]));

			for (const artifact of exportArtifacts(tokenSet, { brandUrl })) {
				expect(byName.get(artifact.filename)).toMatchObject(artifact);
			}
		},
	);

	it('gives every file a brand-prefixed download name no other file shares', () => {
		expect(exportFiles(entries, 'acme.example').map((file) => file.filename)).toEqual([
			'acme.example-DESIGN.md',
			'acme.example-dark.tokens.json',
			'acme.example-light.tokens.json',
			'acme.example-theme.css',
			'acme.example-tokens.css',
			'acme.example-theme.dark.json',
			'acme.example-theme.light.json',
			'acme.example-dark.json',
			'acme.example-light.json',
		]);
	});

	it('types each file by what it holds, with no file falling through to text/plain', () => {
		expect(
			Object.fromEntries(exportFiles(entries, null).map((file) => [file.path, file.mediaType])),
		).toEqual({
			'DESIGN.md': 'text/markdown',
			'tokens/dark.tokens.json': 'application/design-tokens+json',
			'tokens/light.tokens.json': 'application/design-tokens+json',
			'tokens/theme.css': 'text/css',
			'tokens/tokens.css': 'text/css',
			'unbranded-ds/theme.dark.json': 'application/json',
			'unbranded-ds/theme.light.json': 'application/json',
			'unbranded-ds/themes/theme/brand/dark.json': 'application/json',
			'unbranded-ds/themes/theme/brand/light.json': 'application/json',
		});
	});

	it('types a file with an extension it does not know as text/plain', () => {
		expect(exportFiles({ 'notes/README': 'x' }, null)).toEqual([
			{ path: 'notes/README', filename: 'README', mediaType: 'text/plain', contents: 'x' },
		]);
	});
});
