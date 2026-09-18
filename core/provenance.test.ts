import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { type BrandSeed, BrandSeedSchema } from './brand-seed';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { CAMBIUM_NAMESPACE, derived, invented, observed } from './provenance';
import { BALANCED } from './scale-engine';
import { buildTokenSet } from './semantic-layer';
import { type TokenExtensions, type TokenSet, TokenSetSchema } from './token-set';

/**
 * One brand key colour and nothing else, which is exactly what a keyless read produces. Most of
 * what a token set derives from this is invented rather than observed, and that gap is what #9
 * exists to show. `app/readers/local-reader.test.ts` asserts the same rule against a seed the
 * extractor actually produced.
 */
const KEYLESS_SEED = BrandSeedSchema.parse({
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
	imageClassifications: null,
	expressive: null,
});

/**
 * The same seed with every field a model reader fills actually filled, so the `derived` half of
 * each rule has something to be asserted against. Either seed alone passes against a module that
 * ignores its input and returns one provenance value unconditionally.
 */
const STATED_SEED = BrandSeedSchema.parse({
	...KEYLESS_SEED,
	keyColors: [
		...KEYLESS_SEED.keyColors!,
		{ oklch: [0.7, 0.16, 35], proposedRole: 'accent', sourceImageId: 'img-1', sourceRegion: null },
	],
	neutralTemperature: { hue: 259.8, chroma: 0.006 },
	radiusCharacter: { base: 12, progression: 'soft' },
	shadowCharacter: { spread: 'diffuse', tintFromSurface: true },
	trackingFeel: 'wide',
	typeScaleRatio: 1.25,
});

function tokenSetFor(seed: BrandSeed): TokenSet {
	const generated = createOklchScaleEngine().generate(seed, BALANCED);

	if (!generated.ok) throw new Error('both fixture seeds have to ramp');

	return buildTokenSet(generated.schemes, seed);
}

/** How many `com.cambium` payloads a serialized token set holds, which is what a strip would drop. */
function countPayloads(json: string): number {
	return json.match(/com\.cambium/g)?.length ?? 0;
}

/** A foreign namespace as stored bytes, which is what "preserved unchanged" has to mean. */
function foreignBytes(token: unknown): string {
	return JSON.stringify(
		(token as { $extensions: Record<string, unknown> }).$extensions['com.someothertool'],
	);
}

/** Reads the payload off a token, failing loudly rather than asserting against `undefined`. */
function payloadOf(token: { $extensions: TokenExtensions } | undefined) {
	if (!token) throw new Error('nothing at that token path');

	return token.$extensions[CAMBIUM_NAMESPACE];
}

/**
 * Provenance is a property of the token set, so it is asserted against a set the pipeline actually
 * produced: the scale engine feeding `buildTokenSet`. Running these against a hand-built set would
 * let the schema and the derivations agree with each other while the pipeline emitted something
 * else entirely.
 */
