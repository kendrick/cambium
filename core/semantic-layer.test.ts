import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from './brand-seed';
import { createOklchScaleEngine } from './oklch-scale-engine';
import { contrastFromOklch } from './oklch';
import { CAMBIUM_NAMESPACE, invented } from './provenance';
import { RAMP_NAMES, SCHEME_NAMES } from './scale-engine';
import { BALANCED } from './interpretation';
import { resolveScheme } from './resolve-scheme';
import { buildTokenSet } from './semantic-layer';
import { SEMANTIC_MAP } from './semantic-map';
import { type Scheme, TokenSetSchema } from './token-set';

/**
 * Real engine output rather than a hand-written ramp set. The seam this module sits on is the
 * scale engine's result, and a fixture shaped by hand would let an aliasing bug survive a change
 * to what the engine emits.
 *
 * Yellow rides along because it is the seed that breaks the monotonic lightness chain at steps 9
 * and 10, which is where the semantic layer reaches for `primary`.
 */
function fixtureFor(oklch: [number, number, number], character: Partial<BrandSeed> = {}) {
	const seed = BrandSeedSchema.parse({
		keyColors: [{ oklch, proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null }],
		neutralTemperature: null,
		radiusCharacter: null,
		shadowCharacter: null,
		trackingFeel: null,
		typeClassification: null,
		suggestedPairing: null,
		typeScaleRatio: null,
		imageClassifications: null,
		expressive: null,
		...character,
	});

	const result = createOklchScaleEngine().generate(seed, BALANCED);

	if (!result.ok)
		throw new Error(`the scale engine rejected the fixture seed: ${result.error.kind}`);

	return { seed, schemes: result.schemes };
}

function build(fixture: ReturnType<typeof fixtureFor>) {
	return buildTokenSet(fixture.schemes, fixture.seed);
}

const blue = fixtureFor([0.6231, 0.188, 259.8]);
const yellow = fixtureFor([0.7952, 0.1617, 86.0]);

/**
 * Ten seeds across the hue circle and, more to the point, across lightness 0.20 to 0.90. Hue alone
 * misses the failure this sweep exists to catch: a foreground on step 9 breaks on how light the
 * brand is, and a wheel of mid-lightness seeds all behaves the same way.
 */
const SWEEP: [string, [number, number, number]][] = [
	['dark-navy', [0.2, 0.1, 265]],
	['purple', [0.45, 0.2, 300]],
	['red', [0.58, 0.22, 27]],
	['magenta', [0.55, 0.25, 330]],
	['blue', [0.6231, 0.188, 259.8]],
	['green', [0.6959, 0.1491, 162.5]],
	['orange', [0.7, 0.17, 55]],
	['cyan', [0.72, 0.12, 200]],
	['yellow', [0.7952, 0.1617, 86.0]],
	['light-yellow', [0.9, 0.14, 95]],
];

const swept = SWEEP.map(([name, oklch]) => Object.assign({ name }, fixtureFor(oklch)));

describe('buildTokenSet', () => {
	it('produces a set the token-set schema accepts', () => {
		expect(() => TokenSetSchema.parse(build(blue))).not.toThrow();
	});

	it('carries every ramp the scale engine generated, in both schemes', () => {
		const tokenSet = build(blue);

		for (const scheme of SCHEME_NAMES) {
			expect(new Set(Object.keys(tokenSet.schemes[scheme].primitives))).toEqual(
				new Set<string>(RAMP_NAMES),
			);
		}
	});

	/**
	 * The one acceptance criterion the schema cannot reach. `TokenSetSchema` checks each scheme's
	 * aliases resolve inside that scheme, so a set whose dark half quietly dropped `ring` parses
	 * clean and ships a theme that loses its focus ring the moment someone switches scheme.
	 */
	it('gives light and dark the same semantic key set', () => {
		const { schemes } = build(blue);

		expect(new Set(Object.keys(schemes.dark.semantic))).toEqual(
			new Set(Object.keys(schemes.light.semantic)),
		);
	});

	// Every fixed assignment holds across both schemes; only a contrasting pair is free to differ,
	// and it differs because step 9 keeps one colour while step 1 swaps ends.
	it('keeps every fixed assignment identical across the two schemes', () => {
		const { schemes } = build(blue);

		for (const [token, assignment] of Object.entries(SEMANTIC_MAP)) {
			if (typeof assignment !== 'string') continue;

			expect(schemes.light.semantic[token]!.alias).toBe(assignment);
			expect(schemes.dark.semantic[token]!.alias).toBe(assignment);
		}
	});

	// A scheme's semantic layer is what an export adapter reads, so every entry's `alias` has to be
	// one plain alias. Leaking a pair through would hand the adapter a rule where a colour goes.
	it('resolves each contrasting pair down to one plain alias per scheme', () => {
		const { schemes } = build(blue);

		for (const scheme of SCHEME_NAMES) {
			for (const entry of Object.values(schemes[scheme].semantic)) {
				expect(typeof entry.alias).toBe('string');
			}
		}
	});

	// `:root` carries light and `.dark` overrides it, in this repo's own stylesheet and in every
	// shadcn theme. So the unprefixed top level is the light scheme rather than a scheme of its own.
	it('takes light as the unprefixed default at the top level', () => {
		const tokenSet = build(blue);

		expect(tokenSet.primitives).toEqual(tokenSet.schemes.light.primitives);
		expect(tokenSet.semantic).toEqual(tokenSet.schemes.light.semantic);
	});
});

