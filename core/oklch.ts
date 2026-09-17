import {
	converter,
	inGamut,
	modeLrgb,
	modeOklch,
	modeP3,
	modeRgb,
	toGamut,
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
 * colour that came from eight-bit sRGB out of gamut, and then gamut mapping moves it by 9e-5 to
 * correct an error a million times smaller. A channel this far out rounds to the same byte.
 */
const SRGB_EPSILON = 1e-6;
const fitToSrgb = toGamut('rgb', 'oklch');

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
 * Chroma reduction at constant lightness and hue, which is what CSS Color 4 gamut mapping does and
 * what keeps a repaired colour recognisably the same colour. Returned in OKLCH rather than sRGB so
 * a caller never has to convert back and pick up a rounding difference on the way.
 *
 * The tiny negative channels `toGamut` can leave behind are a float artifact, not a colour outside
 * the gamut, so the result is re-read through OKLCH rather than trusted as-is.
 */
export function fitToSrgbGamut(color: Oklch): Oklch {
	if (isInSrgb(color)) return color;

	return readOklch(fitToSrgb({ mode: 'oklch', ...color }) as Oklch);
}

/** Fixed-precision rounding with negative zero folded away, so serialized output compares equal. */
function roundTo(value: number, places: number): number {
	const scale = 10 ** places;
	const rounded = Math.round(value * scale) / scale;

	return rounded === 0 ? 0 : rounded;
}

/**
 * Rounds to a fixed precision and guarantees the result is still inside sRGB.
 *
 * Rounding after gamut mapping is what makes the second half necessary. `toGamut` lands a colour
 * exactly on the gamut boundary, and rounding a boundary value outward puts it back outside, so a
 * ramp that was mapped correctly still fails an `inGamut` check by a millionth. Backing chroma off
 * in small steps is bounded, deterministic, and invisible at six decimal places.
 */
export function quantizeToSrgb(color: Oklch, places = 6): Oklch {
	const factor = 10 ** places;

	let candidate = {
		l: roundTo(color.l, places),
		c: roundTo(color.c, places),
		h: roundTo(((color.h % 360) + 360) % 360, 4),
	};

	// Two dozen attempts back chroma off by 24 millionths at most. A colour needing more than that
	// was not a rounding artifact, and looping further would hide a real bug behind a slow clamp.
	for (let attempt = 0; attempt < 24 && !isInSrgb(candidate); attempt += 1) {
		candidate.c = roundTo(Math.max(0, candidate.c - 1 / factor), places);
	}

	return candidate;
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