describe('token provenance', () => {
	/**
	 * The schema requires `$extensions` on every token, so a clean parse is the whole of "every
	 * token carries all three fields". Checked that way rather than by re-walking the structure,
	 * which would leave two definitions of what counts as a token free to disagree.
	 */
	it.each([
		['a keyless seed', KEYLESS_SEED],
		['a fully stated seed', STATED_SEED],
	])('gives every token in a set from %s a payload the schema accepts', (_name, seed) => {
		expect(TokenSetSchema.safeParse(tokenSetFor(seed)).success).toBe(true);
	});

	/**
	 * One token of each of the three kinds, named rather than counted. A count passes on a set that
	 * classified the wrong tokens, and these three are the cases the rules turn on: step 9 is the
	 * seed's own colour placed directly, step 6 is that colour run through the curve, and a z-index
	 * is a number the schema required that no seed could ever inform.
	 */
	it('tells a placed key colour, a curve step, and a system constant apart', () => {
		const set = tokenSetFor(KEYLESS_SEED);

		expect(payloadOf(set.primitives.brand?.[8])).toMatchObject({
			provenance: 'observed',
			seedField: 'keyColors',
		});
		expect(payloadOf(set.primitives.brand?.[5])).toMatchObject({
			provenance: 'derived',
			seedField: 'keyColors',
		});
		expect(payloadOf(set.zIndex.values.modal)).toMatchObject({
			provenance: 'invented',
			seedField: null,
		});
	});

	/**
	 * A semantic token inherits the provenance of the step it resolves to, because the value a
	 * stylesheet reads through `--primary` is that step's value. The three below alias an observed
	 * step, a derived one, and a step of a ramp no seed field reached.
	 */
	it('gives a semantic token the provenance of the step it aliases', () => {
		const set = tokenSetFor(KEYLESS_SEED);

		expect(payloadOf(set.semantic.primary)).toMatchObject({ provenance: 'observed' });
		expect(payloadOf(set.semantic.ring)).toMatchObject({ provenance: 'derived' });
		expect(payloadOf(set.semantic.destructive)).toMatchObject({
			provenance: 'invented',
			seedField: null,
		});
	});

	/**
	 * The rule the whole table generalises: a category is `derived` on the seed field that governs
	 * it when that field was stated, and `invented` when the field was null and the module
	 * substituted a value of its own.
	 */
	it.each([
		['radius', (set: TokenSet) => set.radius.values.lg, 'radiusCharacter'],
		['type scale', (set: TokenSet) => set.typography.values.size.base, 'typeScaleRatio'],
		['tracking', (set: TokenSet) => set.tracking.values.normal, 'trackingFeel'],
		['shadow', (set: TokenSet) => set.shadow.values.md, 'shadowCharacter'],
	])('marks %s against the seed field that governs it', (_name, read, seedField) => {
		expect(payloadOf(read(tokenSetFor(STATED_SEED)))).toMatchObject({
			provenance: 'derived',
			seedField,
		});
		expect(payloadOf(read(tokenSetFor(KEYLESS_SEED)))).toMatchObject({
			provenance: 'invented',
			seedField: null,
		});
	});

	/**
	 * The case the comment on #9 rules on directly. `neutralAnchor` treats a stated temperature as
	 * evidence and overrides its own tinting parameter, so a keyless read leaves the field null on
	 * purpose, and the tint the engine substitutes is the engine's rather than the brand's.
	 */
	it('marks a neutral ramp invented when the seed stated no temperature', () => {
		expect(payloadOf(tokenSetFor(KEYLESS_SEED).primitives.neutral?.[5])).toMatchObject({
			provenance: 'invented',
			seedField: null,
		});
		expect(payloadOf(tokenSetFor(STATED_SEED).primitives.neutral?.[5])).toMatchObject({
			provenance: 'derived',
			seedField: 'neutralTemperature',
		});
	});

	/** An accent the image offered is placed the way the brand is. A rotated one was nobody's colour. */
	it('marks a rotated accent invented and an extracted one observed', () => {
		expect(payloadOf(tokenSetFor(KEYLESS_SEED).primitives.accent?.[8])).toMatchObject({
			provenance: 'invented',
			seedField: null,
		});
		expect(payloadOf(tokenSetFor(STATED_SEED).primitives.accent?.[8])).toMatchObject({
			provenance: 'observed',
			seedField: 'keyColors',
		});
	});

	/**
	 * Zod strips unknown keys rather than erroring, which is precisely how this ticket fails
	 * silently: the payload sits on the in-memory object, satisfies every assertion above, and
	 * vanishes on the way to disk. So the round trip is a real `JSON.stringify` and a real reparse,
	 * and the payload count is compared rather than the presence of any payload at all.
	 */
	it('survives a JSON round trip with every payload intact', () => {
		const serialized = JSON.stringify(tokenSetFor(STATED_SEED));
		const round = JSON.parse(serialized);

		expect(TokenSetSchema.safeParse(round).success).toBe(true);
		expect(countPayloads(serialized)).toBeGreaterThan(0);
		expect(countPayloads(JSON.stringify(round))).toBe(countPayloads(serialized));
	});

	/**
	 * DTCG section 5.2.3: "Tools that process design token files MUST preserve any extension data
	 * they do not themselves understand." `docs/research/oss-landscape.md:578` records it, and adds
	 * that a round trip must not drop foreign keys.
	 *
	 * Byte-identical rather than deep-equal, and through both serializations. `JSON.stringify` is
	 * what an export archive goes through; `structuredClone` is what an IndexedDB write goes
	 * through, and it is the one no earlier round-trip test touched. A foreign namespace holding a
	 * nested object, an array and a null is the shape most likely to lose something quietly on
	 * either path.
	 */
	it('preserves a namespace it does not understand through both round trips', () => {
		const foreign = {
			note: 'hand-authored by another tool',
			weights: [1, 2, 3],
			nested: { deep: true, absent: null },
		};
		const set = tokenSetFor(STATED_SEED);
		const step = {
			...set.primitives.brand![0]!,
			$extensions: { ...set.primitives.brand![0]!.$extensions, 'com.someothertool': foreign },
		};
		const layer = {
			...set.schemes.light,
			primitives: { ...set.primitives, brand: [step, ...set.primitives.brand!.slice(1)] },
		};
		const withForeign = { ...set, ...layer, schemes: { light: layer, dark: layer } };

		const parsed = TokenSetSchema.parse(withForeign);

		// Parsing alone drops it if the schema is strict about the namespace, so this is the
		// assertion the old shape could not have passed at all.
		expect(foreignBytes(parsed.primitives.brand![0]!)).toBe(JSON.stringify(foreign));
		expect(
			foreignBytes(TokenSetSchema.parse(JSON.parse(JSON.stringify(parsed))).primitives.brand![0]!),
		).toBe(JSON.stringify(foreign));
		expect(foreignBytes(TokenSetSchema.parse(structuredClone(parsed)).primitives.brand![0]!)).toBe(
			JSON.stringify(foreign),
		);
	});

	/** Our own payload still has to be there and still has to be well formed beside a foreign one. */
	it('still requires its own namespace when a foreign one sits beside it', () => {
		const set = tokenSetFor(STATED_SEED);
		const step = {
			...set.primitives.brand![0]!,
			$extensions: { 'com.someothertool': { note: 'only theirs' } },
		};
		const layer = {
			...set.schemes.light,
			primitives: { ...set.primitives, brand: [step, ...set.primitives.brand!.slice(1)] },
		};

		expect(
			TokenSetSchema.safeParse({ ...set, ...layer, schemes: { light: layer, dark: layer } })
				.success,
		).toBe(false);
	});

	/** The export archive is the only migration path, so the payload has to clear the record too. */
	it('parses inside a stored record at the current schema version', () => {
		const image = {
			id: 'img-1',
			downscaled: 'data:image/webp;base64,AA',
			originalHash: 'sha256:a',
		};
		const record = {
			id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
			schemaVersion: SCHEMA_VERSION,
			images: [image],
			versions: [
				{
					createdAt: '2026-09-16T12:00:00.000Z',
					ordinal: 1,
					seed: STATED_SEED,
					tokenSet: tokenSetFor(STATED_SEED),
					provider: 'anthropic',
					model: 'claude-opus-5',
					promptVersion: 'seed-v3',
					rawResponse: '{"keyColors":[{"proposedRole":"brand"}]}',
					scaleEngine: 'cambium-oklch-1',
					fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
					interpretation: 'balanced',
				},
			],
		};

		expect(BrandRecordSchema.safeParse(JSON.parse(JSON.stringify(record))).success).toBe(true);
	});

	/**
	 * Provenance is computed from the derivation graph and nothing else, which is what rules out a
	 * model opinion. A clock, a random source, or a model call would all surface here as two runs
	 * of one seed disagreeing.
	 */
	it('produces identical payloads for identical seeds', () => {
		expect(JSON.stringify(tokenSetFor(STATED_SEED))).toBe(JSON.stringify(tokenSetFor(STATED_SEED)));
	});
});

/**
 * The builders exist so the namespace is spelled once. Seven modules attach payloads, and a typo in
 * any one of them ships a token set that parses everywhere except at the single key every
 * downstream DTCG tool reads.
 */
describe('the provenance builders', () => {
	it('namespaces every payload under com.cambium and nothing else', () => {
		expect(Object.keys(observed('keyColors', 'places the brand key colour'))).toEqual([
			CAMBIUM_NAMESPACE,
		]);
	});

	it.each([
		[observed('keyColors', 'places the brand key colour'), 'observed', 'keyColors'],
		[derived('trackingFeel', 'shifts the whole scale by half a step'), 'derived', 'trackingFeel'],
		[invented('the schema requires a modal layer and no seed measures one'), 'invented', null],
	])('carries the seed field on %#', (built, provenance, seedField) => {
		expect(built[CAMBIUM_NAMESPACE]).toMatchObject({ provenance, seedField });
	});
});
