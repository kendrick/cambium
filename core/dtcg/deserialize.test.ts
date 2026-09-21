import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BrandSeedSchema } from '../brand-seed';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { BALANCED } from '../scale-engine';
import { buildTokenSet } from '../semantic-layer';
import { TokenSetSchema } from '../token-set';
import { deserializeDtcg } from './deserialize';
import { CAMBIUM_DTCG_NAMESPACE } from './dtcg-types';
import { SPEC_DARK_DOCUMENT, SPEC_LIGHT_DOCUMENT, SPEC_TOKEN_SET } from './dtcg.fixture';
import { serializeDtcg } from './serialize';
import { validateDtcg } from './validate';

/**
 * The round trip has one ruler that cannot cheat and one that can.
 *
 * `deserializeDtcg(serializeDtcg(x))` deep-equalling `x` is the cheap one: both halves read the
 * same family table and the same group names, so a table that is wrong about a family is wrong in
 * both directions and the assertion still passes. #72 is what that costs, and the plan's "risks to
 * design against" names this exact shape.
 *
 * So the first case below parses `dtcg.fixture.ts`, whose documents and token set were both
 * transcribed from the vendored schema by a worker who had not opened a serializer. No code
 * produced either side of that equality. The serializer round trip stays, second, because it is the
 * only case that covers a real seed's every ramp and every family rather than the fixture's one
 * token each.
 *
 * Equivalence is deep equality after `TokenSetSchema.parse` on both sides, per the plan. Anything
 * weaker—key sets, token counts, a spot check on a ramp—turns the acceptance criterion into a
 * shape check that a deserializer dropping every `$extensions` payload would pass.
 */

const seedPath = fileURLToPath(new URL('../../scripts/fixtures/seed.json', import.meta.url));
const seed = BrandSeedSchema.parse(JSON.parse(readFileSync(seedPath, 'utf8')));
const generated = createOklchScaleEngine().generate(seed, BALANCED);

if (!generated.ok) throw new Error(`the seed fixture no longer generates: ${generated.error.kind}`);

const seedTokenSet = buildTokenSet(generated.schemes, seed);

/**
 * A readable failure rather than `expect(result).toEqual({ valid: true })`, which prints a
 * quarter-screen of Ajv diagnostics with the pointers buried. Copied from `serialize.test.ts`,
 * where the same reasoning is written out.
 */
function violationLines(document: unknown): string[] {
	const result = validateDtcg(document);

	if (result.valid) return [];

	return result.violations.map(
		(violation) =>
			`${violation.pointer === '' ? '(root)' : violation.pointer}: ${violation.message}`,
	);
}

/**
 * A legal value for each reserved key these tests stamp, so the doctored document stays
 * schema-valid and `violationLines` can prove it. `$schema` wants a URI reference, `$description`
 * plain text, and `$extensions` an object.
 */
const RESERVED_VALUES: Record<string, unknown> = {
	$schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
	$description: 'a note left by whatever last opened the file',
	$extensions: { 'com.example': { note: 'a tool that walked the document' } },
};

/** Writes one reserved DTCG key onto the group at `path`. */
function stamp(document: unknown, path: readonly string[], key: string): void {
	const group = path.reduce<Record<string, unknown>>(
		(node, segment) => node[segment] as Record<string, unknown>,
		document as Record<string, unknown>,
	);

	group[key] = RESERVED_VALUES[key];
}

/**
 * Every `$extensions` namespace anywhere in a value, so a leaked transport namespace is found
 * rather than spot-checked.
 */
function namespacesIn(node: unknown): string[] {
	if (typeof node !== 'object' || node === null) return [];
	if (Array.isArray(node)) return node.flatMap((child) => namespacesIn(child));

	return Object.entries(node).flatMap(([key, value]) =>
		key === '$extensions' && typeof value === 'object' && value !== null
			? Object.keys(value)
			: namespacesIn(value),
	);
}

