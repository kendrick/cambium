import type { Oklch } from '../oklch';

/**
 * Decimals a CSS number rounds to unless a caller says otherwise. Six is the most `quantizeToSrgb`
 * (`core/oklch.ts`) keeps on any channel, so a colour that went through it prints unchanged. See
 * {@link OklchCssOptions.places} for the hue it rounds harder.
 */
const DEFAULT_PLACES = 6;

/** Options controlling how {@link toOklchCss} rounds a colour's channels before they print. */
export type OklchCssOptions = {
	/**
	 * Decimal places each channel rounds to before it prints. Defaults to 6.
	 *
	 * `quantizeToSrgb` (`core/oklch.ts`) rounds lightness and chroma to six places and hue to four,
	 * so six here keeps every digit a quantized colour carries and printing one is lossless. That
	 * is the whole of the agreement. This function does not quantize: a colour that never went
	 * through `quantizeToSrgb` prints its hue at six places, so hue 123.456789 prints as
	 * `123.456789` where `quantizeToSrgb` would have settled on `123.4568`.
	 */
	places?: number;
};

/**
 * The three OKLCH channels plus the optional alpha a shadow colour carries and a ramp step does
 * not. `ShadowColorSchema` (`core/token-set.ts`) parses to exactly this shape with `alpha`
 * required, so a shadow colour is passed straight in.
 */
export type OklchCssColor = Oklch & { alpha?: number };

/**
 * Serializes an OKLCH colour as a CSS Color Module 4 `oklch()` function, e.g. `oklch(0.65 0.12
 * 250)` — the space-separated, comma-free form `app/globals.css` already writes for a solid color.
 *
 * A supplied alpha prints as a percentage in the slash-separated slot CSS Color 4 gives it:
 * `oklch(1 0 0 / 10%)`, the spelling `app/globals.css` uses for its own translucent borders. A
 * percentage rather than the 0-to-1 number the token holds, so an exported stylesheet reads the
 * way a hand-maintained shadcn one does. An absent `alpha` is an opaque colour and prints the bare
 * triple; `alpha: 0` is a value rather than an absence and prints `/ 0%`.
 *
 * `places` rounds the percentage rather than the 0-to-1 fraction, so a precision of 2 keeps two
 * decimals of a percent instead of two decimals of the fraction, which would be no decimals of a
 * percent at all.
 *
 * Pure: the same colour always yields the same string. Nothing here reads the DOM, the network,
 * storage, or module state, and `color` is read, never written — the same purity contract
 * `serializeDtcg` (`core/dtcg/serialize.ts`) states for the sibling DTCG adapter.
 *
 * Each channel rounds independently to `places` decimals and prints with trailing zeros trimmed,
 * so a whole value like `1` prints as `1` rather than `1.000000`, matching the compact style the
 * hand-authored reference stylesheet uses throughout. A channel that rounds to zero always prints
 * as the bare digit `0`, never `-0`: floating-point round-off can carry a channel across zero from
 * the negative side, and a literal `-0` is a value some CSS tooling still trips over even though
 * it is numerically indistinguishable from `0`.
 */
export function toOklchCss(color: OklchCssColor, options: OklchCssOptions = {}): string {
	const places = options.places ?? DEFAULT_PLACES;
	const triple = `${formatCssNumber(color.l, places)} ${formatCssNumber(color.c, places)} ${formatCssNumber(color.h, places)}`;

	if (color.alpha === undefined) return `oklch(${triple})`;

	return `oklch(${triple} / ${formatCssNumber(color.alpha * 100, places)}%)`;
}

/**
 * A number the way this repo writes one into CSS: rounded to `places`, trailing zeros trimmed,
 * negative zero folded to the bare digit.
 *
 * Exported because a `box-shadow` declaration carries four lengths and a colour, and `toGlobalsCss`
 * (`core/css/globals-css.ts`) writes the lengths while this module writes the colour. Two copies of
 * the rounding would let one declaration print its geometry at one precision and its colour at
 * another, and the comment saying they agreed was the only thing holding them together until #13's
 * review. One function is what makes the agreement structural.
 *
 * Rounding at all is about the arithmetic upstream rather than the tokens: a derived tracking step
 * or type scale is a chain of floating-point multiplications, and `0.30000000000000004em` is a
 * length every browser accepts and no reader can audit against the scale that produced it.
 *
 * Zero folds to `0`, negative zero included, for the reason `roundTo` in `core/oklch.ts` gives:
 * round-off can carry a value across zero from below, and `-0` is a literal some CSS tooling still
 * trips over even though it is numerically indistinguishable.
 */
export function formatCssNumber(value: number, places: number = DEFAULT_PLACES): string {
	const rounded = roundTo(value, places);

	// The schemas bound few of these numbers from above, and rounding scales by 10^places first, so
	// a large enough value overflows here and would print `Infinity`, which CSS reads as an
	// identifier. A custom property holding it still parses; the property reading it through
	// `var()` goes invalid at computed-value time and quietly computes as `unset`.
	if (!Number.isFinite(rounded)) {
		throw new Error(`${value} is too large to print as a CSS number at ${places} decimal places`);
	}

	if (rounded === 0) return '0';

	const fixed = rounded.toFixed(places);

	return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/** Fixed-precision rounding with negative zero folded away; mirrors `roundTo` in `core/oklch.ts`. */
function roundTo(value: number, places: number): number {
	const scale = 10 ** places;
	const rounded = Math.round(value * scale) / scale;

	return rounded === 0 ? 0 : rounded;
}
