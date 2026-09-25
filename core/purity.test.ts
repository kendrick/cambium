import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrandRecordSchema, SCHEMA_VERSION } from './brand-record';
import { BrandSeedSchema } from './brand-seed';
import { cssNaming, toGlobalsCss } from './css/globals-css';
import { scalarDeclarations, schemeDeclarations } from './css/scheme-declarations';
import { toStylesheet } from './css/stylesheet';
import { toDarkThemeLayer, toThemeBlock } from './css/theme-block';
import { SPEC_TOKEN_SET } from './dtcg/dtcg.fixture';
import { deserializeDtcg } from './dtcg/deserialize';
import { summarizeViolations } from './dtcg/report';
import { serializeDtcg } from './dtcg/serialize';
import { validateDtcg } from './dtcg/validate';
import { deriveNonColor } from './derive-non-color';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { radiusScale } from './radius-scale';
import { resolveCandidatePool } from './font-table';
import { shadowScale } from './shadow-scale';
import { systemConstants } from './system-constants';
import { trackingScale } from './tracking-scale';
import { typeScale } from './type-scale';
import { parseSeed } from './parse-seed';
import { CAMBIUM_NAMESPACE, derived, invented, observed } from './provenance';
import { rankFonts } from './rank-fonts';
import { BALANCED } from './interpretation';
import { buildTokenSet } from './semantic-layer';
import { NON_COLOR_FIXTURE, SHADOW_FIXTURE } from './token-set.fixture';
import { TokenSetSchema } from './token-set';

/** Reused wherever this file needs a token to carry provenance and nothing about which. */
const extensions = derived('keyColors', 'exercises a schema bound rather than a real derivation');

const ramp = Array.from({ length: 12 }, (_, i) => ({
	step: i + 1,
	l: 0.05 + i * 0.08,
	c: 0.05,
	h: 259.8,
	$extensions: extensions,
}));
const shadow = SHADOW_FIXTURE;
const layer = {
	primitives: { brand: ramp },
	semantic: { border: { alias: 'brand.6', $extensions: extensions } },
	shadow,
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

const tokenSet = {
	...layer,
	schemes: { light: layer, dark: layer },
	...NON_COLOR_FIXTURE,
};

/**
 * `tokenSet` re-read through the schema, for the `core/css/` adapters below: they take a `TokenSet`
 * with mutable tuple fields, and `NON_COLOR_FIXTURE`'s `as const` leaves `tokenSet` itself carrying
 * `readonly` ones, `motion.values.easing.standard.value` among them. `css.fixture.ts`'s `PINNED_SET`
 * takes the same route for the same reason.
 */
const cssTokenSet = TokenSetSchema.parse(tokenSet);

const rawResponse = {
	raw: JSON.stringify(seed),
	provider: 'anthropic',
	model: 'claude-opus-5',
	promptVersion: 'seed-v4',
};

const dtcgDocument = {
	color: {
		$type: 'color',
		brand: { $value: { colorSpace: 'oklch', components: [0.62, 0.19, 259.8], alpha: 1 } },
	},
};

/**
 * A hue of 360 is the one value the vendored schema is stricter about than every parser in the
 * survey (see `validator.test.ts`), and it fans out to nineteen diagnostics across six pointers.
 * `summarizeViolations` needs that real fallout to fold, not a hand-built violation array, which
 * is the one shape of input that would let a broken fold pass unnoticed.
 */
const brokenHueDocument = {
	color: {
		brand: { $type: 'color', $value: { colorSpace: 'oklch', components: [0.62, 0.19, 360] } },
	},
};

/** Walks a serialized DTCG document the same way `serialize.test.ts`'s `nodeAt` does. */
function nodeAt(document: unknown, path: readonly string[]): unknown {
	return path.reduce<unknown>(
		(node, segment) =>
			typeof node === 'object' && node !== null
				? (node as Record<string, unknown>)[segment]
				: undefined,
		document,
	);
}

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
			promptVersion: 'seed-v4',
			rawResponse: '{"keyColors":[{"proposedRole":"brand"}]}',
			scaleEngine: 'cambium-oklch-1',
			fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
			interpretation: 'balanced',
			overrides: [],
		},
	],
};

