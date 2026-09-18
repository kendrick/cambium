import type { BrandSeed } from './brand-seed';
import { fitToSrgbGamut, type Oklch } from './oklch';
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
 * out of it, and being visibly darker than the page is the whole of what makes it read as a shadow,
 * so this is the one number that cannot be traded away for anything else.
 */
const SHADOW_LIGHTNESS = 0.15;

/**
 * The chroma a tinted shadow carries where the gamut has room for it, stated rather than read off
 * the surface.
 *
 * Reading it off the surface is the obvious implementation and it produces black. `background`
 * aliases `neutral.1`, and a page background is near-achromatic by design: measured across seven
 * seeds it runs 0.00012 to 0.00026 in light and 0.00048 to 0.00106 in dark, which is invisible.
 * Passing that number through would satisfy "derives from the surface" on paper while shipping
 * exactly the black-at-an-opacity #7 set out to avoid.
 *
 * So the surface supplies the hue, which it carries faithfully, and the depth of the tint is a
 * constant. Subtle on purpose: a shadow that announces its colour stops reading as a shadow.
 *
 * It is a ceiling rather than a promise. sRGB holds almost no chroma near black, so a shadow on a
 * dark page reaches only about 0.0048 of it and comes out near-black. That is the honest answer
 * rather than a shortfall: lifting its lightness until 0.02 fits would leave the shadow barely
 * darker than the page it falls on, which is not a shadow. #7 records the trade.
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

	const l = surface.l * SHADOW_LIGHTNESS;

	// Clamped to what sRGB can actually show at this lightness and hue, rather than declared and
	// left for the display to clamp past. A token file stating a chroma nothing can render is the
	// same invisible tint as one stating no chroma, minus the chance of anyone noticing.
	const color = tinted ? fitToSrgbGamut({ l, c: SHADOW_CHROMA, h: surface.h }) : { l, c: 0, h: 0 };

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
