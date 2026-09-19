import { describe, expect, it } from 'vitest';

import colorsOnly from './fixtures/raw-responses/colors-only.json';
import fullSeed from './fixtures/raw-responses/full-seed.json';
import lightnessAsPercentage from './fixtures/raw-responses/lightness-as-percentage.json';
import nestedUnknownKeys from './fixtures/raw-responses/nested-unknown-keys.json';
import omittedField from './fixtures/raw-responses/omitted-field.json';
import pairingOutOfOrder from './fixtures/raw-responses/pairing-out-of-order.json';
import proseNotJson from './fixtures/raw-responses/prose-not-json.json';
import unknownKey from './fixtures/raw-responses/unknown-key.json';
import { parseSeed } from './parse-seed';

describe('parseSeed', () => {
	it('parses a recorded response carrying every field the seed defines', () => {
		const result = parseSeed(fullSeed);

		expect(result.ok).toBe(true);
		expect(result.seed?.keyColors?.[0]?.proposedRole).toBe('brand');
		expect(result.seed?.suggestedPairing?.display[0]?.family).toBe('Poppins');
		expect(result.seed?.typeScaleRatio).toBe(1.25);
	});

	// The keyless extractor in #33 fills colours and leaves the rest untouched, so a sparse
	// seed is an ordinary result rather than a degraded one.
	it('parses a response that fills the colour fields and nothing else', () => {
		const result = parseSeed(colorsOnly);

		expect(result.ok).toBe(true);
		expect(result.seed?.keyColors).toHaveLength(1);
		expect(result.seed?.typeClassification).toBeNull();
	});

	// A model that answered in prose and a model that answered in JSON the schema rejects are
	// different failures with different recoveries. One is worth retrying as it stands; the
	// other has an offending field to show the user first.
	it('separates a response that is not JSON from JSON the schema rejects', () => {
		expect(parseSeed(proseNotJson).error?.kind).toBe('not-json');
		expect(parseSeed(omittedField).error?.kind).toBe('schema');
	});

	it('hands back the text of a response that is not JSON, which is all there is to show', () => {
		const result = parseSeed(proseNotJson);

		expect(result.ok).toBe(false);
		expect(result.error?.raw).toBe(proseNotJson.raw);
		expect(result.error?.issues).toHaveLength(1);
	});

	// The seed schema already decides what is wrong with each of these. What parseSeed adds is
	// carrying the path out to where the UI can name the field that failed.
	it.each([
		['a lightness given as a percentage', lightnessAsPercentage, ['keyColors', 0, 'oklch', 0]],
		['a field omitted rather than stated absent', omittedField, ['radiusCharacter']],
		['pairing candidates out of score order', pairingOutOfOrder, ['suggestedPairing', 'display']],
	])('names the offending path for %s', (_label, response, path) => {
		const result = parseSeed(response);

		expect(result.ok).toBe(false);
		expect(result.error?.kind).toBe('schema');
		expect(result.error?.issues[0]?.path).toEqual(path);
	});

	// The seed schemas are strict, so a key they do not declare is a rejection rather than a
	// silent drop. Zod reports that against the object holding the key and names the key in a
	// separate array, so an issue has to carry both to point at the field that actually failed.
	it('names an undeclared key by path rather than only in the message', () => {
		const result = parseSeed(unknownKey);

		expect(result.error?.kind).toBe('schema');
		expect(result.error?.issues[0]?.path).toEqual(['confidence']);
	});

	it('gives every undeclared key its own path, however deep the key sits', () => {
		const result = parseSeed(nestedUnknownKeys);

		expect(result.error?.issues.map((issue) => issue.path)).toEqual([
			['radiusCharacter', 'unit'],
			['radiusCharacter', 'scale'],
		]);
	});

	// The fixture stamps `seed-v2` while `SEED_PROMPT_VERSION` is `seed-v3`, on purpose. A fixture
	// agreeing with the constant would pass this assertion either way: whether `parseSeed` carried
	// the value off the response, or read the constant directly. Only the first is the behaviour
	// under test.
	it('carries the provider, model, and prompt version of the response that failed', () => {
		const result = parseSeed(proseNotJson);

		expect(result.error?.provider).toBe('anthropic');
		expect(result.error?.model).toBe('claude-haiku-4-5-20251001');
		expect(result.error?.promptVersion).toBe('seed-v2');
	});
});
