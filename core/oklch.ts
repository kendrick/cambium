import {
	converter,
	inGamut,
	modeLrgb,
	modeOklch,
	modeP3,
	modeRgb,
	useMode,
	wcagContrast,
} from 'culori/fn';

/**
 * culori's `/fn` entry starts with nothing registered, so every mode the call graph reaches has to
 * be declared here. The barrel `culori` import registers everything and costs 23.4 kB gzip against
 * the 24.6 kB of first-load headroom `lib/bundle-budget.ts` defends. This set costs 8.0 kB.
 *
 * `lrgb` is the one that looks redundant beside `rgb` and is not. `wcagContrast` computes luminance
 * through `converter('lrgb')`, so omitting it throws `converters[mode].rgb is not a function` on the
 * first contrast call. Nothing catches that at build time or at typecheck, and `pnpm test` does not
 * run the bundle project either, so both failure modes here are runtime-only. See ADR-0003.
 */
useMode(modeRgb);
useMode(modeLrgb);
useMode(modeOklch);
useMode(modeP3);

const toOklch = converter('oklch');
const toRgb = converter('rgb');
const inP3 = inGamut('p3');

/**
 * How far a channel may sit outside 0 through 1 and still count as displayable.
 *
 * culori's own `inGamut('rgb')` is exact, and exact is the wrong question here. Converting the hex
 * `#0090ff` to OKLCH and back lands its red channel on roughly -1e-16, so an exact check calls a
 * colour that came from eight-bit sRGB out of gamut and sends it off to be corrected. A channel
 * this far out rounds to the same byte and needs no correcting.
 */
const SRGB_EPSILON = 1e-6;

/** The three OKLCH channels, in the shape `RampStepSchema` stores them. */
export type Oklch = { l: number; c: number; h: number };

/**
 * Hue is meaningless at zero chroma and culori reports it as `NaN` there, which then poisons every
 * average, comparison and serialization it reaches. Collapsing it to zero at the boundary is the
 * same move `HueSchema` makes for a seed, and for the same reason: one colour, one spelling.
 */
function canonicalHue(hue: number | undefined): number {
	return Number.isFinite(hue) ? (hue as number) % 360 : 0;
}

export function readOklch(color: string | Oklch): Oklch {
	const converted = toOklch(typeof color === 'string' ? color : { mode: 'oklch', ...color })!;

	// The declaration keeps every channel optional because one `CuloriColor` shape covers rgb and
	// oklch alike. A converted oklch colour always carries l and c; the fallbacks are there to say
	// so to the type checker, not because the value is ever really missing.
	return { l: converted.l ?? 0, c: converted.c ?? 0, h: canonicalHue(converted.h) };
}

export function isInSrgb(color: Oklch): boolean {
	const rgb = toRgb({ mode: 'oklch', ...color });

	if (!rgb) return false;

	return [rgb.r ?? 0, rgb.g ?? 0, rgb.b ?? 0].every(
		(channel) => channel >= -SRGB_EPSILON && channel <= 1 + SRGB_EPSILON,
	);
}

/**
 * Only the contract suite uses this, and it earns its place there. A test that claims to exercise
 * the P3 path has to prove its input really is a P3 colour rather than an impossible one: at the
 * lightness and hue of a plausible brand blue, a chroma high enough to leave sRGB has usually left
 * P3 as well, so a seed picked by eye tests gamut clamping and nothing about P3.
 */
export function isInP3(color: Oklch): boolean {
	return inP3({ mode: 'oklch', ...color });
}

/**
 * The highest chroma that still renders at this exact lightness and hue.
 *
 * At a fixed lightness and hue the displayable chromas are the interval from zero up to some
 * ceiling, because the achromatic colour at any lightness is always displayable and adding chroma
 * only ever moves outward. So a bisection finds the edge, and every value it returns is inside.
 */
function maxChromaAt(l: number, h: number, ceiling: number): number {
	if (isInSrgb({ l, c: ceiling, h })) return ceiling;

	let inside = 0;
	let outside = ceiling;

	// Thirty halvings take the interval well below the six decimal places the result is quantized
	// to, so further refinement would only produce digits the rounding discards.
	for (let i = 0; i < 30; i += 1) {
		const mid = (inside + outside) / 2;

		if (isInSrgb({ l, c: mid, h })) {
			inside = mid;
		} else {
			outside = mid;
		}
	}

	return inside;
}

