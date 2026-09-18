import type { BrandSeed } from './brand-seed';
import type { Oklch } from './oklch';
import type { Shadow, ShadowScale } from './token-set';

const STEPS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

/** Geometry and opacity per elevation step, before the diffusion and darkness modifiers below. */
const BASE = [
	{ offsetY: 1, blur: 2, spread: 0, alpha: 0.05 },
	{ offsetY: 2, blur: 4, spread: -1, alpha: 0.07 },
	{ offsetY: 4, blur: 6, spread: -1, alpha: 0.1 },
	{ offsetY: 10, blur: 15, spread: -3, alpha: 0.12 },
	{ offsetY: 20, blur: 25, spread: -5, alpha: 0.15 },
] as const;

/**
 * How much of the surface's lightness a shadow keeps. A shadow is the surface with the light taken
 * out of it, which is also what keeps a light and a dark page's shadows apart in lightness as well
 * as in opacity.
 */
const SHADOW_LIGHTNESS = 0.15;

/**
 * The floor under that, and it is a gamut constraint rather than a taste one.
 *
 * A dark page resolves `neutral.1` near lightness 0.188, so the fraction above puts its shadow at
 * 0.028, and sRGB holds almost no chroma that far down. `SHADOW_CHROMA` would be silently clamped
 * past by the display, which is the invisible-tint bug again wearing a number that looks right in
 * the token file.
 *
 * Hue 200 binds at every lightness, and swept in two-degree steps it reaches 0.0170 at lightness
 * 0.10, 0.0204 at 0.12, and 0.0238 at 0.14. So 0.14 is the lowest floor that clears 0.02 at every
 * hue with room to spare, and a shadow there still sits under a dark page's own lightness.
 *
 * The cost is worth stating: a dark page is already near this floor, so the two schemes' shadow
 * colours end up close together and what really separates them is opacity and blur. #7 records
 * that. Clamping chroma to the gamut instead would keep the colours far apart and put the dark
 * scheme back on a tint of 0.0048, which is the black this derivation exists to avoid.
 */
const SHADOW_MIN_LIGHTNESS = 0.14;

/**
 * The chroma a tinted shadow carries, stated rather than read off the surface.
 *
 * Reading it off the surface is the obvious implementation and it produces black. `background`
 * aliases `neutral.1`, and a page background is near-achromatic by design: measured across seven
 * seeds it runs 0.00012 to 0.00026 in light and 0.00048 to 0.00106 in dark, which is invisible.
 * Passing that number through would satisfy "derives from the surface" on paper while shipping
 * exactly the black-at-an-opacity #7 set out to avoid.
 *
 * So the surface supplies the hue, which it carries faithfully, and the depth of the tint is a
 * constant. Subtle on purpose: a shadow that announces its colour stops reading as a shadow.
 */
const SHADOW_CHROMA = 0.02;

/** How far opacity and blur climb as the surface darkens, per unit of lightness given up. */
const DARK_ALPHA_GAIN = 1.5;
const DARK_BLUR_GAIN = 0.5;

/**
 * Elevation steps tinted by the surface they fall on.
 *
 * The surface arrives already resolved, as three OKLCH channels. That is what keeps this module
 * from learning what a ramp, an alias, or a scheme is, which is #7's "never touches the ramps or
 * the semantic colour layer", and it is why the tests here run against two synthetic surfaces
 * rather than against engine output. `core/derive-non-color.ts` owns the one read that resolves it.
 *
 * No scheme name either, for the same reason: the surface's own lightness already says how dark
 * the page is. A shadow is light the surface is not receiving, so a near-black page has very little
 * to take away, and the opacity that reads as depth on white reads as nothing there. Opacity and
 * blur both climb as the surface darkens.
 *
 * `character.spread` is the seed's word for how far the shadow diffuses, which is the blur. It is
 * not the CSS spread radius the same-named `Shadow.spread` dimension carries.
 */
export function shadowScale(surface: Oklch, character: BrandSeed['shadowCharacter']): ShadowScale {
	const diffusion = diffusionFor(character?.spread);
	const darkness = 1 - surface.l;

	// Hue is meaningless at zero chroma, and `core/oklch.ts` canonicalises it to 0 there, so a
	// genuinely achromatic page would otherwise hand back a red-tinted shadow. An interpretation
	// preset that leaves the neutral ramp untinted is the case that reaches this.
	const tinted = (character?.tintFromSurface ?? true) && surface.c > 0;

	const color = {
		l: Math.max(SHADOW_MIN_LIGHTNESS, surface.l * SHADOW_LIGHTNESS),
		c: tinted ? SHADOW_CHROMA : 0,
		h: tinted ? surface.h : 0,
	};

	const values = Object.fromEntries(
		STEPS.map((step, i): [string, Shadow] => {
			const base = BASE[i]!;

			return [
				step,
				{
					color: { ...color, alpha: base.alpha * (1 + DARK_ALPHA_GAIN * darkness) },
					offsetX: px(0),
					offsetY: px(base.offsetY),
					blur: px(base.blur * diffusion * (1 + DARK_BLUR_GAIN * darkness)),
					spread: px(base.spread),
				},
			];
		}),
	) as ShadowScale['values'];

	return { source: 'derived', values };
}

/** Null is a seed that measured no shadow character, and 1 is the honest multiplier for that. */
function diffusionFor(spread: 'tight' | 'diffuse' | undefined): number {
	if (spread === 'tight') return 0.7;
	if (spread === 'diffuse') return 1.5;

	return 1;
}

function px(value: number): { value: number; unit: 'px' } {
	return { value, unit: 'px' };
}
