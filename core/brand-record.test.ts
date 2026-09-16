import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';

const version = {
	createdAt: '2026-09-16T12:00:00.000Z',
	seed: null,
	tokenSet: null,
	provider: 'anthropic',
	model: 'claude-opus-5',
	promptVersion: 'seed-v3',
	scaleEngine: 'cambium-oklch-1',
	fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
};

const record = {
	id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
	schemaVersion: SCHEMA_VERSION,
	images: [{ downscaled: 'data:image/webp;base64,AA', originalHash: 'sha256:abc' }],
	versions: [version],
};

describe('BrandRecordSchema', () => {
	it('parses a record carrying an id, images, and an ordered version list', () => {
		const parsed = BrandRecordSchema.parse(record);

		expect(parsed.versions).toHaveLength(1);
		expect(parsed.images[0]?.originalHash).toBe('sha256:abc');
	});

	// A record written by a future build must not be silently read under today's assumptions.
	// The export archive is the migration path, and it only works if the mismatch is loud.
	it('rejects a schemaVersion it does not know', () => {
		const result = BrandRecordSchema.safeParse({ ...record, schemaVersion: SCHEMA_VERSION + 1 });

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['schemaVersion']);
	});

	it('rejects an id that is not a UUID', () => {
		const result = BrandRecordSchema.safeParse({ ...record, id: 'record-1' });

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['id']);
	});

	// Reproducibility here is by reference, not by determinism: the same seed under a
	// different scale engine or a different font table produces different output, so a
	// version that cannot name all four is not reproducible at all.
	it.each(['provider', 'model', 'scaleEngine', 'fontTable'])(
		'requires every version to record its %s',
		(field) => {
			const { [field]: _dropped, ...incomplete } = version as Record<string, unknown>;

			const result = BrandRecordSchema.safeParse({ ...record, versions: [incomplete] });

			expect(result.success).toBe(false);
		},
	);
});