/**
 * Chroma reduction at constant lightness and hue, which is what CSS Color 4 gamut mapping sets out
 * to do and what keeps a clamped colour recognisably the same colour.
 *
 * Done by bisection rather than through culori's `toGamut`, which does not hold hue: asked to fit a
 * saturated colour it can move the hue by several degrees, and on the steep part of the blue
 * boundary by far more. That drift is invisible in a single ramp and corrupts anything downstream
 * that reasons about hue, such as keeping an accent clear of the hue reserved for danger.
 */
export function fitToSrgbGamut(color: Oklch): Oklch {
	if (isInSrgb(color)) return color;

	return { l: color.l, c: maxChromaAt(color.l, color.h, color.c), h: color.h };
}

/** Fixed-precision rounding with negative zero folded away, so serialized output compares equal. */
function roundTo(value: number, places: number): number {
	const scale = 10 ** places;
	const rounded = Math.round(value * scale) / scale;

	return rounded === 0 ? 0 : rounded;
}

/** Rounds to a fixed precision and guarantees the result is still displayable. */
export function quantizeToSrgb(color: Oklch, places = 6): Oklch {
	const factor = 10 ** places;
	const l = roundTo(color.l, places);
	const h = roundTo(((color.h % 360) + 360) % 360, 4);

	// Lightness and hue are rounded first, then chroma is clamped against those rounded values and
	// floored rather than rounded to nearest.
	//
	// Both halves matter. Rounding lightness moves the gamut boundary out from under a chroma that
	// was fitted against the unrounded value, and on the steep part of the blue boundary a move of
	// one ten-millionth in lightness costs far more chroma than rounding alone would give back.
	// Flooring then guarantees the last digit cannot round outward, because reducing chroma only
	// ever moves toward the achromatic axis, which is displayable at every lightness.
	// Rounded onto the grid, then stepped down only while the result is still outside. Flooring
	// instead would not be idempotent: `0.243827 * 1e6` is not exactly an integer in binary, so a
	// floor shaves another millionth every time the function runs, and regenerate-and-diff drifts.
	let units = Math.round(maxChromaAt(l, h, color.c) * factor);

	while (units > 0 && !isInSrgb({ l, c: units / factor, h })) {
		units -= 1;
	}

	const c = units / factor;

	return { l, c: c === 0 ? 0 : c, h };
}

/**
 * The lightness closest to `from` that clears a WCAG floor against `background`, holding hue and
 * chroma. Contrast rises monotonically as a colour moves away from its background, so a bisection
 * converges on the least change that satisfies the target.
 *
 * This is target solving during generation, not the repair loop in #8. Repair fixes a declared
 * semantic pair after the fact and has to leave pinned tokens alone; this just answers what
 * lightness a step needs in order to meet the number the table already declared for it.
 */
export function solveLightnessForContrast(
	from: Oklch,
	background: Oklch,
	floor: number,
	direction: -1 | 1,
): number {
	if (contrastFromOklch(from, background) >= floor) return from.l;

	let near = from.l;
	let far = direction < 0 ? 0 : 1;

	if (contrastFromOklch({ ...from, l: far }, background) < floor) return far;

	// Forty halvings take the interval below a millionth of a lightness unit, which is finer than
	// the six decimal places the result is quantized to. More iterations would refine digits that
	// rounding then discards.
	for (let i = 0; i < 40; i += 1) {
		const mid = (near + far) / 2;

		if (contrastFromOklch({ ...from, l: mid }, background) >= floor) {
			far = mid;
		} else {
			near = mid;
		}
	}

	return far;
}

export function contrastFromOklch(a: Oklch, b: Oklch): number {
	return wcagContrast({ mode: 'oklch', ...a }, { mode: 'oklch', ...b });
}

/**
 * Hue is an angle and chroma scales how much a hue shift is worth: at zero chroma a hue difference
 * is invisible, so weighting the arc by chroma keeps two near-greys from reading as far apart.
 */
export function oklchDistance(a: Oklch, b: Oklch): number {
	const arc = Math.abs(((a.h - b.h + 540) % 360) - 180) * (Math.PI / 180);
	const chord = arc * Math.min(a.c, b.c);

	return Math.hypot(a.l - b.l, a.c - b.c, chord);
}

/**
 * How far apart two hues are on the circle, 0 through 180. Unsigned, because every caller asks
 * whether two colours read as the same hue and none of them cares which way round they sit.
 */
export function hueDistance(a: number, b: number): number {
	return Math.abs(((a - b + 540) % 360) - 180);
}