const fontTable = [{ family: 'Geo Sans', tag: '/Sans/Geometric', score: 100 }];

// The `seed` above classifies no type, and a seed with none is the one input `rankFonts` refuses.
const rankableSeed = BrandSeedSchema.parse({
	...seed,
	typeClassification: {
		category: 'sans',
		tone: 'geometric',
		xHeight: 'medium',
		displayDiffersFromBody: true,
	},
});

// `seed` already carries the one brand key colour a scale engine needs, so it needs no widening
// the way `rankableSeed` did.
const rampableSeed = BrandSeedSchema.parse(seed);

/**
 * Stage 2 stays free of DOM and browser APIs so it can run server-side unchanged, which the
 * headless generate CLI depends on.
 *
 * The guard has to parse values that are actually valid. Feeding a schema a string fails at
 * the outer object check and never walks a single field, so a network call buried in a
 * refinement would leave the test green. `fetch` is a live global under Node, so absence
 * cannot be asserted the way it can for `document`; stubbing it to throw is what turns a
 * stray call into a failure.
 *
 * Nothing discovers a new entry in the table below, so a module added to the pure core is
 * guarded here only if someone adds it.
 */
describe('core purity', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('runs where no browser global exists', () => {
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');
		expect(typeof localStorage).toBe('undefined');
	});

	it.each([
		['BrandSeedSchema', () => BrandSeedSchema.safeParse(seed).success],
		['TokenSetSchema', () => TokenSetSchema.safeParse(tokenSet).success],
		['BrandRecordSchema', () => BrandRecordSchema.safeParse(record).success],
		['the DTCG format validator', () => validateDtcg(dtcgDocument).valid],
		['parseSeed', () => parseSeed(rawResponse).ok],
		[
			'resolveCandidatePool',
			() => resolveCandidatePool(fontTable, 'sans', 'geometric').matched === 'tone',
		],
		['rankFonts', () => rankFonts(fontTable, rankableSeed).ok],
		['the OKLCH scale engine', () => createOklchScaleEngine().generate(rampableSeed, BALANCED).ok],
		[
			'the semantic layer',
			() => {
				const generated = createOklchScaleEngine().generate(rampableSeed, BALANCED);

				return (
					generated.ok &&
					TokenSetSchema.safeParse(buildTokenSet(generated.schemes, rampableSeed)).success
				);
			},
		],
		['the radius scale', () => radiusScale(null).source === 'derived'],
		['the type scale', () => typeScale(null).values.size.base?.value === 1],
		['the tracking scale', () => trackingScale(null).source === 'derived'],
		[
			'the shadow scale',
			() =>
				shadowScale(
					{
						color: { l: 0.99, c: 0.004, h: 259.8 },
						provenance: { provenance: 'derived', seedField: 'keyColors', rationale: 'a page' },
					},
					null,
					BALANCED,
				).source === 'derived',
		],
		['the system constants', () => systemConstants().focusRing.source === 'system'],
		[
			'the provenance builders',
			() =>
				observed('keyColors', 'places the brand key colour')[CAMBIUM_NAMESPACE].provenance ===
					'observed' &&
				derived('trackingFeel', 'shifts the tracking scale by the stated feel')[CAMBIUM_NAMESPACE]
					.provenance === 'derived' &&
				invented('no seed field speaks to this slot')[CAMBIUM_NAMESPACE].seedField === null,
		],
		[
			'the non-colour derivation',
			() => {
				const generated = createOklchScaleEngine().generate(rampableSeed, BALANCED);

				if (!generated.ok) return false;

				const semantic = {
					background: {
						alias: 'neutral.1',
						$extensions: derived('keyColors', 'aliases the page surface to a neutral step'),
					},
				};
				const schemes = {
					light: { primitives: generated.schemes.light, semantic },
					dark: { primitives: generated.schemes.dark, semantic },
				};

				return deriveNonColor(rampableSeed, schemes, BALANCED).zIndex.source === 'system';
			},
		],
		[
			'serializeDtcg',
			() => {
				const { light, dark } = serializeDtcg(SPEC_TOKEN_SET);
				const background = nodeAt(light, ['color', 'semantic', 'background']) as
					| { $value: unknown; $extensions: Record<string, { seedField: unknown }> }
					| undefined;
				const lightStep1 = nodeAt(light, ['color', 'primitive', 'brand', '1']) as
					| { $value: { hex: unknown } }
					| undefined;
				const darkStep1 = nodeAt(dark, ['color', 'primitive', 'brand', '1']) as
					| { $value: { hex: unknown } }
					| undefined;

				// A literal here instead of an alias, or a light ramp bleeding into the dark document,
				// would still leave every field present, so the check is that the alias resolves to
				// exactly the string this token set's alias denotes, and that the two schemes carry the
				// two different colours the fixture pins.
				return (
					background?.$value === '{color.primitive.brand.1}' &&
					background?.$extensions[CAMBIUM_NAMESPACE]?.seedField === 'keyColors' &&
					lightStep1?.$value.hex === '#f6f9fc' &&
					darkStep1?.$value.hex === '#060d1a'
				);
			},
		],
		[
			'deserializeDtcg',
			() => {
				const { light, dark } = serializeDtcg(SPEC_TOKEN_SET);
				const roundTripped = deserializeDtcg(light, dark);

				// The ramp length and the alias spelling only come out right if the document was
				// actually walked and the DTCG alias syntax translated back to `ramp.step` form; a
				// stub that handed back an empty token set would fail every one of these.
				return (
					roundTripped.schemes.light.semantic.border.alias === 'brand.6' &&
					roundTripped.schemes.dark.primitives.brand.length === 12 &&
					roundTripped.schemes.light.primitives.brand[0]?.$extensions[CAMBIUM_NAMESPACE]
						.seedField === 'keyColors'
				);
			},
		],
		[
			'summarizeViolations',
			() => {
				const validated = validateDtcg(brokenHueDocument);

				if (validated.valid) return false;

				const [summary, ...rest] = summarizeViolations(validated.violations);

				// Nineteen raw diagnostics have to fold into exactly one row addressing the hue for
				// this to be true; a fold that dropped the anchoring logic and returned one row per
				// diagnostic, or the wrong row, would fail here even though it "parsed" something.
				return (
					rest.length === 0 &&
					summary?.pointer === '/color/brand/$value/components/2' &&
					summary?.likelyCause === 'must be < 360'
				);
			},
		],
		// The four `core/css/` adapters and the two declaration maps `core/css/scheme-declarations.ts`
		// builds from the same halves all refuse a token set naming anything outside the generator's
		// own vocabulary, and `cssTokenSet` names nothing else: one ramp ('brand'), one semantic alias
		// ('border'), one shadow step, radius step, type size, weight, line height and tracking step,
		// each a name the generator itself emits. That is what lets it stand in here instead of the
		// heavier `GENERATED_SET` fixture in `core/css/css.fixture.ts`.
		['toStylesheet', () => toStylesheet(cssTokenSet).length > 0],
		['toGlobalsCss', () => toGlobalsCss(cssTokenSet, cssNaming()).length > 0],
		['toThemeBlock', () => toThemeBlock(cssTokenSet, cssNaming()).length > 0],
		['toDarkThemeLayer', () => toDarkThemeLayer(cssTokenSet, cssNaming()).length > 0],
		[
			'schemeDeclarations',
			() => Object.keys(schemeDeclarations(cssTokenSet, 'light', cssNaming())).length > 0,
		],
		[
			'scalarDeclarations',
			() => Object.keys(scalarDeclarations(cssTokenSet, cssNaming())).length > 0,
		],
	])('%s parses a valid value without reaching the network', (_name, parses) => {
		vi.stubGlobal('fetch', () => {
			throw new Error('the pure core must not reach the network');
		});

		expect(parses()).toBe(true);
	});
});
