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
	rawResponse: '{"keyColors":[{"proposedRole":"brand"}]}',
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
	it.each(['provider', 'model', 'scaleEngine', 'fontTable', 'interpretation', 'rawResponse'])(
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

describe('BrandRecordSchema integrity', () => {
	// z.iso.datetime() accepts variable fractional precision, and lexicographic order is not
	// chronological order across it: ".1Z" sorts before "Z" while naming a later instant.
	it('orders versions by instant rather than by ISO text', () => {
		const later = { ...version, createdAt: '2026-09-16T12:00:00.1Z' };
		const earlier = { ...version, createdAt: '2026-09-16T12:00:00Z' };

		const result = BrandRecordSchema.safeParse({ ...record, versions: [later, earlier] });

		expect(result.success).toBe(false);
	});

	// Two images sharing an id make every provenance reference to it ambiguous, so the
	// reference resolves while identifying nothing in particular.
	it('rejects duplicate reference image ids', () => {
		const duplicated = [record.images[0], { ...record.images[0], originalHash: 'sha256:def' }];

		expect(BrandRecordSchema.safeParse({ ...record, images: duplicated }).success).toBe(false);
	});

	// The seed is the principal input behind a generated token set. A version holding tokens
	// without one cannot be regenerated or explained, which is the whole point of a history.
	it('rejects a version that stores tokens without the seed that produced them', () => {
		const ramp = Array.from({ length: 12 }, (_, i) => ({
			step: i + 1,
			l: 0.05 + i * 0.08,
			c: 0.05,
			h: 259.8,
		}));
		const layer = { primitives: { brand: ramp }, semantic: { border: 'brand.6' } };
		const orphaned = {
			...version,
			seed: null,
			tokenSet: { ...layer, schemes: { light: layer, dark: layer } },
		};

		expect(BrandRecordSchema.safeParse({ ...record, versions: [orphaned] }).success).toBe(false);
	});

	it('accepts a version that records no raw response, because a preset makes no model call', () => {
		const rederived = { ...version, rawResponse: null };

		expect(BrandRecordSchema.safeParse({ ...record, versions: [rederived] }).success).toBe(true);
	});

	it('accepts a version that has neither a seed nor a token set', () => {
		const empty = { ...version, seed: null, tokenSet: null };

		expect(BrandRecordSchema.safeParse({ ...record, versions: [empty] }).success).toBe(true);
	});
});
