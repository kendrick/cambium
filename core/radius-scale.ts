import type { BrandSeed } from './brand-seed';
import type { Dimension, RadiusScale } from './token-set';

/**
 * Names and order come from `app/globals.css`, the vendored Tailwind v4 theme: it declares
 * `--radius` plus `--radius-sm` through `--radius-4xl`, so an adapter emitting `--radius-xl` has to
 * land on a name Tailwind already resolves rather than a name this module is free to pick.
 */
const STEPS = ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;

/**
 * Per-progression multipliers against the anchor, in step order. `soft` is copied verbatim from
 * `app/globals.css`'s `calc(var(--radius) * n)` chain, which is what lets that table claim an
 * external authority instead of being seven numbers someone picked. `sharp` and `pill` scale the
 * same shape tighter and looser so a brand's character changes how fast the scale climbs, never
 * whether it climbs.
 */
const MULTIPLIERS: Record<NonNullable<BrandSeed['radiusCharacter']>['progression'], number[]> = {
	sharp: [0.4, 0.7, 1, 1.2, 1.4, 1.6, 1.8],
	soft: [0.6, 0.8, 1, 1.4, 1.8, 2.2, 2.6],
	pill: [0.8, 0.9, 1, 1.8, 2.8, 4.0, 5.6],
};

/** `--radius: 0.625rem` in `app/globals.css`; a seed that measured nothing falls back to it. */
const FALLBACK_BASE_PX = 10;

/**
 * A model reads a corner radius off a reference image in pixels, and a rounded hero card can read
 * back in the hundreds. Left unclamped that ships a 4xl step wider than most components, so the
 * ceiling matches the widest radius an interface plausibly uses.
 */
const MAX_BASE_PX = 32;

export function radiusScale(character: BrandSeed['radiusCharacter']): RadiusScale {
	const { base, progression } = character ?? { base: FALLBACK_BASE_PX, progression: 'soft' };
	const clampedPx = Math.min(Math.max(base, 0), MAX_BASE_PX);
	const anchorRem = clampedPx / 16;
	const multipliers = MULTIPLIERS[progression];

	const values = Object.fromEntries(
		STEPS.map((step, i): [string, Dimension] => [
			step,
			{ value: anchorRem * multipliers[i]!, unit: 'rem' },
		]),
	) as Record<(typeof STEPS)[number], Dimension>;

	return { source: 'derived', values };
}
