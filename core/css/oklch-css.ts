import type { Oklch } from '../oklch';

/** Options controlling how {@link toOklchCss} rounds a colour's channels before they print. */
export type OklchCssOptions = {
	/**
	 * Decimal places each channel rounds to before it prints. Defaults to 6 — the precision
	 * `quantizeToSrgb` (`core/oklch.ts`) already settles the sRGB round trip on, so a declaration
	 * this module writes and the byte `quantizeToSrgb` checked against are never two different
	 * roundings of what is supposed to be the same value.
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
	const places = options.places ?? 6;
	const triple = `${formatChannel(color.l, places)} ${formatChannel(color.c, places)} ${formatChannel(color.h, places)}`;

	if (color.alpha === undefined) return `oklch(${triple})`;

	return `oklch(${triple} / ${formatChannel(color.alpha * 100, places)}%)`;
}

function formatChannel(value: number, places: number): string {
	const rounded = roundTo(value, places);

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
