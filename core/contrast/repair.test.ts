import { converter } from 'culori/fn';
import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from '../brand-seed';
import { toOklchCss } from '../css/oklch-css';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { isInSrgb, type Oklch, renderedContrast } from '../oklch';
import { CAMBIUM_NAMESPACE } from '../provenance';
import { resolveScheme } from '../resolve-scheme';
import { SCHEME_NAMES, type SchemeName } from '../scale-engine';
import { repairPinsFor, type SeedPinPath } from '../seed-pins';
import { buildTokenSet } from '../semantic-layer';
import { applyOverrides, type TokenOverride } from '../token-overrides';
import type { TokenSet } from '../token-set';
import { checkContrast } from './check';
import {
	defaultPins,
	type PinKey,
	pinKey,
	type RepairEntry,
	repairContrast,
	withContrastRepairs,
} from './repair';

/**
 * Real engine output for the same ten seeds `check.test.ts` sweeps. Repeated rather than imported
 * because `SWEEP` is a local const in both suites, and what has to hold here is that the generator's
 * actual failures get fixed, not failures a hand-built fixture was shaped to have.
 */
function fixtureFor(oklch: [number, number, number]): TokenSet {
	return baseFor(
		seedOf({
			keyColors: [{ oklch, proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null }],
		}),
	);
}

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

const swept = SWEEP.map(([name, oklch]) => ({ name, tokenSet: fixtureFor(oklch) }));

function sweptSet(name: string): TokenSet {
	return swept.find((entry) => entry.name === name)!.tokenSet;
}

function applied(tokenSet: TokenSet, overrides: readonly TokenOverride[]): TokenSet {
	const result = applyOverrides(tokenSet, overrides);

	if (!result.ok) throw new Error(`applyOverrides refused ${result.key}`);

	return result.tokenSet;
}

function stepOf(tokenSet: TokenSet, scheme: SchemeName, ramp: string, step: number) {
	const found = tokenSet.schemes[scheme].primitives[ramp]?.[step - 1];

	if (!found) throw new Error(`no ${scheme} ${ramp}.${step}`);

	return found;
}

function primitiveOverrides(overrides: readonly TokenOverride[]) {
	return overrides.map((override) => {
		if (override.kind !== 'primitive') throw new Error(`expected primitive, got ${override.kind}`);

		return override;
	});
}

const toRgb = converter('rgb');

function outsideSrgb(color: Oklch): boolean {
	const rgb = toRgb({ mode: 'oklch', ...color })!;

	return [rgb.r ?? 0, rgb.g ?? 0, rgb.b ?? 0].some(
		(channel) => channel < -1e-9 || channel > 1 + 1e-9,
	);
}

/**
 * Whether `entry.outOfOrder` matches what the final applied set actually shows at that step.
 * Shared by the two "out of order" tests below so proving the flag can be true and proving it
 * stays correct everywhere else rest on one comparison, not two copies of it.
 */
function outOfOrderMatchesFinal(final: TokenSet, entry: RepairEntry): boolean {
	const ramp = final.schemes[entry.scheme].primitives[entry.ramp]!;
	const l = ramp[entry.step - 1]!.l;
	// Step 1 is the page end of a ramp: lightest in light, darkest in dark.
	const descending = entry.scheme === 'light';
	const before = ramp[entry.step - 2]?.l;
	const after = ramp[entry.step]?.l;
	const inOrder = descending
		? (before === undefined || before >= l) && (after === undefined || l >= after)
		: (before === undefined || before <= l) && (after === undefined || l <= after);

	return entry.outOfOrder === !inOrder;
}

/**
 * The protected set read straight off provenance, written out here rather than asked of
 * `defaultPins`, so a test using it checks `repairContrast` against the rule instead of against the
 * function it would otherwise share a bug with.
 */
function observedSteps(tokenSet: TokenSet): Set<PinKey> {
	const keys = new Set<PinKey>();

	for (const scheme of SCHEME_NAMES) {
		for (const [ramp, steps] of Object.entries(tokenSet.schemes[scheme].primitives)) {
			for (const step of steps) {
				if (step.$extensions[CAMBIUM_NAMESPACE].provenance === 'observed') {
					keys.add(`${scheme}:${ramp}.${step.step}`);
				}
			}
		}
	}

	return keys;
}

/**
 * Rewrites one light step in both copies the set holds, because `checkMirroredLayers` refuses a set
 * whose top-level mirror disagrees with `schemes.light`, and `applyOverrides` parses its base first.
 */
