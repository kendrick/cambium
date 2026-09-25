import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { BrandSeedSchema } from './brand-seed';
import { CAMBIUM_NAMESPACE, derived, invented, observed } from './provenance';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from './token-set.fixture';
import { TokenOverrideSchema } from './token-overrides';
import { TokenSetSchema } from './token-set';

const stepPayload = derived('keyColors', 'takes the brand hue through the curve at this step');

const ramp = Array.from({ length: 12 }, (_, i) => ({
	step: i + 1,
	l: 0.05 + i * 0.08,
	c: 0.05,
	h: 259.8,
	$extensions: stepPayload,
}));
const shadow = SHADOW_FIXTURE;

const layer = {
	primitives: { brand: ramp },
	semantic: { border: { alias: 'brand.6', $extensions: stepPayload } },
	shadow,
};

const tokenSet = {
	...layer,
	schemes: { light: layer, dark: layer },
	...NON_COLOR_FIXTURE,
};

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
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

const record = {
	id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
	schemaVersion: SCHEMA_VERSION,
	revision: 1,
	brandUrl: null,
	images: [
		{
			id: 'img-1',
			downscaled: 'data:image/webp;base64,AA',
			originalHash: 'sha256:abc',
			tag: 'auto',
		},
	],
	versions: [
		{
			createdAt: '2026-09-16T12:00:00.000Z',
			ordinal: 1,
			seed,
			tokenSet,
			provider: 'anthropic',
			model: 'claude-opus-5',
			promptVersion: 'seed-v3',
			rawResponse: '{"keyColors":[{"proposedRole":"brand"}]}',
			scaleEngine: 'cambium-oklch-1',
			fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
			interpretation: 'balanced',
			overrides: [{ kind: 'value', category: 'radius', path: ['lg', 'value'], value: 1 }],
		},
	],
};

/** A set whose first ramp step carries `patch` on top of its own keys, mirrored into both schemes. */
function patchedStep(patch: Record<string, unknown>) {
	const annotated = [{ ...ramp[0]!, ...patch }, ...ramp.slice(1)];
	const patched = { ...layer, primitives: { brand: annotated } };

	return { ...tokenSet, ...patched, schemes: { light: patched, dark: patched } };
}

/**
 * Zod strips unknown keys by default, which is the wrong failure for a persisted shape. Stripping
 * would lose an unrecognised key on the way to disk without a word, so these schemas reject instead
 * and the ticket that adds the key gets an error naming the file to widen.
 *
 * #7 pointed this guard at the payload #9 attaches, and #9 has now landed, so the schema has the
 * slot. What is left to guard is the spelling: `$extensions` sits on a token under one namespace,
 * and every other way of writing provenance down is still a key the schema does not declare. A
 * guard is only worth anything while it points at something the schema has not learned, so what it
 * points at now is the next payload rather than this one.
 */
describe('schema strictness', () => {
	it('accepts a provenance payload on a ramp step now that the schema declares the slot', () => {
		expect(TokenSetSchema.safeParse(tokenSet).success).toBe(true);
	});

	it('rejects a payload attached to the set rather than to a token', () => {
		const attached = { ...tokenSet, $extensions: observed('keyColors', 'traces to the brand') };

		expect(TokenSetSchema.safeParse(attached).success).toBe(false);
	});

	it('rejects provenance written as bare keys beside the value it describes', () => {
		const bare = patchedStep({ provenance: 'derived', rationale: 'traces to the brand' });

		expect(TokenSetSchema.safeParse(bare).success).toBe(false);
	});

	it('rejects a payload filed under a namespace nobody reads', () => {
		const mistyped = patchedStep({
			$extensions: { 'com.example': stepPayload[CAMBIUM_NAMESPACE] },
		});

		expect(TokenSetSchema.safeParse(mistyped).success).toBe(false);
	});

	/**
	 * `seedField` is the discriminator's dependent, the same split `FontCandidateSchema` already
	 * makes between a ranked candidate and an invented one. Allowing any combination would let a
	 * token nothing in the seed informed point at a field anyway, and provenance that cannot be
	 * followed still reads as evidence.
	 */
	it.each([
		[
			'an invented token pointing at a seed field',
			{
				...invented('nothing in the seed reached this')[CAMBIUM_NAMESPACE],
				seedField: 'keyColors',
			},
		],
		[
			'an observed token pointing at no seed field',
			{ ...observed('keyColors', 'places the brand colour')[CAMBIUM_NAMESPACE], seedField: null },
		],
		[
			'a token tracing to a field no seed declares',
			{ ...stepPayload[CAMBIUM_NAMESPACE], seedField: 'vibes' },
		],
		[
			'a rationale running to a second sentence',
			{ ...stepPayload[CAMBIUM_NAMESPACE], rationale: 'Takes the brand hue. Then solves it.' },
		],
		['an empty rationale', { ...stepPayload[CAMBIUM_NAMESPACE], rationale: '' }],
	])('rejects %s', (_name, payload) => {
		const patched = patchedStep({ $extensions: { [CAMBIUM_NAMESPACE]: payload } });

		expect(TokenSetSchema.safeParse(patched).success).toBe(false);
	});

	it.each([
		['BrandSeedSchema', BrandSeedSchema, seed],
		['BrandRecordSchema', BrandRecordSchema, record],
		['TokenSetSchema', TokenSetSchema, tokenSet],
	])('%s rejects a key it does not declare', (_name, schema, value) => {
		expect(schema.safeParse({ ...value, somethingNew: true }).success).toBe(false);
	});

	/**
	 * An override is the user's work, so a key stripped from one on the way to disk is an edit
	 * that silently reads back different. `scheme` on a radius is the likeliest stray. Among value
	 * overrides, only the shadow branch declares a `scheme`, and `category: 'shadow'` is what
	 * selects that branch. Stripping the key would quietly turn a malformed override into a
	 * well-formed one.
	 */
	it.each([
		['a key no override kind declares', { somethingNew: true }],
		['a scheme on a category that has only one home', { scheme: 'dark' }],
	])('an override inside BrandRecordSchema rejects %s', (_name, extra) => {
		const [version] = record.versions;
		const stray = { ...version!.overrides[0]!, ...extra };

		expect(TokenOverrideSchema.safeParse(stray).success).toBe(false);
		expect(
			BrandRecordSchema.safeParse({ ...record, versions: [{ ...version, overrides: [stray] }] })
				.success,
		).toBe(false);
	});

	it('still accepts every shape it does declare', () => {
		expect(BrandSeedSchema.safeParse(seed).success).toBe(true);
		expect(TokenSetSchema.safeParse(tokenSet).success).toBe(true);
		expect(BrandRecordSchema.safeParse(record).success).toBe(true);
		expect(TokenOverrideSchema.safeParse(record.versions[0]!.overrides[0]).success).toBe(true);
	});
});
