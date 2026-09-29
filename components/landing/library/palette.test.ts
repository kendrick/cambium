import { describe, expect, it } from 'vitest';

import { tokenSetForVersion } from '../../../app/state/workspace-store';
import type { BrandVersion } from '../../../core/brand-record';
import { readOklch } from '../../../core/oklch';
import { createOklchScaleEngine } from '../../../core/oklch-scale-engine';

import { PALETTE_TOKENS, paletteSwatches } from './palette';

const RED = { l: 0.627955, c: 0.257683, h: 29.2339 };

const version: BrandVersion = {
	createdAt: '2026-01-01T00:00:00.000Z',
	ordinal: 1,
	seed: {
		keyColors: [
			{
				oklch: [0.62, 0.18, 250],
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
	},
	tokenSet: null,
	provider: 'anthropic',
	model: 'claude-opus-5',
	promptVersion: 'seed-v4',
	rawResponse: null,
	scaleEngine: 'cambium-oklch-3',
	fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
	interpretation: 'balanced',
	overrides: [{ kind: 'primitive', scheme: 'light', ramp: 'brand', step: 9, ...RED }],
	pins: ['keyColors.0'],
};

describe('paletteSwatches', () => {
	const tokenSet = tokenSetForVersion(createOklchScaleEngine(), version);
	if (!tokenSet) throw new Error('the fixture version derived no token set');

	it('paints the seven palette tokens in their fixed order', () => {
		expect(paletteSwatches(tokenSet).map((swatch) => swatch.token)).toEqual([...PALETTE_TOKENS]);
	});

	// Parsed back through culori's `readOklch`, so the assertion checks the colour a CSS parser reads
	// rather than the exact string `toOklchCss` prints.
	it('carries the version’s current primary, override included, as a colour CSS parses', () => {
		const primary = paletteSwatches(tokenSet).find((swatch) => swatch.token === 'primary');
		const parsed = readOklch(primary!.css);

		expect(parsed.l).toBeCloseTo(RED.l, 5);
		expect(parsed.c).toBeCloseTo(RED.c, 5);
		expect(parsed.h).toBeCloseTo(RED.h, 3);
	});
});