function editLightStep(
	tokenSet: TokenSet,
	ramp: string,
	step: number,
	edit: (entry: TokenSet['primitives'][string][number]) => void,
): TokenSet {
	const copy = structuredClone(tokenSet);

	edit(copy.schemes.light.primitives[ramp]![step - 1]!);
	edit(copy.primitives[ramp]![step - 1]!);

	return copy;
}

function markObserved(entry: TokenSet['primitives'][string][number]) {
	entry.$extensions = {
		[CAMBIUM_NAMESPACE]: {
			provenance: 'observed',
			rationale: 'fixture step marked as read from an image',
			seedField: 'keyColors',
		},
	};
}

function markDerived(entry: TokenSet['primitives'][string][number]) {
	entry.$extensions = {
		[CAMBIUM_NAMESPACE]: {
			provenance: 'derived',
			rationale: 'fixture step marked as curved from the key colour',
			seedField: 'keyColors',
		},
	};
}

describe('repairContrast across the sweep', () => {
	/**
	 * The acceptance bar in #8: every declared pair passes AA in both schemes once every proposed
	 * repair is applied. Measured by `checkContrast` on the set `applyOverrides` hands back, which is
	 * the set the store and the exporters read, rather than by anything `repairContrast` reports
	 * about itself.
	 */
	it.each(SWEEP.map(([name]) => name))(
		'%s passes AA everywhere after repair, with nothing unrepaired',
		(name) => {
			const base = sweptSet(name);
			const { overrides, unrepaired } = repairContrast(base);

			expect(unrepaired).toEqual([]);
			expect(checkContrast(applied(base, overrides)).filter((entry) => !entry.passes)).toEqual([]);
		},
	);

	/**
	 * The stated tolerance from #8's acceptance criteria. Hue: 0. Chroma: 0, except where the new
	 * lightness can't hold the original chroma inside sRGB, and then it may drop to the sRGB boundary
	 * at that lightness and no further. The boundary is checked as "in gamut here, out of gamut a
	 * millionth further out", so a repair that shaves more chroma than the gamut asks for fails.
	 * "Out" is a channel past 0..1 by more than float noise, not by `isInSrgb`'s millionth: that
	 * slack is what let a printed repair land outside sRGB (see the printed-repair suite below).
	 */
	it.each(SWEEP.map(([name]) => name))(
		'%s: every override keeps hue exactly and chroma exactly or at the sRGB edge',
		(name) => {
			const base = sweptSet(name);

			for (const override of primitiveOverrides(repairContrast(base).overrides)) {
				const original = stepOf(base, override.scheme, override.ramp, override.step);
				const moved: Oklch = { l: override.l, c: override.c, h: override.h };

				expect(override.h).toBe(original.h);
				expect(isInSrgb(moved)).toBe(true);

				const chromaKept = override.c === original.c;
				const chromaAtEdge =
					override.c < original.c && outsideSrgb({ ...moved, c: override.c + 1e-6 });

				expect(chromaKept || chromaAtEdge).toBe(true);
			}
		},
	);

	it.each(SWEEP.map(([name]) => name))('%s: no override targets an observed step', (name) => {
		const base = sweptSet(name);
		const pinned = observedSteps(base);

		expect(pinned.size).toBeGreaterThan(0);

		for (const override of primitiveOverrides(repairContrast(base).overrides)) {
			expect(pinned.has(`${override.scheme}:${override.ramp}.${override.step}`)).toBe(false);
		}
	});

	it.each(SWEEP.map(([name]) => name))('%s: repeated runs give deep-equal output', (name) => {
		expect(repairContrast(sweptSet(name))).toEqual(repairContrast(sweptSet(name)));
	});

	/**
	 * A set that already passes everywhere needs no repair. The repaired sweep is that set, built by
	 * the real engine rather than by hand, so this also shows a second run doesn't keep nudging a
	 * step it already fixed.
	 */
	it.each(SWEEP.map(([name]) => name))('%s: a set with no failures gets no overrides', (name) => {
		const base = sweptSet(name);
		const again = repairContrast(applied(base, repairContrast(base).overrides));

		expect(again.overrides).toEqual([]);
		expect(again.unrepaired).toEqual([]);
		expect(again.report).toEqual([]);
	});

	it('round-trips its output through JSON unchanged', () => {
		const result = repairContrast(sweptSet('red'));

		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
});

/**
 * The stylesheet and the preview paint a repair through `toOklchCss`, not through the in-memory
 * override. #140's review caught the gap: a gamut-fitted chroma of 0.009274781… printed as
 * `0.009275`, putting its red channel at 1.0000016, past the sRGB edge, so the colour a browser parsed was not the one
 * `achieved` was measured on. Everything below reads the printed string back with a parser that
 * shares nothing with `core/oklch.ts`, and measures contrast from bytes it rounds itself.
 */
function parseOklchCss(css: string): Oklch {
	const match = /^oklch\(([^ ]+) ([^ ]+) ([^ )]+)\)$/.exec(css);

	if (!match) throw new Error(`not a bare oklch() triple: ${css}`);

	return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function printedRgb(color: Oklch) {
	const rgb = toRgb({ mode: 'oklch', ...parseOklchCss(toOklchCss(color)) })!;

	return [rgb.r ?? 0, rgb.g ?? 0, rgb.b ?? 0];
}

/** WCAG 2.2 relative luminance of the 8-bit colour a browser paints for `color`'s printed CSS. */
function paintedLuminance(color: Oklch): number {
	const [r, g, b] = printedRgb(color).map((channel) => {
		const byte = Math.round(Math.min(1, Math.max(0, channel)) * 255) / 255;

		return byte <= 0.04045 ? byte / 12.92 : ((byte + 0.055) / 1.055) ** 2.4;
	});

	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function paintedContrast(a: Oklch, b: Oklch): number {
	const [x, y] = [paintedLuminance(a), paintedLuminance(b)];

	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function primitiveFor(tokenSet: TokenSet, scheme: SchemeName, token: string): Oklch {
	const alias = tokenSet.schemes[scheme].semantic[token]!.alias;
	const dot = alias.lastIndexOf('.');
	const { l, c, h } = stepOf(tokenSet, scheme, alias.slice(0, dot), Number(alias.slice(dot + 1)));

	return { l, c, h };
}

describe('repairs as the stylesheet prints them', () => {
	it.each(SWEEP.map(([name]) => name))(
		'%s: every override prints exactly its own channels, and they are in sRGB',
		(name) => {
			const { overrides, report } = repairContrast(sweptSet(name));

			for (const override of primitiveOverrides(overrides)) {
				const channels = { l: override.l, c: override.c, h: override.h };

				for (const channel of printedRgb(channels)) {
					expect(channel).toBeGreaterThanOrEqual(-1e-9);
					expect(channel).toBeLessThanOrEqual(1 + 1e-9);
				}

				expect(parseOklchCss(toOklchCss(channels))).toEqual(channels);
			}

			for (const entry of report) {
				expect(parseOklchCss(toOklchCss(entry.to))).toEqual(entry.to);
			}
		},
	);

	/**
	 * Every declared pair, not only the repaired ones: a move for one pair shifts every token aliased
	 * to that step, so the printed set has to pass as a whole.
	 */
	it.each(SWEEP.map(([name]) => name))(
		'%s: every declared pair clears its target on the printed colours, in both schemes',
		(name) => {
			const base = sweptSet(name);
			const final = applied(base, repairContrast(base).overrides);

			for (const pair of checkContrast(final)) {
				const measured = paintedContrast(
					primitiveFor(final, pair.scheme, pair.foreground),
					primitiveFor(final, pair.scheme, pair.background),
				);

				expect(
					measured,
					`${pair.scheme} ${pair.foreground} on ${pair.background}`,
				).toBeGreaterThanOrEqual(pair.target);
			}
		},
	);
});

describe('the repair report', () => {
	/**
	 * `achieved` is what the pair measures in the set repair returns, so every entry has to clear its
	 * target there, whatever a later move did to the pair's other side.
	 */
	it.each(SWEEP.map(([name]) => name))(
		'%s: every entry names a measured failure, a move, and a passing result',
		(name) => {
			const base = sweptSet(name);
			const { overrides, report } = repairContrast(base);

			expect(report.length).toBeGreaterThan(0);

			for (const entry of report) {
				expect(entry.measured).toBeLessThan(entry.target);
				expect(entry.achieved).toBeGreaterThanOrEqual(entry.target);

				const override = primitiveOverrides(overrides).find(
					(o) => o.scheme === entry.scheme && o.ramp === entry.ramp && o.step === entry.step,
				);

				expect(override).toBeDefined();
				expect(entry.from).toEqual(
					(({ l, c, h }) => ({ l, c, h }))(stepOf(base, entry.scheme, entry.ramp, entry.step)),
				);
				expect(entry.chromaReduced).toBe(entry.to.c < entry.from.c);
			}
		},
	);

	/**
	 * Red in dark has no in-gamut lightness at `brand.1`'s own chroma that clears 4.5:1 against the
	 * pinned `brand.9`; the best is 4.387. So this seed is the one that has to reach the chroma
	 * clamp, and a repair that never clamps can't pass it. Asserted here so the clamp branch is
	 * covered by a fixture that can tell it apart from the unclamped one.
	 */
	it('reports a chroma reduction where the new lightness cannot hold the original chroma', () => {
		const { report } = repairContrast(sweptSet('red'));
		const clamped = report.filter((entry) => entry.scheme === 'dark' && entry.chromaReduced);

		expect(clamped.length).toBeGreaterThan(0);

		for (const entry of clamped) {
			expect(entry.to.c).toBeLessThan(entry.from.c);
			expect(entry.to.h).toBe(entry.from.h);
		}
	});

	/**
	 * Blue in light: `brand.1` starts near white at 0.994 and the white side can't clear 4.5:1
	 * against `brand.9`, so the nearest passing lightness is on the dark side of the fill. That puts
	 * step 1 below step 2 in a light ramp, which the entry has to say, read here off the repaired
	 * set's own neighbours.
	 */
	it('flags a moved step that ends up out of its ramp order', () => {
		const base = sweptSet('blue');
		const { overrides, report } = repairContrast(base);
		const final = applied(base, overrides);

		for (const entry of report) {
			expect(outOfOrderMatchesFinal(final, entry)).toBe(true);
		}

		expect(
			report.some(
				(entry) =>
					entry.scheme === 'light' &&
					entry.ramp === 'brand' &&
					entry.step === 1 &&
					entry.outOfOrder,
			),
		).toBe(true);
	});

	/**
	 * A later move can shift a step's neighbours and leave an earlier entry's `outOfOrder` wrong if
	 * it were still read off the set as it stood right after that entry's own move, which is why
	 * `repairContrast` recomputes every entry against the final set before returning. This checks
	 * that recomputation holds for every entry, for every seed in the sweep, against the set
	 * `overrides` actually produces.
	 */
	it.each(SWEEP.map(([name]) => name))(
		'%s: every report entry’s outOfOrder matches the final applied set',
		(name) => {
			const base = sweptSet(name);
			const { overrides, report } = repairContrast(base);
			const final = applied(base, overrides);

			for (const entry of report) {
				expect(outOfOrderMatchesFinal(final, entry)).toBe(true);
			}
		},
	);
});

describe('pins', () => {
	/**
	 * Every seed fails `muted-foreground` (`neutral.11`) on `muted` (`neutral.3`) in light. Pinning
	 * the foreground's step leaves the background as the only legal move.
	 */
	it('moves the background when the foreground step is pinned', () => {
		const base = sweptSet('green');
		const pinned = new Set([...observedSteps(base), pinKey('light', 'neutral', 11)]);
		const { overrides, unrepaired } = repairContrast(base, { pinned });

		expect(unrepaired).toEqual([]);
		expect(
			primitiveOverrides(overrides).some(
				(o) => o.scheme === 'light' && o.ramp === 'neutral' && o.step === 11,
			),
		).toBe(false);
		expect(
			primitiveOverrides(overrides).some(
				(o) => o.scheme === 'light' && o.ramp === 'neutral' && o.step === 3,
			),
		).toBe(true);
		expect(checkContrast(applied(base, overrides)).filter((entry) => !entry.passes)).toEqual([]);
	});

	it('reports a failing pair unrepaired, and moves neither step, when both sides are pinned', () => {
		const base = sweptSet('green');
		const pinned = new Set([
			...observedSteps(base),
			pinKey('light', 'neutral', 11),
			pinKey('light', 'neutral', 3),
		]);
		const { overrides, unrepaired } = repairContrast(base, { pinned });

		expect(unrepaired.map((entry) => [entry.scheme, entry.foreground, entry.background])).toEqual([
			['light', 'muted-foreground', 'muted'],
		]);
		expect(unrepaired[0]!.passes).toBe(false);
		expect(unrepaired[0]!.reason).toBe('both-pinned');
		expect(
			primitiveOverrides(overrides).filter(
				(o) => o.scheme === 'light' && o.ramp === 'neutral' && (o.step === 11 || o.step === 3),
			),
		).toEqual([]);
	});

	it('never moves a supplied pin', () => {
		const base = sweptSet('blue');
		const pinned = new Set([...observedSteps(base), pinKey('light', 'brand', 1)]);

		for (const override of primitiveOverrides(repairContrast(base, { pinned }).overrides)) {
			expect(pinned.has(pinKey(override.scheme, override.ramp, override.step))).toBe(false);
		}
	});

	describe('the default', () => {
		/**
		 * The falsifier: provenance decides the protected set, not position or colour. Moving the
		 * `observed` mark from `brand.9` to light `neutral.11` has to move the pin with it, and a
		 * repair that keyed on "step 9" or "brand" would keep protecting the old step.
		 */
		it('follows the observed mark to a different step', () => {
			const base = sweptSet('green');
			const moved = editLightStep(
				editLightStep(base, 'brand', 9, markDerived),
				'neutral',
				11,
				markObserved,
			);
			const pins = defaultPins(moved);

			expect(pins.has(pinKey('light', 'neutral', 11))).toBe(true);
			expect(pins.has(pinKey('light', 'brand', 9))).toBe(false);
			expect(pins.has(pinKey('dark', 'brand', 9))).toBe(true);

			const { overrides } = repairContrast(moved);

			expect(
				primitiveOverrides(overrides).some(
					(o) => o.scheme === 'light' && o.ramp === 'neutral' && o.step === 11,
				),
			).toBe(false);
			expect(repairContrast(base).overrides).toContainEqual(
				expect.objectContaining({ scheme: 'light', ramp: 'neutral', step: 11 }),
			);
		});

		it('ignores a colour change that leaves provenance alone', () => {
			const base = sweptSet('green');
			const recoloured = editLightStep(base, 'brand', 9, (entry) => {
				entry.l = 0.3;
			});

			expect(defaultPins(recoloured)).toEqual(defaultPins(base));
			expect(defaultPins(base)).toEqual(observedSteps(base));
		});
	});
});

describe('withContrastRepairs', () => {
	/**
	 * Checked against `applyOverrides(base, repairContrast(base).overrides).tokenSet` rather than
	 * against a second call to `withContrastRepairs` itself, or the function would only ever be shown
	 * to agree with its own output. `applyOverrides` and `repairContrast` are each tested on their
	 * own terms elsewhere in this file; this is the one test that reads the compose back as those two
	 * calls made by hand.
	 */
	it('deep-equals repairContrast composed onto applyOverrides by hand, for blue', () => {
		const base = sweptSet('blue');
		const { overrides, unrepaired, report } = repairContrast(base);

		expect(withContrastRepairs(base)).toEqual({
			tokenSet: applied(base, overrides),
			unrepaired,
			report,
		});
	});

	// The report is what #15's DESIGN.md and the store's `contrast.repairs` carry. An empty one would
	// deep-equal an empty hand-composed one, so this pins that blue actually reports its moves.
	it('reports every move it applied, each landing on the colour the returned set paints', () => {
		const { tokenSet, report } = withContrastRepairs(sweptSet('blue'));
		const lastMove = new Map(
			report.map((entry) => [`${entry.scheme}:${entry.ramp}.${entry.step}`, entry]),
		);

		expect(report.length).toBeGreaterThan(0);

		for (const entry of lastMove.values()) {
			const painted = tokenSet.schemes[entry.scheme].primitives[entry.ramp]![entry.step - 1]!;

			expect(painted, `${entry.scheme} ${entry.ramp}.${entry.step}`).toMatchObject(entry.to);
		}
	});

	it('passes AA everywhere for every seed in the sweep', () => {
		for (const { tokenSet } of swept) {
			const { tokenSet: repaired } = withContrastRepairs(tokenSet);

			expect(checkContrast(repaired).filter((entry) => !entry.passes)).toEqual([]);
		}
	});

	/**
	 * An options bag reaches `repairContrast` unchanged. Checked against a hand-composed call with
	 * the same options, as the no-argument case above is checked against one with none, so this
	 * can't pass by dropping the pin on the way through.
	 */
	it('forwards a pinned set to repairContrast, never falling back to defaultPins', () => {
		const base = sweptSet('blue');
		const pinned = new Set([...observedSteps(base), pinKey('light', 'brand', 1)]);
		const { overrides, unrepaired, report } = repairContrast(base, { pinned });

		expect(withContrastRepairs(base, { pinned })).toEqual({
			tokenSet: applied(base, overrides),
			unrepaired,
			report,
		});
		// `brand.1` is the step the no-options case above moves for blue (see the "pins" describe
		// block), so pinning it here and getting a different set proves the option reached
		// `repairContrast` and isn't a no-op that happened to match.
		expect(withContrastRepairs(base)).not.toEqual(withContrastRepairs(base, { pinned }));
	});
});

function seedOf(overrides: Partial<BrandSeed>): BrandSeed {
	return BrandSeedSchema.parse({
		keyColors: null,
		neutralTemperature: null,
		radiusCharacter: null,
		shadowCharacter: null,
		trackingFeel: null,
		typeClassification: null,
		suggestedPairing: null,
		typeScaleRatio: null,
		imageClassifications: null,
		expressive: null,
		...overrides,
	});
}

function baseFor(seed: BrandSeed): TokenSet {
	const result = createOklchScaleEngine().generate(seed, BALANCED);

	if (!result.ok) throw new Error(`the scale engine rejected the seed: ${result.error.kind}`);

	return buildTokenSet(result.schemes, seed, BALANCED);
}

const moved = (overrides: readonly TokenOverride[]) =>
	overrides.map((o) => (o.kind === 'primitive' ? `${o.scheme}:${o.ramp}.${o.step}` : o.kind));

describe('a pinned key colour decides the move (#146)', () => {
	// At lightness 0.62 the light `primary-foreground` fails on `primary`. Darkening the text
	// (`brand.1`) takes 0.79 L, and darkening the fill (`brand.9`) takes 0.033.
	const seed = seedOf({
		keyColors: [
			{
				oklch: [0.62, 0.21, 35.2],
				proposedRole: 'brand',
				sourceImageId: 'img-1',
				sourceRegion: null,
			},
			{
				oklch: [0.71, 0.14, 145],
				proposedRole: 'accent',
				sourceImageId: 'img-1',
				sourceRegion: null,
			},
		],
	});
	const base = baseFor(seed);
	const run = (pins: SeedPinPath[]) => repairContrast(base, { pinned: repairPinsFor(seed, pins) });

	it('moves the text, never brand.9, while the brand key colour is pinned', () => {
		const { overrides } = run(['keyColors.0', 'keyColors.1']);

		expect(moved(overrides)).toContain('light:brand.1');
		expect(moved(overrides).filter((step) => step.endsWith(':brand.9'))).toEqual([]);
	});

	it('moves brand.9 instead once the brand key colour is unpinned', () => {
		const { overrides } = run(['keyColors.1']);

		expect(moved(overrides)).toContain('light:brand.9');
		expect(moved(overrides)).not.toContain('light:brand.1');
	});

	it('gives an accent-only pin the same overrides as no pin at all', () => {
		expect(run(['keyColors.1']).overrides).toEqual(run([]).overrides);
	});
});

describe('a pinned accent key colour decides the move too (#146)', () => {
	// No declared pair aliases an accent step, so `primary` is pointed at `accent.9` by hand. That's
	// the only way to reach the accent half of `KEY_COLOUR_RAMPS`, and without it dropping `accent`
	// from that set leaves every other test green while the accent pin quietly decides nothing.
	const seed = seedOf({
		keyColors: [
			{
				oklch: [0.71, 0.14, 145],
				proposedRole: 'brand',
				sourceImageId: 'img-1',
				sourceRegion: null,
			},
			{
				oklch: [0.62, 0.21, 35.2],
				proposedRole: 'accent',
				sourceImageId: 'img-1',
				sourceRegion: null,
			},
		],
	});
	const onAccent = applied(
		baseFor(seed),
		SCHEME_NAMES.map(
			(scheme) => ({ kind: 'alias', scheme, token: 'primary', alias: 'accent.9' }) as const,
		),
	);
	const run = (pins: SeedPinPath[]) =>
		repairContrast(onAccent, { pinned: repairPinsFor(seed, pins) });

	it('moves the text while the accent key colour is pinned, and accent.9 once it is not', () => {
		expect(moved(run(['keyColors.0', 'keyColors.1']).overrides)).not.toContain('light:accent.9');
		expect(moved(run(['keyColors.0']).overrides)).toContain('light:accent.9');
	});
});

describe('the smaller-move rule stays on key-colour pairs (#146)', () => {
	// `artwork-dashboard`'s brand and neutral temperature. Its light `muted-foreground` fails on
	// `muted`, and the background (`neutral.3`, +0.006227) is the smaller move there, so a rule
	// applied to every pair would move it rather than `neutral.11` (−0.006324).
	it('keeps foreground-first on a pair with no key colour step', () => {
		const seed = seedOf({
			keyColors: [
				{
					oklch: [0.76, 0.19, 198],
					proposedRole: 'brand',
					sourceImageId: 'img-1',
					sourceRegion: null,
				},
			],
			neutralTemperature: { hue: 255, chroma: 0.018 },
		});
		const { report } = repairContrast(baseFor(seed), { pinned: new Set() });
		const muted = report.find((entry) => entry.foreground === 'muted-foreground');

		expect(muted).toMatchObject({
			scheme: 'light',
			moved: 'foreground',
			ramp: 'neutral',
			step: 11,
		});
	});
});

// `neutral.12` at 0.6 fails on `background`. The first move clears that but still fails on a
// `card` darkened to 0.85, so the loop moves `neutral.12` a second time.
const blueNeutral = (step: number) => stepOf(sweptSet('blue'), 'light', 'neutral', step);
const midToneText: TokenOverride = {
	kind: 'primitive',
	scheme: 'light',
	ramp: 'neutral',
	step: 12,
	l: 0.6,
	c: blueNeutral(12).c,
	h: blueNeutral(12).h,
};
const forcedDoubleMove = (() => {
	const at = blueNeutral;

	return applied(sweptSet('blue'), [
		midToneText,
		{
			kind: 'primitive',
			scheme: 'light',
			ramp: 'neutral',
			step: 2,
			l: 0.85,
			c: at(2).c,
			h: at(2).h,
		},
	]);
})();

describe('a step repair moves twice (#146, PR #180 r4146678515)', () => {
	it('reports one entry for the step, carrying the colour its override ships', () => {
		const { overrides, report, unrepaired } = repairContrast(forcedDoubleMove, {
			pinned: defaultPins(forcedDoubleMove),
		});

		// A loop that stopped after the first move would also leave one entry matching its override.
		expect(unrepaired).toEqual([]);
		const entries = report.filter(
			(e) => e.scheme === 'light' && e.ramp === 'neutral' && e.step === 12,
		);
		const override = overrides.find(
			(o) =>
				o.kind === 'primitive' && o.scheme === 'light' && o.ramp === 'neutral' && o.step === 12,
		);

		expect(entries).toHaveLength(1);
		expect(override).toMatchObject(entries[0]!.to);
	});

	// Without this the case above could pass on a fixture that only ever moved `neutral.12` once.
	// The first move solves against `background` alone, the same solve as on a set with `card` left
	// alone, so that set's override is the first move's colour, and it has to fail the darkened card.
	it('needs that second move: the colour clearing `background` alone still fails `card`', () => {
		const backgroundOnly = applied(sweptSet('blue'), [midToneText]);
		const first = repairContrast(backgroundOnly, {
			pinned: defaultPins(backgroundOnly),
		}).overrides.find(
			(o) =>
				o.kind === 'primitive' && o.scheme === 'light' && o.ramp === 'neutral' && o.step === 12,
		);
		const card = resolveScheme(forcedDoubleMove.schemes.light).card!;

		expect(first).toBeDefined();
		expect(renderedContrast(first as Oklch, card)).toBeLessThan(4.5);
	});
});

describe('the report matches the set it describes (#146)', () => {
	const cases = [
		...swept.map(({ name, tokenSet }) => [name, tokenSet] as const),
		['forced double move', forcedDoubleMove] as const,
	];

	it.each(cases)(
		'names the overrides in order, each achieved ratio painted by the result, for %s',
		(_name, input) => {
			const pinned = defaultPins(input);
			const { overrides, report } = repairContrast(input, { pinned });
			const { tokenSet } = withContrastRepairs(input, { pinned });

			expect(report.map((e) => `${e.scheme}:${e.ramp}.${e.step}`)).toEqual(moved(overrides));

			for (const entry of report) {
				const colours = resolveScheme(tokenSet.schemes[entry.scheme]);

				expect(entry.achieved).toBe(
					renderedContrast(colours[entry.foreground]!, colours[entry.background]!),
				);
			}
		},
	);
});
