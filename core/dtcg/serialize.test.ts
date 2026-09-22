import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BrandSeedSchema } from '../brand-seed';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { CAMBIUM_NAMESPACE } from '../provenance';
import { BALANCED } from './../interpretation';
import { buildTokenSet } from '../semantic-layer';
import { type TokenSet, TokenSetSchema } from '../token-set';
import {
	CAMBIUM_DTCG_NAMESPACE,
	DTCG_ALIAS_PATTERN,
	DTCG_FAMILY_TYPES,
	fromDtcgAlias,
} from './dtcg-types';
import { SPEC_DARK_DOCUMENT, SPEC_LIGHT_DOCUMENT, SPEC_TOKEN_SET } from './dtcg.fixture';
import { serializeDtcg } from './serialize';
import { validateDtcg } from './validate';

/**
 * The acceptance criterion says the output validates against the published DTCG schema, and
 * `validateDtcg` is the only thing here that can answer that. Nothing below re-states a schema
 * rule: a test that graded `$type` spellings or component counts against a hand-written idea of
 * 2025.10 would pass while agreeing with nothing but its own author, which is the defect #72 cost
 * this repo and `docs/agents/testing.md` records under "Where the seam actually is".
 *
 * That leaves two outside rulers. `validateDtcg` grades conformance, and the hand-transcribed
 * `SPEC_LIGHT_DOCUMENT`/`SPEC_DARK_DOCUMENT` grade content, written by a reader who had not opened
 * this serializer, from the spec rather than from the code. Where neither can settle a claim, the
 * claim is asserted structurally over a walk of the emitted document.
 */

/** A token is whatever carries `$type`; a group can never hold that key, since a name cannot start with `$`. */
function isToken(node: unknown): node is Record<string, unknown> {
	return typeof node === 'object' && node !== null && '$type' in node;
}

type WalkedToken = { path: string[]; token: Record<string, unknown> };

function walkTokens(node: unknown, path: string[] = []): WalkedToken[] {
	if (isToken(node)) return [{ path, token: node }];
	if (typeof node !== 'object' || node === null) return [];

	return Object.entries(node).flatMap(([name, child]) => walkTokens(child, [...path, name]));
}

function nodeAt(document: unknown, path: readonly string[]): unknown {
	return path.reduce<unknown>(
		(node, segment) =>
			typeof node === 'object' && node !== null
				? (node as Record<string, unknown>)[segment]
				: undefined,
		document,
	);
}

/**
 * A readable failure rather than `expect(result).toEqual({ valid: true })`, which prints a
 * quarter-screen of Ajv diagnostics with the pointers buried. One line per violation is what a
 * person needs to find the token that broke.
 */
function violationLines(document: unknown): string[] {
	const result = validateDtcg(document);

	if (result.valid) return [];

	return result.violations.map(
		(violation) =>
			`${violation.pointer === '' ? '(root)' : violation.pointer}: ${violation.message}`,
	);
}

const seedPath = fileURLToPath(new URL('../../scripts/fixtures/seed.json', import.meta.url));
const seed = BrandSeedSchema.parse(JSON.parse(readFileSync(seedPath, 'utf8')));
const generated = createOklchScaleEngine().generate(seed, BALANCED);

if (!generated.ok) throw new Error(`the seed fixture no longer generates: ${generated.error.kind}`);

/**
 * Built the way `scripts/generate.mjs` builds it, and deliberately not parsed on the way in.
 * `buildTokenSet` does not parse, so this is the unparsed set the ruling says `serializeDtcg` has
 * to parse for itself.
 */
const seedTokenSet = buildTokenSet(generated.schemes, seed);
const seedDocuments = serializeDtcg(seedTokenSet);

