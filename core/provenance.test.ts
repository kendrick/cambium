import { describe, expect, it } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { type BrandSeed, BrandSeedSchema } from './brand-seed';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { CAMBIUM_NAMESPACE, derived, invented, observed } from './provenance';
import { BALANCED } from './interpretation';
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

/**
 * A seed that states a neutral temperature and no shadow character, which is the one combination
 * neither seed above reaches.
 *
 * `STATED_SEED` states both fields and `KEYLESS_SEED` states neither, so both take a shadow branch
 * that answers `keyColors` either by naming it or by inheriting it. Only this shape makes the
 * surface trace somewhere else, and it is where a shadow claiming `keyColors` outright was wrong
 * for five review rounds without a test noticing. A regression in the handoff from the semantic
 * layer through `deriveNonColor` to the shadow is invisible to every other seed in this file.
 */
const MIXED_SEED = BrandSeedSchema.parse({
	...STATED_SEED,
	neutralTemperature: { hue: 120, chroma: 0.02 },
	shadowCharacter: null,
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

/** The smallest record `BrandRecordSchema` accepts, wrapped around whatever token set it is given. */
function recordHolding(tokenSet: unknown) {
	return {
		id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
		schemaVersion: SCHEMA_VERSION,
		revision: 1,
		images: [{ id: 'img-1', downscaled: 'data:image/webp;base64,AA', originalHash: 'sha256:a' }],
		versions: [
			{
				createdAt: '2026-09-16T12:00:00.000Z',
				ordinal: 1,
				seed: STATED_SEED,
				tokenSet,
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
}

/**
 * A namespace Cambium does not understand, shaped like the things most likely to be lost quietly:
 * a nested object, an array, and a null.
 */
const FOREIGN = {
	note: 'hand-authored by another tool',
	weights: [1, 2, 3],
	nested: { deep: true, absent: null },
};

/**
 * `set` with a foreign namespace planted on the first brand step of whichever copies `on` names.
 *
 * The top level and `schemes.light` hold the same tokens twice, and a foreign tool has no way to
 * learn that, so annotating one copy is the ordinary outcome of walking a Cambium file.
 */
function plantForeign(set: TokenSet, on: 'top' | 'light' | 'both'): unknown {
	const annotate = (layer: TokenSet['schemes']['light'] | TokenSet) => ({
		...layer.primitives,
		brand: [
			{
				...layer.primitives.brand![0]!,
				$extensions: { ...layer.primitives.brand![0]!.$extensions, 'com.someothertool': FOREIGN },
			},
			...layer.primitives.brand!.slice(1),
		],
	});

	const light =
		on === 'light' || on === 'both'
			? { ...set.schemes.light, primitives: annotate(set.schemes.light) }
			: set.schemes.light;

	return {
		...set,
		primitives: on === 'top' || on === 'both' ? annotate(set) : set.primitives,
		schemes: { ...set.schemes, light },
	};
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
	 * The three categories that genuinely fall back to a module constant. Each is `derived` on its
	 * own seed field when the seed stated it, and `invented` when it did not, because nothing in the
	 * seed reaches the fallback. Shadow used to sit here and no longer does: its tint traces to the
	 * brand key colour even with no character stated, so it moved to the table below.
	 */
	it.each([
		['radius', (set: TokenSet) => set.radius.values.lg, 'radiusCharacter'],
		['type scale', (set: TokenSet) => set.typography.values.size.lg, 'typeScaleRatio'],
		['tracking', (set: TokenSet) => set.tracking.values.normal, 'trackingFeel'],
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
	 * A token names the field its value traces to, not the field that was absent. Both rows below
	 * fall back, and both fall back onto the brand key colour rather than onto a constant, so both
	 * are derived from `keyColors`. The comment on #9 originally ruled the neutral row invented; an
	 * amendment on that issue records why it was overturned.
	 */
	it.each([
		['neutral ramp', (set: TokenSet) => set.primitives.neutral?.[5], 'neutralTemperature'],
		['accent ramp', (set: TokenSet) => set.primitives.accent?.[5], 'keyColors'],
		['shadow', (set: TokenSet) => set.shadow.values.md, 'shadowCharacter'],
	])('derives a fallback %s from the brand key colour', (_name, read, statedField) => {
		expect(payloadOf(read(tokenSetFor(KEYLESS_SEED)))).toMatchObject({
			provenance: 'derived',
			seedField: 'keyColors',
		});
		expect(payloadOf(read(tokenSetFor(STATED_SEED)))).toMatchObject({
			provenance: 'derived',
			seedField: statedField,
		});
	});

	/**
	 * The full pipeline, not the module in isolation. `core/shadow-scale.test.ts` hands `shadowScale`
	 * a surface it built itself, so it proves the inheritance and not the wiring that feeds it. This
	 * runs the real chain: the neutral ramp takes the stated temperature, `background` inherits it
	 * through the semantic layer, `deriveNonColor` resolves that token, and the shadow carries it.
	 * Breaking any link hard-codes a seed field and this is the only test that sees it.
	 */
	it('carries a stated neutral temperature through the semantic layer into the shadow', () => {
		const set = tokenSetFor(MIXED_SEED);

		expect(payloadOf(set.semantic.background)).toMatchObject({ seedField: 'neutralTemperature' });
		expect(payloadOf(set.shadow.values.md)).toMatchObject({
			provenance: 'derived',
			seedField: 'neutralTemperature',
		});
		// The sentence has to name the field too, because nothing else asserts rationale prose.
		expect(payloadOf(set.shadow.values.md).rationale).toContain('neutralTemperature');
	});

	/** Step 9 is the one place a seed's own colour is placed rather than computed from. */
	it('observes an accent the seed placed and derives one it rotated', () => {
		expect(payloadOf(tokenSetFor(STATED_SEED).primitives.accent?.[8])).toMatchObject({
			provenance: 'observed',
			seedField: 'keyColors',
		});
		expect(payloadOf(tokenSetFor(KEYLESS_SEED).primitives.accent?.[8])).toMatchObject({
			provenance: 'derived',
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
		const foreign = FOREIGN;
		const parsed = TokenSetSchema.parse(plantForeign(tokenSetFor(STATED_SEED), 'both'));

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

	/**
	 * The mirror's foreign-data policy, which is the surprising half of `checkMirroredLayers`.
	 *
	 * A tool walking a Cambium file cannot know the top level repeats `schemes.light`, so annotating
	 * one copy is the ordinary outcome and has to parse. Asserted on both sides: the annotated copy
	 * keeps the bytes, and the copy nobody touched is left alone rather than back-filled.
	 */
	it.each([['top'], ['light']] as const)(
		'accepts a foreign namespace on the %s copy alone and leaves the other untouched',
		(on) => {
			const parsed = TokenSetSchema.parse(plantForeign(tokenSetFor(STATED_SEED), on));
			const annotated = on === 'top' ? parsed.primitives : parsed.schemes.light.primitives;
			const untouched = on === 'top' ? parsed.schemes.light.primitives : parsed.primitives;

			expect(foreignBytes(annotated.brand![0]!)).toBe(JSON.stringify(FOREIGN));
			expect(foreignBytes(untouched.brand![0]!)).toBeUndefined();
		},
	);

	/**
	 * The half of the mirror that did not move. Cambium's own payload describes one derivation, so
	 * two copies disagreeing about it is corruption of data this pipeline wrote, and a value that
	 * differs across the mirror still means two light themes from one file.
	 */
	it.each([
		[
			'our own provenance disagrees across the mirror',
			(set: TokenSet) => ({
				...set,
				primitives: {
					...set.primitives,
					brand: [
						{
							...set.primitives.brand![0]!,
							$extensions: {
								[CAMBIUM_NAMESPACE]: invented('nothing reached this')[CAMBIUM_NAMESPACE],
							},
						},
						...set.primitives.brand!.slice(1),
					],
				},
			}),
		],
		[
			'a value disagrees across the mirror',
			(set: TokenSet) => ({
				...set,
				primitives: {
					...set.primitives,
					brand: [{ ...set.primitives.brand![0]!, l: 0.5 }, ...set.primitives.brand!.slice(1)],
				},
			}),
		],
	])('still rejects a set where %s', (_name, diverge) => {
		expect(TokenSetSchema.safeParse(diverge(tokenSetFor(STATED_SEED))).success).toBe(false);
	});

	/**
	 * The persistence path with a token set actually in it. Every storage and state fixture in the
	 * repo sets `tokenSet: null`, so nothing else carries extensions through a record, and
	 * `structuredClone` is what an IndexedDB write uses rather than JSON.
	 */
	it('carries a foreign namespace through a stored record and a structured clone', () => {
		const stored = recordHolding(plantForeign(tokenSetFor(STATED_SEED), 'top'));
		const parsed = BrandRecordSchema.parse(stored);
		const read = (record: typeof parsed) =>
			foreignBytes(record.versions[0]!.tokenSet!.primitives.brand![0]!);

		expect(read(parsed)).toBe(JSON.stringify(FOREIGN));
		expect(read(BrandRecordSchema.parse(structuredClone(parsed)))).toBe(JSON.stringify(FOREIGN));
		expect(read(BrandRecordSchema.parse(JSON.parse(JSON.stringify(parsed))))).toBe(
			JSON.stringify(FOREIGN),
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
		const record = recordHolding(tokenSetFor(STATED_SEED));

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
