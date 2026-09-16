import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';

const seed = {
	keyColors: [
		{
			oklch: [0.62, 0.19, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	surfacePolarity: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: [{ imageId: 'img-1', detected: 'logo' }],
};

const version = {
	createdAt: '2026-09-16T12:00:00.000Z',
	seed,
	tokenSet: null,
	provider: 'anthropic',
	model: 'claude-opus-5',
	promptVersion: 'seed-v3',
	scaleEngine: 'cambium-oklch-1',
	fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
	interpretation: 'balanced',
};

const record = {
	id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
	schemaVersion: SCHEMA_VERSION,
	images: [{ id: 'img-1', downscaled: 'data:image/webp;base64,AA', originalHash: 'sha256:abc' }],
	versions: [version],
};

describe('BrandRecordSchema', () => {
	it('parses a record carrying an id, images, and an ordered version list', () => {
		const parsed = BrandRecordSchema.parse(record);

		expect(parsed.versions).toHaveLength(1);
		expect(parsed.images[0]?.originalHash).toBe('sha256:abc');
	});

	it('rejects a schemaVersion it does not know', () => {
		const result = BrandRecordSchema.safeParse({ ...record, schemaVersion: SCHEMA_VERSION + 1 });

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['schemaVersion']);
	});

	it('rejects an id that is not a UUID', () => {
		expect(BrandRecordSchema.safeParse({ ...record, id: 'record-1' }).success).toBe(false);
	});

	// Reproducibility here is by reference. Every input that can change the output has to be
	// named, or two versions can record identical inputs and hold different tokens. The
	// interpretation preset is one of those: the same seed under Faithful and Expressive
	// produces different systems with no model call between them.
	it.each(['provider', 'model', 'scaleEngine', 'fontTable', 'interpretation'])(
		'requires every version to record its %s',
		(field) => {
			const { [field]: _dropped, ...incomplete } = version as Record<string, unknown>;

			expect(BrandRecordSchema.safeParse({ ...record, versions: [incomplete] }).success).toBe(
				false,
			);
		},
	);

	// Code that treats the last entry as current would otherwise silently select an older one.
	it('rejects a version history that runs out of chronological order', () => {
		const older = { ...version, createdAt: '2026-09-15T12:00:00.000Z' };

		const result = BrandRecordSchema.safeParse({ ...record, versions: [version, older] });

		expect(result.success).toBe(false);
	});

	// Provenance is the evidence a record carries. An id pointing at no image is provenance
	// that cannot be followed, which is worse than none because it still looks like evidence.
	it('rejects a seed colour whose source image is not in the record', () => {
		const orphaned = {
			...version,
			seed: { ...seed, keyColors: [{ ...seed.keyColors[0], sourceImageId: 'img-9' }] },
		};

		expect(BrandRecordSchema.safeParse({ ...record, versions: [orphaned] }).success).toBe(false);
	});

	it('rejects an image classification pointing at an image the record does not hold', () => {
		const orphaned = {
			...version,
			seed: { ...seed, imageClassifications: [{ imageId: 'img-9', detected: 'logo' }] },
		};

		expect(BrandRecordSchema.safeParse({ ...record, versions: [orphaned] }).success).toBe(false);
	});
});
