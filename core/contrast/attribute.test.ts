import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from '../brand-seed';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { buildTokenSet } from '../semantic-layer';
import { applyOverrides, overrideKey, type TokenOverride } from '../token-overrides';
import type { TokenSet } from '../token-set';
import { attributeContrastFailures } from './attribute';
import { checkContrast } from './check';
import { pinKey, withContrastRepairs } from './repair';

/** The seed `e2e/token-list.spec.ts` drives, so the browser scenarios and these agree on a set. */
const SEED: BrandSeed = BrandSeedSchema.parse({
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

const derived = createOklchScaleEngine().generate(SEED, BALANCED);
if (!derived.ok) throw new Error(`the fixture seed failed to derive: ${derived.error.kind}`);

const UNREPAIRED = buildTokenSet(derived.schemes, SEED);

function rendered(base: TokenSet, overrides: TokenOverride[]): TokenSet {
	const result = applyOverrides(base, overrides);
	if (!result.ok) throw new Error(`fixture override refused: ${result.key}`);
	return result.tokenSet;
}

function labels(entries: { foreground: string; background: string }[] | undefined): string[] {
	return (entries ?? []).map((entry) => `${entry.foreground} on ${entry.background}`);
}

const FOREGROUND: TokenOverride = {
	kind: 'alias',
	scheme: 'light',
	token: 'foreground',
	alias: 'neutral.11',
};
const BACKGROUND: TokenOverride = {
	kind: 'alias',
	scheme: 'light',
	token: 'background',
	alias: 'brand.9',
};

describe('attributeContrastFailures', () => {
	const repaired = withContrastRepairs(UNREPAIRED).tokenSet;

	it('pins a pair two overrides share on the one whose removal clears it', () => {
		const overrides = [FOREGROUND, BACKGROUND];
		const set = rendered(repaired, overrides);

		const attributed = attributeContrastFailures(set, overrides, UNREPAIRED);

		// `foreground` -> `neutral.11` passes on its own; only the background change breaks the pair,
		// so its row alone carries it, and its Revert is the one that clears it.
		expect(labels(attributed[overrideKey(FOREGROUND)])).toEqual([]);
		expect(labels(attributed[overrideKey(BACKGROUND)])).toEqual([
			'foreground on background',
			'destructive on background',
			'ring on background',
			'sidebar-ring on background',
		]);
	});

	it('leaves a failure that predates every override off the row it merely touches', () => {
		// Pinning both sides of `primary-foreground`/`primary` leaves the repair nothing to move, so
		// that pair fails before anyone overrides anything: the same shape as an unrepaired pin.
		const pinned = withContrastRepairs(UNREPAIRED, {
			pinned: new Set([pinKey('light', 'brand', 1), pinKey('light', 'brand', 9)]),
		}).tokenSet;
		const touch: TokenOverride = {
			kind: 'alias',
			scheme: 'light',
			token: 'primary-foreground',
			alias: 'brand.2',
		};
		const set = rendered(pinned, [touch]);

		// The fixture has to separate the rules: the pair fails with the override in place, and the
		// override sits on one of its sides, so an "either side" filter would attach it.
		const failing = checkContrast(set).filter(
			(entry) =>
				entry.scheme === 'light' &&
				!entry.passes &&
				entry.foreground === 'primary-foreground' &&
				entry.background === 'primary',
		);
		expect(failing).toHaveLength(1);

		expect(labels(attributeContrastFailures(set, [touch], UNREPAIRED)[overrideKey(touch)])).toEqual(
			[],
		);
	});

	it('skips an override the rendered set does not hold', () => {
		// A held override the current base rejected never reached the rendered set, so there is nothing
		// of it to remove.
		const set = rendered(repaired, [BACKGROUND]);
		const unapplied: TokenOverride = { ...FOREGROUND, alias: 'neutral.10' };

		const attributed = attributeContrastFailures(set, [unapplied, BACKGROUND], UNREPAIRED);

		expect(attributed[overrideKey(unapplied)]).toBeUndefined();
		expect(labels(attributed[overrideKey(BACKGROUND)])).toHaveLength(4);
	});
});
