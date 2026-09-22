import type { BrandSeed, OklchTriple } from './brand-seed';
import type { InterpretationParams } from './interpretation';
import type { Ramp } from './token-set';

/**
 * Seven ramps, fixed. Six of them line up with the `proposedRole` values a key color can carry;
 * `neutral` is the odd one out because a seed states it as a temperature rather than as a color,
 * which is also why it is the only ramp whose step 9 differs between light and dark.
 */
export const RAMP_NAMES = [
	'brand',
	'accent',
	'neutral',
	'danger',
	'warning',
	'success',
	'info',
] as const;

export type RampName = (typeof RAMP_NAMES)[number];

/** Both schemes are generated independently against the same step roles, never inverted. */
export const SCHEME_NAMES = ['light', 'dark'] as const;

export type SchemeName = (typeof SCHEME_NAMES)[number];

/**
 * How far step 9 may sit from the colour the seed asked for and still count as reproducing it.
 *
 * Stated on the seam rather than inside an engine because it is a promise to the caller, not an
 * implementation detail: "within a stated tolerance" is only meaningful if a reader can find the
 * number, and the contract holds every engine to this one.
 */
export const ANCHOR_TOLERANCE = 0.02;

/**
 * Keyed by ramp name rather than an array, because the semantic layer in #6 addresses ramps by
 * name and steps by number. The shape is deliberately assignable to `PrimitiveLayerSchema`, which
 * is what #6 consumes.
 */
export type RampSet = Record<RampName, Ramp>;

/**
 * What step 9 of the brand ramp actually came out as, against what the seed asked for.
 *
 * Step 9 is the seed's brand color placed directly, in both schemes, which is what Radix does for
 * every chromatic scale and what "step 9 is the pure brand color" has to mean. So the only thing
 * that moves it is gamut mapping: a seed carrying a chroma no sRGB display can show gets clamped,
 * and a token set that quietly shipped a different brand color than the one it was handed would be
 * worse than one that says so.
 */
export type BrandAnchor = {
	requested: OklchTriple;
	achieved: OklchTriple;
	/** Euclidean distance in OKLCH, with hue weighted by chroma so a gray's hue drift is cheap. */
	deviation: number;
	withinTolerance: boolean;
};

export type ScaleEngineError =
	/** No key colour means no brand, and inventing one from nothing is not interpretation. */
	| { kind: 'no-key-colors' }
	/**
	 * A step declared a contrast floor that no lightness could reach at its hue and chroma.
	 *
	 * Unreachable for every seed tested so far, and kept anyway: the alternative is returning a ramp
	 * that quietly misses a floor it claims to meet, which is the one failure a caller cannot see.
	 */
	| { kind: 'unreachable-floor'; ramp: RampName; step: number };

export type ScaleEngineResult =
	| {
			ok: true;
			schemes: Record<SchemeName, RampSet>;
			anchor: BrandAnchor;
			error?: never;
	  }
	| { ok: false; schemes?: never; anchor?: never; error: ScaleEngineError };

/**
 * Synchronous because it is arithmetic. Nothing here reads a file, a network, or a clock, which is
 * what lets `core/purity.test.ts` guard it and what the headless CLI in #5 depends on.
 *
 * `id` is persisted on every version as `scaleEngine`, because the same seed under a different
 * engine produces different ramps and a stored token set has to say which one made it.
 */
export type ScaleEngine = {
	readonly id: string;
	generate(seed: BrandSeed, params: InterpretationParams): ScaleEngineResult;
};
