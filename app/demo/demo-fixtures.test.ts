import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RECORD_NAME_MAX_LENGTH } from '../../core/brand-record';

import { DEMO_FIXTURES, demoRecordName } from './demo-fixtures';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

describe('DEMO_FIXTURES', () => {
	// `scripts/copy-demo-fixtures.mjs` serves whatever the directory holds, and the picker offers whatever this list names. A fixture on disk with no button, or a button with no file, fails here.
	it('names exactly the records committed under app/demo/fixtures', () => {
		const onDisk = readdirSync(FIXTURE_DIR)
			.filter((name) => name.endsWith('.json') && !name.endsWith('.raw.json'))
			.map((name) => name.slice(0, -'.json'.length));

		expect(new Set(DEMO_FIXTURES.map((fixture) => fixture.slug))).toEqual(new Set(onDisk));
		expect(DEMO_FIXTURES).toHaveLength(onDisk.length);
	});

	it('gives every fixture a distinct label whose record name the schema accepts', () => {
		const labels = DEMO_FIXTURES.map((fixture) => fixture.label);

		expect(new Set(labels).size).toBe(labels.length);

		for (const { label } of DEMO_FIXTURES) {
			const name = demoRecordName(label);

			expect(name).toBe(name.trim());
			expect(name.length).toBeGreaterThan(0);
			expect(name.length).toBeLessThanOrEqual(RECORD_NAME_MAX_LENGTH);
		}
	});
});
