import { describe, expect, it } from 'vitest';

import { BrandSeedSchema } from '../brand-seed';
import { toStylesheet } from '../css/stylesheet';
import { withContrastRepairs } from '../contrast/repair';
import { SPEC_TOKEN_SET } from '../dtcg/dtcg.fixture';
import { serializeDtcg } from '../dtcg/serialize';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { buildTokenSet } from '../semantic-layer';
import { exportArtifacts, filenamePrefix } from './artifacts';

/**
 * Walks a DTCG document the same way `core/dtcg/serialize.test.ts` and `core/purity.test.ts` do,
 * so a step's `$value.hex` is reachable without a dependency on either file's private helper.
 */
function nodeAt(document: unknown, path: readonly string[]): unknown {
	return path.reduce<unknown>(
		(node, segment) =>
			typeof node === 'object' && node !== null
				? (node as Record<string, unknown>)[segment]
				: undefined,
		document,
	);
}

function hexAt(document: unknown, ramp: string, step: number): unknown {
	const node = nodeAt(document, ['color', 'primitive', ramp, String(step)]) as
		| { $value?: { hex?: unknown } }
		| undefined;

	return node?.$value?.hex;
}

describe('exportArtifacts', () => {
	it('returns the DTCG halves and the stylesheet unchanged, in light/dark/stylesheet order', () => {
		const artifacts = exportArtifacts(SPEC_TOKEN_SET, { brandUrl: null });
		const { light, dark } = serializeDtcg(SPEC_TOKEN_SET);

		expect(artifacts).toHaveLength(3);
		expect(artifacts.map((a) => a.filename)).toEqual([
			'light.tokens.json',
			'dark.tokens.json',
			'tokens.css',
		]);

		expect(JSON.parse(artifacts[0]!.contents)).toEqual(light);
		expect(JSON.parse(artifacts[1]!.contents)).toEqual(dark);
		expect(artifacts[2]!.contents).toBe(toStylesheet(SPEC_TOKEN_SET));
	});

	it('writes each DTCG document as JSON.stringify(document, null, 2) plus a trailing newline', () => {
		const [lightArtifact] = exportArtifacts(SPEC_TOKEN_SET, { brandUrl: null });
		const { light } = serializeDtcg(SPEC_TOKEN_SET);

		expect(lightArtifact!.contents).toBe(`${JSON.stringify(light, null, 2)}\n`);
	});

	it('names and types the three files per the DTCG format spec, unprefixed with no brandUrl', () => {
		const artifacts = exportArtifacts(SPEC_TOKEN_SET, { brandUrl: null });

		expect(artifacts).toEqual([
			expect.objectContaining({
				filename: 'light.tokens.json',
				mediaType: 'application/design-tokens+json',
			}),
			expect.objectContaining({
				filename: 'dark.tokens.json',
				mediaType: 'application/design-tokens+json',
			}),
			expect.objectContaining({ filename: 'tokens.css', mediaType: 'text/css' }),
		]);
	});

	it('prefixes every filename with the brand hostname when the record has one', () => {
		const artifacts = exportArtifacts(SPEC_TOKEN_SET, { brandUrl: 'https://Acme.com/about' });

		expect(artifacts.map((a) => a.filename)).toEqual([
			'acme.com-light.tokens.json',
			'acme.com-dark.tokens.json',
			'acme.com-tokens.css',
		]);
	});

	it('leaves filenames unprefixed when the brandUrl does not parse', () => {
		const artifacts = exportArtifacts(SPEC_TOKEN_SET, { brandUrl: 'not a url' });

		expect(artifacts.map((a) => a.filename)).toEqual([
			'light.tokens.json',
			'dark.tokens.json',
			'tokens.css',
		]);
	});

	/**
	 * `core/contrast/repair.test.ts` documents this exact seed as the one where `brand.1` in light
	 * starts near white (0.994) with no in-gamut lightness on that side clearing 4.5:1 against
	 * `brand.9`, so the repair moves it to the dark side of the fill. That is the "known contrast
	 * failure" this test needs: a seed whose light `brand.1` provably differs before and after
	 * `withContrastRepairs`, not one that happened to hold still while looking repaired.
	 */
	it('carries the repaired brand.1 colour in the light document, not the raw derived one', () => {
		const seed = BrandSeedSchema.parse({
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
		});
		const generated = createOklchScaleEngine().generate(seed, BALANCED);

		if (!generated.ok)
			throw new Error(`the scale engine rejected the fixture seed: ${generated.error.kind}`);

		const raw = buildTokenSet(generated.schemes, seed);
		const repaired = withContrastRepairs(raw).tokenSet;

		const rawHex = hexAt(serializeDtcg(raw).light, 'brand', 1);
		const repairedHex = hexAt(serializeDtcg(repaired).light, 'brand', 1);

		// Pins that this seed really does repair `brand.1` in light, so the assertion below is
		// checking against a colour that moved rather than one that happened to hold still.
		expect(repairedHex).not.toEqual(rawHex);

		const artifacts = exportArtifacts(repaired, { brandUrl: null });
		const lightDocument = JSON.parse(artifacts[0]!.contents);

		expect(hexAt(lightDocument, 'brand', 1)).toEqual(repairedHex);
	});
});

describe('filenamePrefix', () => {
	it('lowercases the hostname and appends a hyphen', () => {
		expect(filenamePrefix('https://Acme.com/about')).toBe('acme.com-');
	});

	it('keeps only [a-z0-9.-] from the lowercased hostname', () => {
		expect(filenamePrefix('https://Sub_Domain.Example.com')).toBe('subdomain.example.com-');
	});

	it('returns an empty string for a null brandUrl', () => {
		expect(filenamePrefix(null)).toBe('');
	});

	it('returns an empty string for a brandUrl new URL() cannot parse', () => {
		expect(filenamePrefix('not a url')).toBe('');
	});
});