describe('resolveScheme', () => {
	it.each(SCHEME_NAMES)('resolves every %s alias to a literal, leaving none dangling', (scheme) => {
		const resolved = resolveScheme(build(blue).schemes[scheme]);

		expect(new Set(Object.keys(resolved))).toEqual(new Set(Object.keys(SEMANTIC_MAP)));

		// Collected rather than asserted one at a time so a failure names the token that broke.
		// `expect.any(Number)` would wave NaN through, and NaN is what a lightness reaches when a
		// step is missing a channel.
		const malformed = Object.entries(resolved).filter(
			([, { l, c, h }]) => ![l, c, h].every(Number.isFinite),
		);

		expect(malformed).toEqual([]);
	});

	it('returns the ramp step the alias names, channel for channel', () => {
		const { schemes } = build(blue);
		const resolved = resolveScheme(schemes.light);
		const { l, c, h } = schemes.light.primitives.neutral[5];

		expect(resolved.border).toEqual({ l, c, h });
	});

	// A seed whose brand sits at lightness 0.795 is the case that breaks the monotonic chain, and
	// `primary` reaches straight into the pair that floats with it.
	it('carries the seed colour through to primary in both schemes', () => {
		for (const scheme of SCHEME_NAMES) {
			const built = build(yellow).schemes[scheme];
			const { l, c, h } = built.primitives.brand[8];

			expect(resolveScheme(built).primary).toEqual({ l, c, h });
		}
	});

	// Dark is generated independently against the same step roles rather than inverted from light,
	// so the shared map has to land on different colours.
	it('resolves the same token to different colours in each scheme', () => {
		const { schemes } = build(blue);
		const light = resolveScheme(schemes.light);
		const dark = resolveScheme(schemes.dark);

		expect(dark.background).not.toEqual(light.background);
		expect(dark.foreground).not.toEqual(light.foreground);
	});

	/**
	 * Only reachable by hand-building a scheme, because `SchemeSchema` rejects a dangling alias and
	 * the map is a compile-time constant. Kept anyway, because a token set with a hole in it reaches
	 * an export adapter looking like a colour.
	 */
	it('throws rather than emitting a hole when an alias resolves to nothing', () => {
		const { schemes } = build(blue);
		const dangling = { alias: 'missing.6', $extensions: invented('Points at no ramp on purpose') };
		const broken = { ...schemes.light, semantic: { border: dangling } };

		expect(() => resolveScheme(broken)).toThrow(/missing\.6/);
	});
});

/** A ramp step read straight out of the scheme, so the sweep measures colours, not aliases. */
function stepOf(scheme: Scheme, alias: string) {
	const [ramp, step] = alias.split('.');

	return scheme.primitives[ramp!]![Number(step) - 1]!;
}

/**
 * The reason `primary-foreground` is a pair rather than a step. Step 9 carries the seed's own
 * colour in both schemes, by the scale engine's deliberate anchoring, while step 1 runs near-white
 * in light and near-black in dark. One fixed alias therefore cannot serve both: `brand.1` put a
 * navy seed at 1.01:1 in the dark scheme, which is text nobody can read.
 *
 * Picking between two declared steps is aliasing, not contrast repair. Nothing here moves a
 * colour, and #8 still owns the seeds this cannot rescue.
 */
