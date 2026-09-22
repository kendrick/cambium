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

/** Respells `motion.duration.fast` in seconds, the other unit the vendored duration value takes. */
function inSeconds(document: typeof SPEC_LIGHT_DOCUMENT, seconds: number): void {
	document.motion.duration.fast.$value = { value: seconds, unit: 's' };
}

/**
 * A conforming `$root` token, which the vendored schema defines as `$ref: token.json` both at the
 * document root and on every group. Written out as a real token so the doctored documents stay
 * schema-valid: the point of those cases is that a legal `$root` is refused for what it is, not
 * that a malformed one fails somewhere.
 */
const ROOT_TOKEN = {
	$type: 'dimension',
	$value: { value: 9, unit: 'rem' },
	$extensions: {
		'com.cambium': { provenance: 'invented', rationale: 'a root token', seedField: null },
	},
};

const RAMP_ROOT_TOKEN = {
	$type: 'color',
	$value: { colorSpace: 'oklch', components: [0.5, 0, 0] },
	$extensions: {
		'com.cambium': { provenance: 'invented', rationale: 'a root token', seedField: null },
	},
};

/**
 * Every object reachable from a value, by identity. Used to assert that the token set and the
 * documents share none, which is a property rather than a list of places someone thought to check.
 *
 * Guards against revisiting, so a value that appears twice is counted once and a cycle terminates.
 */
