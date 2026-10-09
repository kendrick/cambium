import { type OklchCssColor, toOklchCss } from '../../../core/css/oklch-css';
import type { ValuePath } from '../../../core/token-overrides';

/** DTCG's cubic-bezier tuple is `[x1, y1, x2, y2]`; nothing else in the set carries a numeric tuple. */
const EASING_PARAM_LABELS = ['x1', 'y1', 'x2', 'y2'];

/**
 * A leaf's path relative to its token, turned into a short label beside its input. Most tokens
 * carry one leaf named `value`, where the label is just that; a shadow or an easing curve carries
 * several, and the label is what tells their inputs apart without repeating the token's own name.
 */
export function leafLabel(suffix: ValuePath): string {
	if (suffix.length === 1 && suffix[0] === 'value') return 'value';

	const last = suffix.at(-1);

	if (typeof last === 'number' && suffix.at(-2) === 'value') {
		return EASING_PARAM_LABELS[last] ?? `value[${last}]`;
	}

	// A trailing `value` reads as noise once the segment before it already names the field, e.g.
	// `offsetX.value` becomes `offsetX`.
	return suffix
		.filter((segment, index) => !(segment === 'value' && index === suffix.length - 1))
		.join('.');
}

/** Decimals an OKLCH channel prints at on screen. Exports keep `toOklchCss`'s own default. */
const DISPLAY_OKLCH_PLACES = 3;

/** Significant figures a length prints at on screen. */
const DISPLAY_SIGNIFICANT_FIGURES = 3;

/**
 * A colour as the token list needs it: `paint` for `backgroundColor`, `text` for a person to read.
 * One object so a caller can't paint the rounded string. Rounding the paint can move an 8-bit
 * channel by one, the #70 straddle, while the rounded text only has to be readable.
 */
export type Swatch = { paint: string; text: string };

export function swatchOf(color: OklchCssColor): Swatch {
	return {
		paint: toOklchCss(color),
		text: toOklchCss(color, { places: DISPLAY_OKLCH_PLACES }),
	};
}

/**
 * Display only. `toPrecision` goes through `Number` so 1234.5 prints `1230` and not `1.23e+3`,
 * and so a trailing zero drops (`2.10` prints `2.1`, the way `formatCssNumber` writes the file).
 */
export function formatSignificant(value: number, figures = DISPLAY_SIGNIFICANT_FIGURES): string {
	const rounded = Number(value.toPrecision(figures));

	return rounded === 0 ? '0' : String(rounded);
}

const CSS_LENGTH = /^(-?\d+(?:\.\d+)?)([a-z%]*)$/;

/**
 * A CSS length as the preview prints it. The declaration it came from keeps full precision and is
 * what the specimen paints with. Anything that isn't one number and a unit comes back unchanged,
 * since printing it as written beats printing a guess.
 */
export function formatLengthForDisplay(css: string): string {
	const match = CSS_LENGTH.exec(css);
	if (!match) return css;

	return `${formatSignificant(Number(match[1]))}${match[2]}`;
}
