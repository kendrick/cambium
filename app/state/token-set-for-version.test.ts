import { describe, expect, it } from 'vitest';

import type { BrandRecord, BrandVersion } from '../../core/brand-record';
import { FIRST_REVISION, SCHEMA_VERSION } from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import { resolveScheme } from '../../core/resolve-scheme';
import { createInMemoryRecordStore } from '../storage/in-memory-record-store';

import { createWorkspaceStore, tokenSetForVersion } from './workspace-store';

// sRGB red, written as the OKLCH a person's override would store. Chosen so the expected colour is
// settled by the requirement, not by anything this pipeline computes.
const RED = { l: 0.627955, c: 0.257683, h: 29.2339 };

const seed: BrandSeed = {
	keyColors: [
		{ oklch: [0.62, 0.18, 250], proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null },
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

function version(overrides: BrandVersion['overrides'] = []): BrandVersion {
	return {
		createdAt: '2026-01-01T00:00:00.000Z',
		ordinal: 1,
		seed,
		tokenSet: null,
		provider: 'anthropic',
		model: 'claude-opus-5',
		promptVersion: 'seed-v4',
		rawResponse: null,
		scaleEngine: 'cambium-oklch-3',
		fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		interpretation: 'balanced',
		overrides,
		pins: ['keyColors.0'],
	};
}

const redPrimary = version([
	{ kind: 'primitive', scheme: 'light', ramp: 'brand', step: 9, ...RED },
]);

describe('tokenSetForVersion', () => {
	// The library's strip and the workspace are two consumers of one version. They must agree.
	it('returns the token set the workspace shows on opening that version', () => {
		const engine = createOklchScaleEngine();
		const record: BrandRecord = {
			id: crypto.randomUUID(),
			schemaVersion: SCHEMA_VERSION,
			revision: FIRST_REVISION,
			brandUrl: null,
			images: [],
			versions: [redPrimary],
		};
		const workspace = createWorkspaceStore({ recordStore: createInMemoryRecordStore(), engine });

		workspace.getState().open(record);

		expect(tokenSetForVersion(engine, redPrimary)).toEqual(workspace.getState().tokenSet);
	});

	// "Current" includes the person's own edits, which apply after repair.
	it('applies the version’s overrides on top of the derived set', () => {
		const tokenSet = tokenSetForVersion(createOklchScaleEngine(), redPrimary);
		const primary = tokenSet && resolveScheme(tokenSet.schemes.light).primary;

		expect(primary?.l).toBeCloseTo(RED.l, 6);
		expect(primary?.c).toBeCloseTo(RED.c, 6);
		expect(primary?.h).toBeCloseTo(RED.h, 4);
	});

	it('is null for a version with no seed', () => {
		expect(tokenSetForVersion(createOklchScaleEngine(), { ...version(), seed: null })).toBeNull();
	});
});