function objectsIn(node: unknown, found = new Set<object>()): Set<object> {
	if (typeof node !== 'object' || node === null || found.has(node)) return found;

	found.add(node);

	for (const value of Object.values(node)) objectsIn(value, found);

	return found;
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
	 *
	 * The `$`-prefixed cases are the ones that caught a real defect. A payload is an arbitrary object
	 * and a vendor may put anything in it, `$note` included, so a comparison that decides "group" by
	 * looking for `$type` decides it about the payload too and skips the very key the two documents
	 * disagree about. Each case below therefore asserts the path the message names, not just that
	 * something threw: a throw for the wrong reason would pass a bare `toThrow` and prove nothing.
	 */
	type Extensions = Record<string, unknown>;

	const tokenDisagreements: {
		what: string;
		inLight: (extensions: Extensions) => void;
		inDark?: (extensions: Extensions) => void;
		names: string;
	}[] = [
		{
			what: 'a foreign namespace on one document only',
			inLight: (extensions) => {
				extensions['com.example'] = { note: 'a' };
			},
			names: 'radius.md.$extensions.com.example',
		},
		{
			what: 'two provenance rationales for one token',
			inLight: (extensions) => {
				(extensions['com.cambium'] as { rationale: string }).rationale = 'a different reason';
			},
			names: 'radius.md.$extensions.com.cambium.rationale',
		},
		{
			what: 'a foreign payload differing only at a $-prefixed key',
			inLight: (extensions) => {
				extensions['com.example'] = { $note: 'a' };
			},
			inDark: (extensions) => {
				extensions['com.example'] = { $note: 'b' };
			},
			names: 'radius.md.$extensions.com.example.$note',
		},
		{
			what: 'a $-prefixed key buried deeper in a foreign payload',
			inLight: (extensions) => {
				extensions['com.example'] = { deep: { $note: 'a' } };
			},
			inDark: (extensions) => {
				extensions['com.example'] = { deep: { $note: 'b' } };
			},
			names: 'radius.md.$extensions.com.example.deep.$note',
		},
		{
			what: 'a $-prefixed key inside an array in a foreign payload',
			inLight: (extensions) => {
				extensions['com.example'] = [{ $note: 'a' }];
			},
			inDark: (extensions) => {
				extensions['com.example'] = [{ $note: 'b' }];
			},
			names: 'radius.md.$extensions.com.example.0.$note',
		},
		{
			what: 'a foreign payload that is an array of plain values',
			inLight: (extensions) => {
				extensions['com.example'] = ['a'];
			},
			inDark: (extensions) => {
				extensions['com.example'] = ['b'];
			},
			names: 'radius.md.$extensions.com.example.0',
		},
		{
			what: 'a foreign payload that is an array on one document and an object on the other',
			inLight: (extensions) => {
				extensions['com.example'] = ['a'];
			},
			inDark: (extensions) => {
				extensions['com.example'] = { a: 1 };
			},
			names: 'radius.md.$extensions.com.example',
		},
		{
			what: 'a com.cambium payload differing at a $-prefixed key',
			inLight: (extensions) => {
				(extensions['com.cambium'] as Extensions).$note = 'a';
			},
			inDark: (extensions) => {
				(extensions['com.cambium'] as Extensions).$note = 'b';
			},
			names: 'radius.md.$extensions.com.cambium.$note',
		},
		{
			what: 'an $extensions namespace that is itself $-prefixed',
			inLight: (extensions) => {
				extensions.$weird = 'a';
			},
			inDark: (extensions) => {
				extensions.$weird = 'b';
			},
			names: 'radius.md.$extensions.$weird',
		},
	];

	for (const { what, inLight, inDark, names } of tokenDisagreements) {
		it(`still refuses ${what}, because a token's $extensions is kept once`, () => {
			const light = structuredClone(SPEC_LIGHT_DOCUMENT);
			const dark = structuredClone(SPEC_DARK_DOCUMENT);

			inLight(light.radius.md.$extensions as Extensions);
			inDark?.(dark.radius.md.$extensions as Extensions);

			expect(violationLines(light)).toEqual([]);
			expect(violationLines(dark)).toEqual([]);
			expect(() => deserializeDtcg(light, dark)).toThrow(names);
		});
	}

	/**
	 * DTCG is wider than the internal model, and `deserialize.ts` settles every feature the model
	 * cannot hold with one rule: the returned token set must never assert something the document did
	 * not say. These cases are that rule's four branches, read off real documents.
	 *
	 * The refusals assert the feature by name as well as the token, because a message that says only
	 * "cannot read this" sends a reader to the wrong place. The acceptances assert what was kept, so
	 * an over-eager refusal would fail here rather than quietly narrowing what Cambium can import.
	 * Every case checks both documents through `violationLines` first: each of these is a conforming
	 * DTCG document, and a test that let the schema reject one would prove nothing about the rule.
	 *
	 * Each case runs three times, and the one-sided runs are the ones that earn their keep. Stamping
	 * both documents puts the feature where the reader looks, and the reader takes the eight shared
	 * families from light alone, so a table of symmetric cases passes whether a refusal is a
	 * property of the document or only of whichever document supplied the values. That gap hid a
	 * `$root` on the dark side, and before that it hid a `$description` residual in the comparison.
	 * A refusal has to hold from either side and an acceptance has to hold from either side, so the
	 * asymmetric runs are what the rule actually claims.
	 *
	 * The names asserted are chosen to hold whichever document is stamped, which is why the
	 * document-root case asserts `$root` rather than `light.$root`: the same feature can be refused
	 * by the reader naming its document or by the comparison naming neither, and pinning the
	 * mechanism instead of the feature would make the test brittle about something it is not for.
	 */
	const modelRefusals: {
		what: string;
		spoil: (document: typeof SPEC_LIGHT_DOCUMENT) => void;
		names: string[];
	}[] = [
		{
			what: 'an inset shadow rather than turning it into a drop shadow',
			spoil: (document) => {
				(document.shadow.md.$value as Record<string, unknown>).inset = true;
			},
			names: ['shadow.md.$value', 'inset'],
		},
		{
			what: 'a $root token under a modelled group rather than dropping it',
			spoil: (document) => {
				(document.radius as Record<string, unknown>).$root = ROOT_TOKEN;
			},
			names: ['radius.$root', 'token'],
		},
		{
			what: 'a $root token at the document root',
			spoil: (document) => {
				(document as Record<string, unknown>).$root = ROOT_TOKEN;
			},
			names: ['$root', 'token'],
		},
		{
			what: 'a $root token on a primitive ramp',
			spoil: (document) => {
				(document.color.primitive.brand as Record<string, unknown>).$root = RAMP_ROOT_TOKEN;
			},
			names: ['color.primitive.brand.$root', 'token'],
		},
		{
			what: 'a group that $extends another rather than dropping what it inherits',
			spoil: (document) => {
				(document.radius as Record<string, unknown>).$extends = '{spacing}';
			},
			names: ['radius.$extends', 'inherits'],
		},
		{
			what: 'a ramp step whose alpha the model would drop to opaque',
			spoil: (document) => {
				(document.color.primitive.brand['1'].$value as Record<string, unknown>).alpha = 0.5;
			},
			names: ['color.primitive.brand.1.$value', 'alpha'],
		},
		{
			what: 'a transport payload carrying more than the unit it exists to carry',
			spoil: (document) => {
				(document.tracking.tight.$extensions as Record<string, unknown>)['com.cambium.dtcg'] = {
					unit: 'em',
					note: 'written by some other tool',
				};
			},
			names: ['com.cambium.dtcg', 'note'],
		},
		{
			what: 'a layered shadow rather than keeping one layer of it',
			spoil: (document) => {
				(document.shadow.md as Record<string, unknown>).$value = [
					structuredClone(document.shadow.md.$value),
					structuredClone(document.shadow.md.$value),
				];
			},
			names: ['shadow.md.$value', 'layered'],
		},
	];

	for (const { what, spoil, names } of modelRefusals) {
		for (const side of sides) {
			it(`refuses ${what}, stamped on ${side.name}`, () => {
				const light = structuredClone(SPEC_LIGHT_DOCUMENT);
				const dark = structuredClone(SPEC_DARK_DOCUMENT);

				if (side.light) spoil(light);
				if (side.dark) spoil(dark);

				expect(violationLines(light)).toEqual([]);
				expect(violationLines(dark)).toEqual([]);

				for (const named of names) {
					expect(() => deserializeDtcg(light, dark)).toThrow(named);
				}
			});
		}
	}

	const modelAcceptances: {
		what: string;
		spoil: (document: typeof SPEC_LIGHT_DOCUMENT) => void;
	}[] = [
		{
			what: 'an explicit inset: false, which says what the model already holds',
			spoil: (document) => {
				(document.shadow.md.$value as Record<string, unknown>).inset = false;
			},
		},
		{
			what: 'a ramp step alpha of 1, which means what an absent alpha means',
			spoil: (document) => {
				(document.color.primitive.brand['1'].$value as Record<string, unknown>).alpha = 1;
			},
		},
		{
			what: '$deprecated on a token, which annotates a value that survives intact',
			spoil: (document) => {
				(document.radius.md as Record<string, unknown>).$deprecated = true;
			},
		},
		{
			what: '$description on a token, for the same reason',
			spoil: (document) => {
				(document.radius.md as Record<string, unknown>).$description = 'a note';
			},
		},
	];

	for (const { what, spoil } of modelAcceptances) {
		for (const side of sides) {
			it(`accepts ${what}, stamped on ${side.name}`, () => {
				const light = structuredClone(SPEC_LIGHT_DOCUMENT);
				const dark = structuredClone(SPEC_DARK_DOCUMENT);

				if (side.light) spoil(light);
				if (side.dark) spoil(dark);

				expect(violationLines(light)).toEqual([]);
				expect(violationLines(dark)).toEqual([]);

				expect(deserializeDtcg(light, dark)).toEqual(
					deserializeDtcg(SPEC_LIGHT_DOCUMENT, SPEC_DARK_DOCUMENT),
				);
			});
		}
	}

	/**
	 * DTCG states the default outright: "If omitted, defaults to 1" (`format.2025.10.json:618`).
	 * `ShadowColorSchema` requires alpha and holds 1 perfectly, so an opaque shadow written the short
	 * way is a conforming document the model can represent exactly. Refusing it was the rule pointing
	 * the wrong way, and the value is asserted rather than the absence of a throw.
	 */
	it('reads an omitted shadow alpha as the DTCG default of 1', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) {
			delete (document.shadow.md.$value.color as { alpha?: number }).alpha;
		}

		expect(violationLines(light)).toEqual([]);
		expect(violationLines(dark)).toEqual([]);

		const tokenSet = deserializeDtcg(light, dark);

		expect(tokenSet.shadow.values.md.color.alpha).toBe(1);
		expect(tokenSet.schemes.dark.shadow.values.md.color.alpha).toBe(1);
	});

	/**
	 * The asymmetry the default must not break. A ramp step has no alpha field in the model, and
	 * filling one in there would add a key `RampStepSchema` rejects outright.
	 */
	it('gives a ramp step no alpha field at all', () => {
		const tokenSet = deserializeDtcg(SPEC_LIGHT_DOCUMENT, SPEC_DARK_DOCUMENT);

		expect(Object.keys(tokenSet.primitives.brand[0])).not.toContain('alpha');
	});

	/**
	 * The vendored schema's duration value takes `ms` or `s` (`format.2025.10.json:1246`), and a
	 * second is a thousand milliseconds. So a document spelling a duration in seconds states a
	 * duration `DurationValueSchema` holds, and this deserializer has to read it.
	 *
	 * Both documents go through `violationLines` first, because a test that never establishes
	 * conformance proves nothing about a refusal a conforming file should never meet.
	 *
	 * The assertion is on the parsed `TokenSet` a caller receives, not on any magnitude in flight.
	 * The full set is compared against the undoctored read as well: a conversion that fixed the unit
	 * and dropped the `$extensions` payload beside it would pass a spot check on the duration alone.
	 */
	it('reads a duration spelled in seconds as the milliseconds it denotes', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) inSeconds(document, 0.15);

		expect(violationLines(light)).toEqual([]);
		expect(violationLines(dark)).toEqual([]);

		const tokenSet = deserializeDtcg(light, dark);

		expect(tokenSet.motion.values.duration.fast).toMatchObject({ value: 150, unit: 'ms' });
		expect(tokenSet).toEqual(deserializeDtcg(SPEC_LIGHT_DOCUMENT, SPEC_DARK_DOCUMENT));
	});

	/**
	 * The edges of the conversion, which is a multiplication by 1000 and nothing else.
	 *
	 * Half a millisecond is the case that decides the shape: `DurationValueSchema` permits a
	 * fraction, so rounding to a whole millisecond would discard a duration the document stated
	 * outright. The uneven case is there because a product that is not an integer must survive as
	 * one, and zero because it is the boundary `z.number().min(0)` sits on.
	 */
	const secondSpellings: { what: string; seconds: number; milliseconds: number }[] = [
		{ what: 'half a millisecond', seconds: 0.0005, milliseconds: 0.5 },
		{ what: 'a count of milliseconds that is not whole', seconds: 0.0125, milliseconds: 12.5 },
		{ what: 'zero', seconds: 0, milliseconds: 0 },
	];

	for (const { what, seconds, milliseconds } of secondSpellings) {
		it(`converts ${what} without rounding it`, () => {
			const light = structuredClone(SPEC_LIGHT_DOCUMENT);
			const dark = structuredClone(SPEC_DARK_DOCUMENT);

			for (const document of [light, dark]) inSeconds(document, seconds);

			expect(violationLines(light)).toEqual([]);
			expect(violationLines(dark)).toEqual([]);

			const tokenSet = deserializeDtcg(light, dark);

			expect(tokenSet.motion.values.duration.fast).toMatchObject({
				value: milliseconds,
				unit: 'ms',
			});
		});
	}

	/**
	 * The one place the inverse claim is one-directional, asserted in the bytes the next DTCG tool
	 * reads rather than in the model this repo happens to hold.
	 *
	 * A document some other tool wrote in seconds comes back in milliseconds and re-serializes in
	 * milliseconds, so it does not return byte-identical. That is intended, and the claim at the top
	 * of `deserialize.ts` is about documents this pipeline wrote. Pinning the carve-out here keeps it
	 * a recorded decision rather than a sentence in a comment nobody checks.
	 */
	it('emits milliseconds for a document that arrived in seconds', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) inSeconds(document, 0.15);

		const emitted = serializeDtcg(deserializeDtcg(light, dark)) as unknown as {
			light: typeof SPEC_LIGHT_DOCUMENT;
			dark: typeof SPEC_DARK_DOCUMENT;
		};

		expect(violationLines(emitted.light)).toEqual([]);
		expect(violationLines(emitted.dark)).toEqual([]);

		for (const document of [emitted.light, emitted.dark]) {
			expect(document.motion.duration.fast.$value).toEqual({ value: 150, unit: 'ms' });
		}

		expect(emitted.light.motion.duration.fast.$value).not.toEqual(
			light.motion.duration.fast.$value,
		);
	});

	/**
	 * The conversion is not exact, and this case records where it is not.
	 *
	 * `1.005` has no double, so the value reaching the conversion is already 1.0049999999999998934
	 * and a thousand times that is 1004.9999999999999. The case asserts on the emitted document
	 * rather than on the model, because that is where the residue ends up: bytes the next DTCG tool
	 * reads.
	 *
	 * Pinned rather than fixed. The gap is around 1e-13 ms, which no animation consumer resolves,
	 * and every way of tidying it also rounds away the half millisecond the case above protects.
	 * A later change that prefers a rounder number has to fail this test to land.
	 */
	it('carries the rounding residue of an inexact second into the emitted document', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) inSeconds(document, 1.005);

		expect(violationLines(light)).toEqual([]);
		expect(violationLines(dark)).toEqual([]);

		const emitted = serializeDtcg(deserializeDtcg(light, dark)) as unknown as {
			light: typeof SPEC_LIGHT_DOCUMENT;
			dark: typeof SPEC_DARK_DOCUMENT;
		};

		expect(violationLines(emitted.light)).toEqual([]);
		expect(emitted.light.motion.duration.fast.$value).toEqual({
			value: 1004.9999999999999,
			unit: 'ms',
		});
	});

	/**
	 * The ceiling multiplying by 1000 introduces. The vendored schema bounds a duration's magnitude
	 * at nothing, so `{ value: 1e306, unit: 's' }` conforms, and a thousand times that overflows to
	 * `Infinity`, which no document spelled in milliseconds could have stated on its own.
	 *
	 * Left to `TokenSetSchema.parse`, per this module's policy that value shape is Zod's to grade.
	 * What the case pins is that the overflow reaches a caller as a failure rather than as a
	 * duration, since `Infinity` is the one output of this conversion that would be meaningless and
	 * still look like a number.
	 */
	it('fails rather than handing back a duration that overflowed to Infinity', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) inSeconds(document, 1e306);

		expect(violationLines(light)).toEqual([]);
		expect(violationLines(dark)).toEqual([]);

		expect(() => deserializeDtcg(light, dark)).toThrow(/Infinity/);
	});

	/**
	 * The ruling the conversion must not undo, pinned so it stays a decision rather than an accident.
	 * `checkDocumentsAgree` compares raw document subtrees before anything is interpreted, and that
	 * is deliberate: it reports a difference at the JSON that differs, which it can only do while it
	 * knows nothing about units. Teaching it that `{ 0.15, s }` and `{ 150, ms }` are one duration
	 * would give it a second grader to keep in step with the reader below it. Every other family it
	 * walks has no equivalence to teach in the first place.
	 *
	 * So a pair spelling one shared duration two ways is refused, even though both spellings denote
	 * 150 ms and either document on its own would be read. The refusal names the token, which sends
	 * a person to the two lines they have to reconcile.
	 */
	for (const side of sides.filter((candidate) => !(candidate.light && candidate.dark))) {
		it(`refuses a duration spelled in seconds on ${side.name}, because the documents disagree`, () => {
			const light = structuredClone(SPEC_LIGHT_DOCUMENT);
			const dark = structuredClone(SPEC_DARK_DOCUMENT);

			if (side.light) inSeconds(light, 0.15);
			if (side.dark) inSeconds(dark, 0.15);

			expect(violationLines(light)).toEqual([]);
			expect(violationLines(dark)).toEqual([]);

			for (const named of ['motion.duration.fast.$value', 'holds it once']) {
				expect(() => deserializeDtcg(light, dark)).toThrow(named);
			}
		});
	}

	it('is deterministic: the same documents read back to the same bytes', () => {
		const first = JSON.stringify(deserializeDtcg(SPEC_LIGHT_DOCUMENT, SPEC_DARK_DOCUMENT));
		const second = JSON.stringify(
			deserializeDtcg(structuredClone(SPEC_LIGHT_DOCUMENT), structuredClone(SPEC_DARK_DOCUMENT)),
		);

		expect(second).toBe(first);
	});

	/**
	 * Renamed from "does not touch the documents it was given", which claimed more than it checked.
	 * It pins that nothing is written during the call, and that was true while the returned token set
	 * still held live references into the documents, so a caller could edit them through the value
	 * this function handed back, long after it returned, and this case went on passing. The property
	 * asserted at the wrong moment is the tell; `detaches the token set` below pins the rest.
	 */
	it('does not mutate the documents while reading them', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		deserializeDtcg(light, dark);

		expect(light).toEqual(SPEC_LIGHT_DOCUMENT);
		expect(dark).toEqual(SPEC_DARK_DOCUMENT);
	});

	/**
	 * The structural half, asserted over identities rather than over a list of places worth checking.
	 *
	 * `TokenExtensionsSchema` is a `looseObject`, so Zod hands an unknown namespace through by
	 * reference, and a foreign payload is the one value this deserializer carries across whole rather
	 * than rebuilding out of primitives. That made the returned token set and the documents share an
	 * object, and a caller annotating the token set afterwards edited the documents in silence.
	 *
	 * Walking every reachable object and intersecting the two sets is what makes this a property
	 * instead of a spot check: a new family that carries some other value across whole fails here
	 * without anyone remembering to add a case for it. A payload with nesting and an array is used
	 * because a shallow copy would pass a test that only looked one level down.
	 */
	it('detaches the token set from both documents, sharing no object with either', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) {
			(document.radius.md.$extensions as Extensions)['com.acme'] = {
				audit: { reviewer: 'original' },
				tags: ['reviewed'],
			};
		}

		expect(violationLines(light)).toEqual([]);
		expect(violationLines(dark)).toEqual([]);

		const tokenSet = deserializeDtcg(light, dark);
		const documentObjects = new Set([...objectsIn(light), ...objectsIn(dark)]);

		expect([...objectsIn(tokenSet)].filter((held) => documentObjects.has(held))).toEqual([]);
	});

	it('leaves both documents alone when the token set is deeply edited afterwards', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);
		const dark = structuredClone(SPEC_DARK_DOCUMENT);

		for (const document of [light, dark]) {
			(document.radius.md.$extensions as Extensions)['com.acme'] = {
				audit: { reviewer: 'original' },
			};
		}

		const lightBefore = structuredClone(light);
		const darkBefore = structuredClone(dark);

		const tokenSet = deserializeDtcg(light, dark);
		const payload = tokenSet.radius.values.md.$extensions['com.acme'] as {
			audit: { reviewer: string };
		};

		payload.audit.reviewer = 'edited by the caller';

		expect(light).toEqual(lightBefore);
		expect(dark).toEqual(darkBefore);
	});

	/**
	 * The same property inside the token set. `checkMirroredLayers` exempts a foreign namespace from
	 * the mirror precisely so a tool can annotate one copy of the light scheme, so the two copies
	 * sharing one payload object would make the thing the carve-out exists for impossible: annotating
	 * either copy would write through to the other.
	 */
	it('gives the mirrored light scheme two independent copies of a foreign payload', () => {
		const light = structuredClone(SPEC_LIGHT_DOCUMENT);

		(light.color.primitive.brand['1'].$extensions as Extensions)['com.acme'] = {
			audit: { reviewer: 'original' },
		};

		const tokenSet = deserializeDtcg(light, SPEC_DARK_DOCUMENT);
		const top = tokenSet.primitives.brand[0].$extensions['com.acme'] as {
			audit: { reviewer: string };
		};

		top.audit.reviewer = 'edited by the caller';

		expect(tokenSet.schemes.light.primitives.brand[0].$extensions['com.acme']).toEqual({
			audit: { reviewer: 'original' },
		});
		expect((light.color.primitive.brand['1'].$extensions as Extensions)['com.acme']).toEqual({
			audit: { reviewer: 'original' },
		});
	});
});
