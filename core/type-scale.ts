import type { BrandSeed } from './brand-seed';
import { derived, invented } from './provenance';
import type { Dimension, Typography } from './token-set';

/** Tailwind's own step names, in order, so a `--text-<step>` adapter finds every one of them. */
const STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;

const BASE_STEP_INDEX = 2;

/** A minor third, the closest named ratio to Tailwind's own vendored base-to-4xl spread. */
const DEFAULT_RATIO = 1.2;

/** A ratio at or below this floor stops climbing or runs the scale backwards. */
const RATIO_FLOOR = 1.05;

/** The golden ratio: the widest step anyone sets between adjacent sizes in an interface. */
const RATIO_CEILING = 1.618;

function clampRatio(ratio: number): number {
	return Math.min(RATIO_CEILING, Math.max(RATIO_FLOOR, ratio));
}

/**
 * Eight sizes and nothing else derived from the seed.
 *
 * The step names are Tailwind's own (`xs` through `4xl`), not an invented scale, because
 * `app/globals.css` is a Tailwind v4 theme: an export adapter writes `--text-lg` and needs a name
 * Tailwind already resolves, not one it has to teach the theme first.
 *
 * `base` anchors at exactly 1rem and every other step is `ratio ** (index - 2)`, so the scale
 * multiplies outward from the page's own root size rather than freezing it in px. Nothing here
 * rounds: `core/semantic-layer.ts` already sets that precedent for this core, and issue #7's "the
 * type scale follows the seed's ratio across every step" is only exact if the exponentiation is
 * exact. A rounded step would make the ratio true within a tolerance no reader can derive from the
 * output alone.
 *
 * The ratio is clamped to [1.05, 1.618] before it drives anything. At 1 the eight steps collapse
 * onto one size and below it the scale runs backwards, so the floor is what keeps the output a
 * scale at all. The ceiling is the golden ratio, the widest step anyone sets for interface type.
 *
 * A seed that measured no ratio falls back to 1.2, a minor third: Tailwind's own base-to-4xl spread
 * is 2.25x over five steps, an effective ratio of 1.176, and a minor third is the named ratio that
 * sits closest to the scale this repo already vendors.
 *
 * `weight` and `lineHeight` are stated outright, not derived from the ratio. A Brand Seed measures
 * a scale ratio and a type classification; it measures no weight axis and no leading, so there is
 * nothing on the seed for these two to track. They live inside `typography` rather than among the
 * system constants anyway, because issue #7 names the system constants exhaustively and an adapter
 * wants a weight sitting beside the sizes it labels.
 */
export function typeScale(ratio: BrandSeed['typeScaleRatio']): Typography {
	const clamped = clampRatio(ratio ?? DEFAULT_RATIO);

	/** A stated-vs-fallback ratio is a fact about the call, so it is read once for the whole set. */
	const scaledExtensions = ratio
		? derived('typeScaleRatio', "Scaled from the brand seed's stated type scale ratio")
		: invented('The seed measured no type scale ratio, so this scale falls back to a minor third');

	/**
	 * `base` is the one size the ratio cannot move, and it says so.
	 *
	 * Its exponent is zero, so `clamped ** 0` is 1 at every ratio the seed can state and at the
	 * fallback alike. Marking it `derived` on `typeScaleRatio` would claim a field informed a value
	 * it never touches, which is the same false claim as marking a brand-tracking token `invented`,
	 * with the sign flipped. The anchor is the page's own root size and nothing in a Brand Seed
	 * reaches it.
	 */
	const anchorExtensions = invented(
		"The scale anchors at the page's own root size, which no stated ratio moves",
	);

	/**
	 * Unconditional, both of them: a Brand Seed measures a scale ratio and a type classification,
	 * not a weight axis or a leading, so there is no seed field for either to track regardless of
	 * whether the ratio itself was stated.
	 */
	const weightExtensions = invented(
		"A Brand Seed measures no weight axis, so this weight is the pipeline's own default",
	);
	const lineHeightExtensions = invented(
		"A Brand Seed measures no leading, so this line height is the pipeline's own default",
	);

	const size: Record<(typeof STEPS)[number], Dimension> = {} as Record<
		(typeof STEPS)[number],
		Dimension
	>;

	STEPS.forEach((step, index) => {
		size[step] = {
			value: clamped ** (index - BASE_STEP_INDEX),
			unit: 'rem',
			$extensions: index === BASE_STEP_INDEX ? anchorExtensions : scaledExtensions,
		};
	});

	return {
		source: 'derived',
		values: {
			size,
			weight: {
				regular: { value: 400, $extensions: weightExtensions },
				medium: { value: 500, $extensions: weightExtensions },
				semibold: { value: 600, $extensions: weightExtensions },
				bold: { value: 700, $extensions: weightExtensions },
			},
			lineHeight: {
				tight: { value: 1.1, $extensions: lineHeightExtensions },
				snug: { value: 1.3, $extensions: lineHeightExtensions },
				normal: { value: 1.5, $extensions: lineHeightExtensions },
				relaxed: { value: 1.75, $extensions: lineHeightExtensions },
			},
		},
	};
}
