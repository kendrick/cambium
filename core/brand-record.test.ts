import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { derived } from './provenance';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from './token-set.fixture';

/** Reused wherever this file needs a token to carry provenance and nothing about which. */
const extensions = derived('keyColors', 'exercises a schema bound rather than a real derivation');

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
	expressive: null,
};

const version = {
	createdAt: '2026-09-16T12:00:00.000Z',
	ordinal: 1,
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

	/**
	 * The record the version bump exists for. A pre-#7 archive holds a colour-only token set, and
	 * without the bump it claims a version matching the current format and then dies on a list of
	 * Zod issues rather than on the loud mismatch `SCHEMA_VERSION` is there to raise.
	 */
	it('rejects a token set from before the non-colour categories landed', () => {
		const ramp = Array.from({ length: 12 }, (_, i) => ({
			step: i + 1,
			l: 0.05 + i * 0.08,
			c: 0.05,
			h: 259.8,
			$extensions: extensions,
		}));
		const layer = {
			primitives: { brand: ramp },
			semantic: { border: { alias: 'brand.6', $extensions: extensions } },
		};
		const colourOnly = { ...layer, schemes: { light: layer, dark: layer } };

		const result = BrandRecordSchema.safeParse({
			...record,
			versions: [{ ...version, tokenSet: colourOnly }],
		});

		expect(result.success).toBe(false);
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
	it.each([
		'provider',
		'model',
		'scaleEngine',
		'fontTable',
		'interpretation',
		'rawResponse',
		'ordinal',
	])('requires every version to record its %s', (field) => {
		const { [field]: _dropped, ...incomplete } = version as Record<string, unknown>;

		expect(BrandRecordSchema.safeParse({ ...record, versions: [incomplete] }).success).toBe(false);
	});

	// Code that treats the last entry as current would otherwise silently select an older one.
	// The ordinal runs correctly here (1, 2) so this failure is the chronological check's alone.
	it('rejects a version history that runs out of chronological order', () => {
		const older = { ...version, ordinal: 2, createdAt: '2026-09-15T12:00:00.000Z' };

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
	// chronological order across it: ".1Z" sorts before "Z" while naming a later instant. The
	// ordinal runs correctly here (1, 2) so this failure is the chronological check's alone.
	it('orders versions by instant rather than by ISO text', () => {
		const later = { ...version, createdAt: '2026-09-16T12:00:00.1Z' };
		const earlier = { ...version, ordinal: 2, createdAt: '2026-09-16T12:00:00Z' };

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
			$extensions: extensions,
		}));
		// The token set has to be valid on its own, or the rejection below stops being about the
		// missing seed and starts being about a shape `TokenSetSchema` would reject anyway.
		const shadow = SHADOW_FIXTURE;
		const layer = {
			primitives: { brand: ramp },
			semantic: { border: { alias: 'brand.6', $extensions: extensions } },
			shadow,
		};
		const orphaned = {
			...version,
			seed: null,
			tokenSet: {
				...layer,
				schemes: { light: layer, dark: layer },
				...NON_COLOR_FIXTURE,
			},
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

/**
 * `createdAt` alone cannot totally order a history: two versions can legally share an instant,
 * which is exactly what the interpretation-preset path produces, since it re-derives a whole
 * system with no model call to spread two versions across time. These tests pin the boundaries
 * `ordinal` is supposed to hold, rather than trusting a comment to describe them correctly.
 */
describe('BrandRecordSchema version ordinals', () => {
	it('requires a lone version to start at ordinal 1', () => {
		const misnumbered = { ...version, ordinal: 2 };

		const result = BrandRecordSchema.safeParse({ ...record, versions: [misnumbered] });

		expect(result.success).toBe(false);
	});

	it('rejects a gap in the ordinal sequence', () => {
		const first = { ...version, ordinal: 1, createdAt: '2026-09-16T12:00:00.000Z' };
		const skipped = { ...version, ordinal: 3, createdAt: '2026-09-17T12:00:00.000Z' };

		const result = BrandRecordSchema.safeParse({ ...record, versions: [first, skipped] });

		expect(result.success).toBe(false);
	});

	// This is the scenario the ordinal exists for: two versions in the same millisecond, told
	// apart only by which one actually came later.
	it('accepts two versions sharing an instant when their ordinals still run in sequence', () => {
		const first = { ...version, ordinal: 1 };
		const second = { ...version, ordinal: 2 };

		const result = BrandRecordSchema.safeParse({ ...record, versions: [first, second] });

		expect(result.success).toBe(true);
	});

	// The defect this whole change exists to close: without the ordinal, this record was
	// indistinguishable from the accepted case just above.
	it('rejects two versions sharing both an instant and an ordinal', () => {
		const first = { ...version, ordinal: 1 };
		const duplicate = { ...version, ordinal: 1 };

		const result = BrandRecordSchema.safeParse({ ...record, versions: [first, duplicate] });

		expect(result.success).toBe(false);
	});

	// The two checks are independent: correct timestamps do not excuse an ordinal running
	// backward.
	it('rejects an ordinal that runs backward even though timestamps run forward', () => {
		const first = { ...version, ordinal: 2, createdAt: '2026-09-16T12:00:00.000Z' };
		const second = { ...version, ordinal: 1, createdAt: '2026-09-17T12:00:00.000Z' };

		const result = BrandRecordSchema.safeParse({ ...record, versions: [first, second] });

		expect(result.success).toBe(false);
	});
});