describe('deserializeDtcg', () => {
	it('rebuilds the hand-transcribed token set from the hand-transcribed documents', () => {
		expect(deserializeDtcg(SPEC_LIGHT_DOCUMENT, SPEC_DARK_DOCUMENT)).toEqual(
			TokenSetSchema.parse(SPEC_TOKEN_SET),
		);
	});

	it('round-trips the seed token set back to itself', () => {
		const documents = serializeDtcg(seedTokenSet);

		expect(deserializeDtcg(documents.light, documents.dark)).toEqual(
			TokenSetSchema.parse(seedTokenSet),
		);
	});

	/**
	 * Eight non-colour groups live once on the `TokenSet` and are written into both documents, so
	 * two spellings of one token is a question this function cannot answer. Shadow is the exception
	 * and is read per scheme, which the fixture exercises: its two shadows differ, and the first case
	 * above passes anyway.
	 */
	it('refuses two documents that disagree about a family the token set holds once', () => {
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		dark.radius.md.$value.value = 0.5;

		expect(() => deserializeDtcg(SPEC_LIGHT_DOCUMENT, dark)).toThrow(/radius\.md/);
	});

	/**
	 * `components` is authoritative and `hex` is a fallback, so the temptation is to read one and
	 * discard the other. A hex that disagrees means the document was hand-edited or written by a tool
	 * whose colour conversion differs from ours, and either way some consumer downstream is painting
	 * a colour this token set does not describe. Dropping it silently would hide that.
	 */
	it('refuses a hex that disagrees with the components beside it', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const transcribed = SPEC_LIGHT_DOCUMENT.color.primitive.brand['9'].$value.hex;

		light.color.primitive.brand['9'].$value.hex = '#ff0000';

		expect(() => deserializeDtcg(light, SPEC_DARK_DOCUMENT)).toThrow(/color\.primitive\.brand\.9/);
		expect(() => deserializeDtcg(light, SPEC_DARK_DOCUMENT)).toThrow(transcribed);
	});

	it('restores tracking to em and leaves the transport namespace nowhere in the token set', () => {
		const tokenSet = deserializeDtcg(SPEC_LIGHT_DOCUMENT, SPEC_DARK_DOCUMENT);

		expect(tokenSet.tracking.values.tight.unit).toBe('em');
		expect(tokenSet.tracking.values.tight.value).toBe(-0.01);
		expect(namespacesIn(tokenSet)).not.toContain(CAMBIUM_DTCG_NAMESPACE);
	});

	/**
	 * The number is dimensionless in the document, so nothing else says what it measures. Defaulting
	 * to em would be inventing the unit, and a tracking scale written in rem and read back as em is a
	 * wrong number wearing the right shape—the failure that survives a round trip looking correct,
	 * which is the same argument `serialize.ts` makes in the other direction.
	 */
	it('refuses a tracking token with no unit to restore', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) {
			delete (document.tracking.tight.$extensions as Record<string, unknown>)[
				CAMBIUM_DTCG_NAMESPACE
			];
		}

		expect(() => deserializeDtcg(light, dark)).toThrow(/tracking\.tight/);
	});

	/**
	 * DTCG 5.2.3 requires a tool to preserve extension data it does not understand, and
	 * `TokenExtensionsSchema` is loose precisely so a foreign namespace survives. A document holds
	 * one copy of the light scheme where the token set holds two, so the annotation lands on both.
	 */
	it('preserves a foreign namespace onto both copies of the mirrored light scheme', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const annotation = { note: 'seen by a tool that walked the document' };

		(light.color.semantic.primary.$extensions as Record<string, unknown>)['com.example'] =
			annotation;

		const tokenSet = deserializeDtcg(light, SPEC_DARK_DOCUMENT);

		expect(tokenSet.semantic.primary.$extensions['com.example']).toEqual(annotation);
		expect(tokenSet.schemes.light.semantic.primary.$extensions['com.example']).toEqual(annotation);
	});

	/**
	 * The ticket's sixth criterion is that a document parses back to an equivalent token set, and a
	 * flattened semantic colour cannot: the alias is the thing the canonical document exists to
	 * carry. Reading the literal instead would hand back a token set whose semantic layer points at
	 * nothing.
	 */
	it('refuses a semantic colour flattened to a literal', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);

		(light.color.semantic.primary as Record<string, unknown>).$value = {
			colorSpace: 'oklch',
			components: [0.48, 0.16, 259.8],
		};

		expect(() => deserializeDtcg(light, SPEC_DARK_DOCUMENT)).toThrow(/color\.semantic\.primary/);
	});

	it('refuses a token whose $type is not the one its family takes', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) document.radius.md.$type = 'number';

		expect(() => deserializeDtcg(light, dark)).toThrow(/radius\.md/);
	});

	/**
	 * A group nobody models reads back as nothing, and nothing is indistinguishable from a token set
	 * that never held it. Failing names the group; dropping it means the next person compares an
	 * exported document with the one that produced it and finds tokens missing with no record of
	 * where they went.
	 */
	it('refuses a group it does not model rather than dropping the tokens inside it', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT) as Record<string, unknown>;

		light.border = { thin: { $type: 'border', $value: {}, $extensions: {} } };

		expect(() => deserializeDtcg(light, SPEC_DARK_DOCUMENT)).toThrow(/border/);
	});

	/**
	 * The refusal above is right about an unmodelled token group and wrong about a `$` name, which is
	 * the distinction the cases below pin. DTCG reserves the `$` prefix, so `$schema` and
	 * `$description` can never be a family this deserializer failed to model, and a document Cambium
	 * wrote can pick one up from any editor that stamps a schema pointer on save.
	 *
	 * Each case asserts through `validateDtcg` that the doctored document is still schema-valid
	 * before reading it. Without that the test could pass by exercising a document the schema would
	 * have rejected anyway, which would prove nothing about conforming input.
	 *
	 * The metadata itself is read past rather than carried: a `TokenSet` has nowhere to put it. So
	 * the assertion is that the token set is the one the undoctored pair denotes, which is what the
	 * round trip of a real Cambium document needs and all the internal model can represent.
	 *
	 * Every placement runs three times, and the one-sided runs are the ones that bite. Stamping both
	 * documents leaves the two nodes equal, so the light-versus-dark comparison never sees the key
	 * and a symmetric case alone cannot tell a comparison that skips reserved names from one that
	 * compares them. Only the one-sided runs reach that code, which is why they are here.
	 */
	const metadataPlacements: { where: string; group: readonly string[]; key: string }[] = [
		{ where: 'the root', group: [], key: '$schema' },
		{ where: 'the root', group: [], key: '$description' },
		{ where: 'the radius group', group: ['radius'], key: '$description' },
		{ where: 'a primitive ramp', group: ['color', 'primitive', 'brand'], key: '$description' },
		{ where: 'the radius group', group: ['radius'], key: '$extensions' },
	];

	const sides: { name: string; light: boolean; dark: boolean }[] = [
		{ name: 'both documents', light: true, dark: true },
		{ name: 'the light document alone', light: true, dark: false },
		{ name: 'the dark document alone', light: false, dark: true },
	];

	for (const { where, group, key } of metadataPlacements) {
		for (const side of sides) {
			it(`reads past ${key} on ${where}, stamped on ${side.name}`, () => {
				const light = structuredClone(SPEC_LIGHT_DOCUMENT);
				const dark = structuredClone(SPEC_DARK_DOCUMENT);

				if (side.light) stamp(light, group, key);
				if (side.dark) stamp(dark, group, key);

				expect(violationLines(light)).toEqual([]);
				expect(violationLines(dark)).toEqual([]);

				expect(deserializeDtcg(light, dark)).toEqual(
					deserializeDtcg(SPEC_LIGHT_DOCUMENT, SPEC_DARK_DOCUMENT),
				);
			});
		}
	}

	/**
	 * The other half of the same rule, and the half that must not move. `$extensions` is a reserved
	 * name, but on a token it is data the token set keeps, in a slot it keeps once. Two documents
	 * claiming different provenance for one token is a real disagreement with no honest answer, and
	 * skipping reserved names there would read one document's payload and discard the other's without
	 * a word.
	 *
	 * The placement above puts `$extensions` on the `radius` group, where the token set has no slot
	 * and it is read past. These put it on the `radius.md` token, where it has one. Same key, and the
	 * answers differ because the node under it does.
	 */
	const tokenDisagreements: {
		what: string;
		spoil: (document: typeof SPEC_LIGHT_DOCUMENT) => void;
	}[] = [
		{
			what: 'a foreign namespace on one document only',
			spoil: (document) => {
				(document.radius.md.$extensions as Record<string, unknown>)['com.example'] = {
					note: 'a',
				};
			},
		},
		{
			what: 'two provenance rationales for one token',
			spoil: (document) => {
				document.radius.md.$extensions['com.cambium'].rationale = 'a different reason';
			},
		},
	];

	for (const { what, spoil } of tokenDisagreements) {
		it(`still refuses ${what}, because a token's $extensions is kept once`, () => {
			const light = structuredClone(SPEC_LIGHT_DOCUMENT);

			spoil(light);

			expect(violationLines(light)).toEqual([]);
			expect(() => deserializeDtcg(light, SPEC_DARK_DOCUMENT)).toThrow(/radius\.md\.\$extensions/);
		});
	}

	it('is deterministic: the same documents read back to the same bytes', () => {
		const first = JSON.stringify(deserializeDtcg(SPEC_LIGHT_DOCUMENT, SPEC_DARK_DOCUMENT));
		const second = JSON.stringify(
			deserializeDtcg(structuredClone(SPEC_LIGHT_DOCUMENT), structuredClone(SPEC_DARK_DOCUMENT)),
		);

		expect(second).toBe(first);
	});

	it('does not touch the documents it was given', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		deserializeDtcg(light, dark);

		expect(light).toEqual(SPEC_LIGHT_DOCUMENT);
		expect(dark).toEqual(SPEC_DARK_DOCUMENT);
	});
});