describe('foregrounds that sit on a solid fill', () => {
	const FILL_FOREGROUNDS = ['primary-foreground', 'sidebar-primary-foreground'] as const;

	it.each(FILL_FOREGROUNDS)(
		'%s takes whichever candidate contrasts more with its fill',
		(token) => {
			const assignment = SEMANTIC_MAP[token];
			const worse: string[] = [];

			for (const fixture of swept) {
				for (const scheme of SCHEME_NAMES) {
					const built = build(fixture).schemes[scheme];
					const fill = stepOf(built, assignment.on);
					const reached = contrastFromOklch(resolveScheme(built)[token]!, fill);
					const best = Math.max(
						...assignment.candidates.map((c) => contrastFromOklch(stepOf(built, c), fill)),
					);

					if (reached < best) worse.push(`${fixture.name}/${scheme}`);
				}
			}

			expect(worse).toEqual([]);
		},
	);

	/**
	 * A floor rather than AA, because AA is out of reach here. A brand sitting mid-lightness has no
	 * step in its own ramp that clears 4.5:1 against step 9, and the measured residue is four of
	 * twenty combinations in the 3.6 to 4.4 band. What the pair buys is that no combination lands at
	 * the unusable end any more, so 3:1 holds and #8 closes the rest.
	 */
	it.each(FILL_FOREGROUNDS)('%s never lands on the unreadable end of its ramp', (token) => {
		const assignment = SEMANTIC_MAP[token];
		const belowFloor: string[] = [];

		for (const fixture of swept) {
			for (const scheme of SCHEME_NAMES) {
				const built = build(fixture).schemes[scheme];
				const reached = contrastFromOklch(
					resolveScheme(built)[token]!,
					stepOf(built, assignment.on),
				);

				if (reached < 3) belowFloor.push(`${fixture.name}/${scheme} at ${reached.toFixed(2)}:1`);
			}
		}

		expect(belowFloor).toEqual([]);
	});

	/**
	 * A focus ring is visual information that identifies a component's state, so WCAG 2.2 SC 1.4.11
	 * asks 3:1 of it against what sits next to it. `components/ui/button.tsx` paints the focused
	 * boundary with `border-ring` at full opacity and lays a 50% halo outside that, so the
	 * full-opacity value against the page is the number that has to clear.
	 *
	 * Step 8 is where Radix puts a focus ring and where this map started. It measures 2.22:1 to
	 * 2.49:1 against the page in the light scheme for every seed tried, because Cambium's step 8 is
	 * a border against step 2 rather than against step 1.
	 */
	it.each(['ring', 'sidebar-ring'])('%s clears 3:1 against the page on every seed', (token) => {
		const failures: string[] = [];

		for (const fixture of swept) {
			for (const scheme of SCHEME_NAMES) {
				const resolved = resolveScheme(build(fixture).schemes[scheme]);
				const reached = contrastFromOklch(resolved[token]!, resolved.background!);

				if (reached < 3) failures.push(`${fixture.name}/${scheme} at ${reached.toFixed(2)}:1`);
			}
		}

		expect(failures).toEqual([]);
	});

	/**
	 * The contract this repo vendors declares no `--destructive-foreground`, and
	 * `components/ui/button.tsx` builds its destructive control from `text-destructive` over a tint of
	 * the same colour, so `--destructive` has to work as body text here.
	 * `components/ui/button.tsx` paints it at full opacity twice, as that text and as
	 * `aria-invalid:border-destructive`. It never paints an opaque `bg-destructive`.
	 *
	 * Step 9 is the danger ramp's solid fill, and against the page in the light scheme it reaches
	 * 3.85:1, the same figure for every seed. Stock shadcn's own `--destructive` clears AA at 4.91:1 against
	 * white, so this is Cambium falling short of the contract rather than the contract being
	 * unreachable.
	 */
	it('gives destructive a colour that works as body text on the page', () => {
		const failures: string[] = [];

		for (const fixture of swept) {
			for (const scheme of SCHEME_NAMES) {
				const resolved = resolveScheme(build(fixture).schemes[scheme]);
				const reached = contrastFromOklch(resolved.destructive!, resolved.background!);

				if (reached < 4.5) failures.push(`${fixture.name}/${scheme} at ${reached.toFixed(2)}:1`);
			}
		}

		expect(failures).toEqual([]);
	});

	// The neutral-ramp foregrounds were checked against the same sweep and need no pair: the worst
	// of them sits at 9.92:1, because their surfaces are steps 1 through 4 rather than a step 9 that
	// floats with the seed.
	it.each(['foreground', 'card-foreground', 'secondary-foreground', 'accent-foreground'])(
		'%s clears AA against its surface on every seed, with no pair needed',
		(token) => {
			const surface = token === 'foreground' ? 'background' : token.slice(0, -'-foreground'.length);
			const failures: string[] = [];

			for (const fixture of swept) {
				for (const scheme of SCHEME_NAMES) {
					const resolved = resolveScheme(build(fixture).schemes[scheme]);
					const reached = contrastFromOklch(resolved[token]!, resolved[surface]!);

					if (reached < 4.5) failures.push(`${fixture.name}/${scheme} at ${reached.toFixed(2)}:1`);
				}
			}

			expect(failures).toEqual([]);
		},
	);
});