describe('serializeDtcg', () => {
	it('emits light and dark documents the published DTCG schema accepts', () => {
		expect(violationLines(seedDocuments.light)).toEqual([]);
		expect(violationLines(seedDocuments.dark)).toEqual([]);
	});

	it('emits documents the schema accepts for the hand-authored token set too', () => {
		const documents = serializeDtcg(SPEC_TOKEN_SET);

		expect(violationLines(documents.light)).toEqual([]);
		expect(violationLines(documents.dark)).toEqual([]);
	});

	/**
	 * `dtcg.fixture.ts` was transcribed from the spec by a worker with no sight of this file, so a
	 * disagreement here is a real disagreement about what the document should say rather than the
	 * serializer's mapping table agreeing with itself.
	 */
	it('produces the documents the hand-transcribed fixture denotes', () => {
		expect(serializeDtcg(SPEC_TOKEN_SET)).toEqual({
			light: SPEC_LIGHT_DOCUMENT,
			dark: SPEC_DARK_DOCUMENT,
		});
	});

	it('gives light and dark the same key set', () => {
		// toSorted would say this better, but it's ES2023 and tsconfig targets ES2022; the mapped
		// array is already fresh, so sort has nothing of the caller's to mutate.
		const paths = (document: unknown) =>
			walkTokens(document)
				.map((walked) => walked.path.join('.'))
				// oxlint-disable-next-line unicorn/no-array-sort
				.sort();

		expect(paths(seedDocuments.dark)).toEqual(paths(seedDocuments.light));
	});

	/**
	 * `DTCG_FAMILY_TYPES` is the shared statement of which `$type` each family takes, and this
	 * serializer writes the `$type` literals out at each construction site so the token union
	 * narrows. Those are two independent statements of the same fact, so checking one against the
	 * other catches the drift that a single shared constant would hide.
	 *
	 * The count reconciliation is the half that catches a family nobody named: without it, a family
	 * emitted under a group path no row covers goes entirely unmeasured.
	 */
	it('types every token as the family table says, and emits no family the table does not name', () => {
		const mistyped = DTCG_FAMILY_TYPES.flatMap((row) =>
			walkTokens(nodeAt(seedDocuments.light, row.group), [...row.group])
				.filter((walked) => walked.token.$type !== row.type)
				.map(
					(walked) => `${walked.path.join('.')} is ${String(walked.token.$type)}, not ${row.type}`,
				),
		);

		expect(mistyped).toEqual([]);

		const counted = DTCG_FAMILY_TYPES.reduce(
			(total, row) => total + walkTokens(nodeAt(seedDocuments.light, row.group)).length,
			0,
		);

		expect(counted).toBe(walkTokens(seedDocuments.light).length);
	});

	it('keeps every family in the table present in both documents', () => {
		const missing = DTCG_FAMILY_TYPES.filter(
			(row) =>
				walkTokens(nodeAt(seedDocuments.light, row.group)).length === 0 ||
				walkTokens(nodeAt(seedDocuments.dark, row.group)).length === 0,
		).map((row) => row.family);

		expect(missing).toEqual([]);
	});

	it('puts the twelve primitive ramp steps in the document', () => {
		for (const scheme of ['light', 'dark'] as const) {
			const ramps = nodeAt(seedDocuments[scheme], ['color', 'primitive']) as Record<
				string,
				Record<string, unknown>
			>;

			expect(Object.keys(ramps)).toEqual(Object.keys(seedTokenSet.schemes[scheme].primitives));

			for (const steps of Object.values(ramps)) {
				expect(Object.keys(steps)).toEqual(
					Array.from({ length: 12 }, (_, index) => String(index + 1)),
				);
			}
		}
	});

	/**
	 * The ticket names this constraint outright: do not flatten through `resolveScheme`. A flattened
	 * semantic token would carry a literal colour object and still validate, so the check is that
	 * the `$value` is a reference and that the reference lands on a primitive that is really there.
	 */
	it('leaves every semantic colour an alias that resolves inside the same document', () => {
		for (const scheme of ['light', 'dark'] as const) {
			const semantic = nodeAt(seedDocuments[scheme], ['color', 'semantic']) as Record<
				string,
				Record<string, unknown>
			>;

			// Both key lists are fresh, and toSorted is ES2023 against an ES2022 target.
			// oxlint-disable-next-line unicorn/no-array-sort
			expect(Object.keys(semantic).sort()).toEqual(
				// oxlint-disable-next-line unicorn/no-array-sort
				Object.keys(seedTokenSet.schemes[scheme].semantic).sort(),
			);

			for (const [name, token] of Object.entries(semantic)) {
				const alias = token.$value;

				expect(typeof alias, `${scheme}.${name} was flattened to a literal`).toBe('string');
				expect(alias).toMatch(DTCG_ALIAS_PATTERN);

				const target = nodeAt(seedDocuments[scheme], fromDtcgAlias(alias as string));

				expect(isToken(target), `${scheme}.${name} points at nothing`).toBe(true);
				expect((target as Record<string, unknown>).$type).toBe('color');
			}
		}
	});

	it('carries the com.cambium payload on every token in both documents', () => {
		for (const scheme of ['light', 'dark'] as const) {
			const unpayloaded = walkTokens(seedDocuments[scheme])
				.filter((walked) => {
					const extensions = walked.token.$extensions as Record<string, unknown> | undefined;
					const payload = extensions?.[CAMBIUM_NAMESPACE] as { rationale?: unknown } | undefined;

					return typeof payload?.rationale !== 'string';
				})
				.map((walked) => walked.path.join('.'));

			expect(unpayloaded).toEqual([]);
		}
	});

	/**
	 * Shape only. The hex has to be the bytes `renderedContrast` gated on, and recomputing it here
	 * with `toSrgbHex` would grade the serializer with the function it calls. The values themselves
	 * are pinned against the fixture's hand-computed hexes above, so what is left for the seed set
	 * is that no colour reached a document without one.
	 */
	it('puts a six-digit hex on every colour, the one inside a shadow included', () => {
		const hexless = walkTokens(seedDocuments.light)
			.concat(walkTokens(seedDocuments.dark))
			.flatMap((walked) => {
				const value = walked.token.$value;
				// A semantic colour's `$value` is an alias string and carries no components to take a
				// hex from; every other colour, and the one inside a shadow, does.
				const color =
					walked.token.$type === 'shadow'
						? (value as Record<string, unknown>).color
						: walked.token.$type === 'color' && typeof value === 'object'
							? value
							: undefined;

				if (color === undefined) return [];

				return /^#[0-9a-f]{6}$/.test(String((color as Record<string, unknown>).hex))
					? []
					: [walked.path.join('.')];
			});

		expect(hexless).toEqual([]);
	});

	it('rides the em unit of every tracking token in the transport namespace', () => {
		const tracking = nodeAt(seedDocuments.light, ['tracking']) as Record<
			string,
			Record<string, unknown>
		>;

		expect(Object.keys(tracking)).toEqual(Object.keys(seedTokenSet.tracking.values));

		for (const [name, token] of Object.entries(tracking)) {
			expect(token.$type).toBe('number');
			expect(token.$value).toBe(seedTokenSet.tracking.values[name].value);
			expect((token.$extensions as Record<string, unknown>)[CAMBIUM_DTCG_NAMESPACE]).toEqual({
				unit: 'em',
			});
		}
	});

	/**
	 * A `rem` tracking value is a value this pipeline has never produced, and the ruling is that it
	 * must fail loudly rather than round-trip as an em. The deserializer reads the unit back out of
	 * the transport namespace, so a silent pass here would change the number's meaning.
	 */
	it('refuses a tracking value that is not in em', () => {
		const set = TokenSetSchema.parse(SPEC_TOKEN_SET);

		set.tracking.values.tight.unit = 'rem';

		expect(() => serializeDtcg(set)).toThrow(/tracking/);
	});

	/**
	 * `TokenSet` is Zod's output type, so a hand-built object the compiler accepts can still carry
	 * a hue of exactly 360 that `OklchChannelsSchema`'s transform would have folded to 0, and the
	 * schema's `hueComponent` is `exclusiveMaximum: 360`. That the parse ran is observable exactly
	 * here: the emitted component is 0.
	 */
	it('parses its argument, so an unfolded hue of 360 reaches the document as 0', () => {
		const set = structuredClone(SPEC_TOKEN_SET) as TokenSet;

		set.primitives.brand[0].h = 360;
		set.schemes.light.primitives.brand[0].h = 360;

		const { light } = serializeDtcg(set);
		const step = nodeAt(light, ['color', 'primitive', 'brand', '1']) as Record<string, unknown>;

		expect((step.$value as { components: number[] }).components[2]).toBe(0);
		expect(violationLines(light)).toEqual([]);
	});

	it('rejects a token set that does not parse rather than emitting a document', () => {
		const set = structuredClone(SPEC_TOKEN_SET) as TokenSet;

		set.primitives.brand[0].l = 4;

		expect(() => serializeDtcg(set)).toThrow(/primitives/);
	});

	/**
	 * `checkMirroredLayers` exempts a foreign `$extensions` namespace from the mirror, so the two
	 * copies of the light scheme may legally carry different annotations, and `core/token-set.ts`
	 * hands the adapter the job of resolving that. The union is the honest reading: both copies are
	 * the same token written twice, so an annotation on either one is an annotation on the token.
	 */
	it('unions a foreign annotation the mirror carries on only one copy', () => {
		const set = TokenSetSchema.parse(SPEC_TOKEN_SET);
		const annotation = { note: 'seen by a tool that walked the top level' };

		(set.primitives.brand[0].$extensions as Record<string, unknown>)['com.example'] = annotation;

		const { light } = serializeDtcg(set);
		const step = nodeAt(light, ['color', 'primitive', 'brand', '1']) as Record<string, unknown>;

		expect((step.$extensions as Record<string, unknown>)['com.example']).toEqual(annotation);
		expect((step.$extensions as Record<string, unknown>)[CAMBIUM_NAMESPACE]).toEqual(
			set.primitives.brand[0].$extensions[CAMBIUM_NAMESPACE],
		);
	});

	it('refuses a mirror whose two copies disagree about one foreign namespace', () => {
		const set = TokenSetSchema.parse(SPEC_TOKEN_SET);

		(set.primitives.brand[0].$extensions as Record<string, unknown>)['com.example'] = { note: 'a' };
		(set.schemes.light.primitives.brand[0].$extensions as Record<string, unknown>)['com.example'] =
			{ note: 'b' };

		expect(() => serializeDtcg(set)).toThrow(/com\.example/);
	});

	/**
	 * Every family keys its tokens by `z.record(z.string().min(1), ...)`, so a dot, a brace or a
	 * leading `$` in a token name parses, persists, and only becomes wrong when DTCG reads it. The
	 * `TokenSetSchema` assertion in each case below is load-bearing: without it, a set that failed
	 * to parse would throw for an unrelated reason and the case would pass having measured nothing.
	 *
	 * What is asserted is that the guard fires and names the key. Asserting instead that the
	 * document comes back schema-invalid would grade the published schema, which needs no help from
	 * this file, and would keep passing if the guard were deleted tomorrow.
	 */
	it('refuses a non-colour token name DTCG forbids', () => {
		const set = structuredClone(SPEC_TOKEN_SET) as TokenSet;

		set.radius.values['compact.md'] = set.radius.values.md;

		expect(TokenSetSchema.safeParse(set).success).toBe(true);
		expect(() => serializeDtcg(set)).toThrow(/compact\.md/);
	});

	it('refuses a semantic token name DTCG forbids', () => {
		const set = structuredClone(SPEC_TOKEN_SET) as TokenSet;

		// Both copies, because `checkMirroredLayers` wants the top level to equal `schemes.light`.
		// The clone may already share one object between them, in which case the second write is a
		// no-op; writing both is what keeps this case honest if that ever stops being true.
		set.semantic.$primary = set.semantic.primary;
		set.schemes.light.semantic.$primary = set.schemes.light.semantic.primary;

		expect(TokenSetSchema.safeParse(set).success).toBe(true);
		expect(() => serializeDtcg(set)).toThrow(/\$primary/);
	});

	/**
	 * The plan's rule is that `com.cambium.dtcg` never appears in a `TokenSet`, because
	 * serialization invents it and the deserializer strips it again. A set carrying one is malformed
	 * by that rule, and overwriting it in `trackingToken` would lose the original payload silently:
	 * the round trip would come back deep-unequal with nothing naming the token that lost data.
	 */
	it('refuses a token set that already carries the reserved transport namespace', () => {
		const set = structuredClone(SPEC_TOKEN_SET) as TokenSet;

		(set.tracking.values.tight.$extensions as Record<string, unknown>)[CAMBIUM_DTCG_NAMESPACE] = {
			unit: 'em',
		};

		expect(TokenSetSchema.safeParse(set).success).toBe(true);
		expect(() => serializeDtcg(set)).toThrow(/tracking.*com\.cambium\.dtcg/);
	});

	it('is deterministic: the same token set serializes to the same bytes', () => {
		const first = JSON.stringify(serializeDtcg(seedTokenSet));
		const second = JSON.stringify(serializeDtcg(structuredClone(seedTokenSet)));

		expect(second).toBe(first);
	});

	/**
	 * A JSON round trip of the input is the one reordering a stored token set really takes, and it
	 * must not move a byte in the output. Ramp steps survive it for free (`"1"` through `"12"` are
	 * integer-like keys, and every JS engine emits those ascending ahead of the string keys), so
	 * what this actually measures is the families whose names are not numbers.
	 */
	it('is deterministic across a JSON round trip of its argument', () => {
		const reparsed = JSON.parse(JSON.stringify(seedTokenSet)) as TokenSet;

		expect(JSON.stringify(serializeDtcg(reparsed))).toBe(
			JSON.stringify(serializeDtcg(seedTokenSet)),
		);
	});

	/**
	 * Renamed from "does not touch the token set it was given", which oversold it. It pins the
	 * inbound half of purity only: that the act of serializing writes nothing back. The outbound
	 * half, that the returned documents do not alias the set, is a separate property and the case
	 * below is the one that holds it. Both halves are worth pinning, so this one stays.
	 */
	it('writes nothing back to the token set while serializing it', () => {
		const before = JSON.stringify(seedTokenSet);

		serializeDtcg(seedTokenSet);

		expect(JSON.stringify(seedTokenSet)).toBe(before);
	});

	/**
	 * `TokenSetSchema.parse` rebuilds the structure it knows and passes an unrecognised
	 * `$extensions` key through by reference, so before the exit clone a foreign payload was one
	 * object shared by the caller's set and the document built from it. Nothing this pipeline
	 * produces carries such a payload, which is why the seed set cannot exercise this and the
	 * fixture has to be annotated first.
	 *
	 * The mutations below go through the document, deep, at the places that aliased: inside a
	 * foreign payload, inside Cambium's own payload, and into an easing tuple. The assertion is on
	 * the token set, because that is what must not have moved.
	 */
	it('returns documents that share no object with the token set', () => {
		const set = structuredClone(SPEC_TOKEN_SET) as TokenSet;

		// Two separate objects of equal content, not one written twice: the mirror check compares
		// these by value, and sharing one here would hide an aliasing bug rather than expose it.
		(set.primitives.brand[0].$extensions as Record<string, unknown>)['com.acme'] = {
			audit: { reviewer: 'original' },
		};
		(set.schemes.light.primitives.brand[0].$extensions as Record<string, unknown>)['com.acme'] = {
			audit: { reviewer: 'original' },
		};

		const before = JSON.stringify(set);
		const { light } = serializeDtcg(set);
		const extensions = nodeAt(light, ['color', 'primitive', 'brand', '1', '$extensions']) as Record<
			string,
			unknown
		>;

		(extensions['com.acme'] as { audit: { reviewer: string } }).audit.reviewer =
			'edited through the document';
		(extensions[CAMBIUM_NAMESPACE] as { rationale: string }).rationale = 'edited';
		(nodeAt(light, ['motion', 'easing', 'standard']) as { $value: number[] }).$value[0] = 99;

		expect(JSON.stringify(set)).toBe(before);
	});

	/**
	 * The eight non-colour families are one copy on the token set written into both documents, so
	 * the values touched below are the ones that aliased across the pair before the exit clone.
	 * Editing light's easing used to edit dark's, which no caller would expect of two documents
	 * handed over as separate values.
	 */
	it('returns a light and a dark document that share no object with each other', () => {
		const { light, dark } = serializeDtcg(seedTokenSet);
		const darkBefore = JSON.stringify(dark);

		(nodeAt(light, ['motion', 'easing', 'standard']) as { $value: number[] }).$value[0] = 99;
		(nodeAt(light, ['radius', 'md', '$extensions']) as Record<string, unknown>).edited = true;

		expect(JSON.stringify(dark)).toBe(darkBefore);
	});
});