/**
 * A consumer reads a semantic token as a colour, and that colour is the ramp step's. So the layer
 * has no provenance of its own to state. It inherits the step's, and the rationale is the only part
 * the alias assignment contributes.
 */
describe('semantic provenance', () => {
	it.each(SCHEME_NAMES)('inherits each %s payload from the step it resolves to', (scheme) => {
		const built = build(blue).schemes[scheme];
		const drifted: string[] = [];

		for (const [token, entry] of Object.entries(built.semantic)) {
			const taken = entry.$extensions[CAMBIUM_NAMESPACE];
			const step = stepOf(built, entry.alias).$extensions[CAMBIUM_NAMESPACE];

			if (taken.provenance !== step.provenance || taken.seedField !== step.seedField)
				drifted.push(`${token} -> ${entry.alias}`);
		}

		expect(drifted).toEqual([]);
	});

	/**
	 * The shortcut this exists to catch is tagging the whole layer `derived`, which satisfies the
	 * schema and every other assertion in this file. Step 9 is the seed's own colour and every other
	 * brand step is computed off it, so `primary` and `ring` disagree under any seed.
	 */
	it('does not hand the whole layer one provenance value', () => {
		const taken = Object.values(build(blue).semantic).map(
			(entry) => entry.$extensions[CAMBIUM_NAMESPACE].provenance,
		);

		expect(new Set(taken).size).toBeGreaterThan(1);
	});

	/**
	 * Both halves have to appear. A rationale naming only the winner reads exactly like a fixed
	 * alias, and this one declaration resolves to different winners in the two schemes.
	 */
	it.each(SCHEME_NAMES)('records what a %s pair beat and what it measured against', (scheme) => {
		const pair = SEMANTIC_MAP['primary-foreground'];
		const entry = build(blue).schemes[scheme].semantic['primary-foreground']!;
		const beaten = pair.candidates.find((candidate) => candidate !== entry.alias)!;

		// Word-bounded, because a bare substring check for `brand.1` also passes on `brand.12` and
		// would call the rationale complete when it named only the winner.
		expect(entry.$extensions[CAMBIUM_NAMESPACE].rationale).toMatch(
			new RegExp(`\\b${beaten.replace('.', '\\.')}\\b`),
		);
		expect(entry.$extensions[CAMBIUM_NAMESPACE].rationale).toMatch(
			new RegExp(`\\b${pair.on.replace('.', '\\.')}\\b`),
		);
	});
});

/**
 * The colour half of `buildTokenSet` is asserted above. This is the other half: the nine non-colour
 * categories reach the assembled set, and the one that varies by scheme is the only one a scheme
 * carries.
 */
describe('buildTokenSet non-colour categories', () => {
	const COLOUR_KEYS = new Set(['primitives', 'semantic', 'schemes']);

	it('carries every category an export adapter reads by name', () => {
		const tokenSet = build(blue);

		expect(new Set(Object.keys(tokenSet).filter((key) => !COLOUR_KEYS.has(key)))).toEqual(
			new Set([
				'focusRing',
				'motion',
				'opacity',
				'radius',
				'shadow',
				'spacing',
				'tracking',
				'typography',
				'zIndex',
			]),
		);
	});

	/**
	 * Nothing discovers a new category, so a later ticket could add one that carries no `source` and
	 * quietly fall outside the "no system-constant category varies with the seed" check, which only
	 * looks at categories whose source says `system`. Reading the key set rather than a written list
	 * is what closes that gap.
	 */
	it('flags every top-level key that is not part of the colour layer', () => {
		const tokenSet = build(blue) as unknown as Record<string, { source?: string }>;

		for (const [key, value] of Object.entries(tokenSet)) {
			if (COLOUR_KEYS.has(key)) continue;

			expect(['derived', 'system']).toContain(value.source);
		}
	});

	// `:root` carries light and `.dark` overrides it, so the unprefixed shadow is the light one, the
	// same way the unprefixed primitives and semantic layer already are.
	it('takes the light shadow as the unprefixed default', () => {
		const tokenSet = build(blue);

		expect(tokenSet.shadow).toEqual(tokenSet.schemes.light.shadow);
	});

	it('gives each scheme its own shadow rather than one value for both', () => {
		const { schemes } = build(blue);

		expect(schemes.dark.shadow).not.toEqual(schemes.light.shadow);
	});

	it('takes the radius scale from the seed rather than from a default', () => {
		const sharp = fixtureFor([0.6231, 0.188, 259.8], {
			radiusCharacter: { base: 2, progression: 'sharp' },
		});

		expect(build(sharp).radius).not.toEqual(build(blue).radius);
	});
});
