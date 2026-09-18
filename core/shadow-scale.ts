import type { BrandSeed } from './brand-seed';
import { fitToSrgbGamut, type Oklch } from './oklch';
import type { Shadow, ShadowScale } from './token-set';

const STEPS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

/** Geometry per elevation step, before the diffusion and darkness modifiers below. */
const BASE = [
	{ offsetY: 1, blur: 2, spread: 0 },
	{ offsetY: 2, blur: 4, spread: -1 },
	{ offsetY: 4, blur: 6, spread: -1 },
	{ offsetY: 10, blur: 15, spread: -3 },
	{ offsetY: 20, blur: 25, spread: -5 },
] as const;

/**
 * Opacity per step on a white page and on a black one, mixed by how dark the surface actually is.
 *
 * Two tables rather than one table and a multiplier, because the two ends need different shapes
 * and not only different sizes. A dark page resolves near lightness 0.188 and its shadow sits at
 * 0.028, so there is 0.16 of lightness between them where a white page has 0.85. Scaling the white
 * ramp up until its smallest step showed drove the largest to an opacity of 0.75, which is a black
 * slab rather than a shadow. The dark ramp is compressed as well as raised.
 *
 * Against the generated schemes these land at 0.05 to 0.15 in light and 0.32 to 0.71 in dark.
 */
const ON_WHITE_ALPHA = [0.05, 0.07, 0.1, 0.12, 0.15] as const;
const ON_BLACK_ALPHA = [0.38, 0.48, 0.6, 0.7, 0.84] as const;

/**
 * How much darker than its page a shadow has to render before it counts as one, in OKLCH
 * lightness, measured after real sRGB compositing.
 *
 * Exported because `core/shadow-scale.test.ts` and `core/derive-non-color.test.ts` both assert
 * against it. This module and its tests disagreeing about the bar is how the defect survived four
 * rounds of fixing, so there is one number and both sides read it.
 *
 * 0.02 is a judgement call with one fact under it: the generated dark page sits at byte 19 of 255,
 * and the smallest step clears it by 7 bytes there. That is a change a display can render and an
 * eye can find. The largest moves it by 14, and the light scheme runs 12 to 37.
 *
 * Measured after compositing in gamma-encoded sRGB, which is what browsers do for ordinary
 * content. That choice carries weight and is worth stating: compositing in linear light instead
 * gives smaller numbers, and the light scheme's smallest step reads 0.0175 under it. The dark
 * scheme clears 0.02 under both models, which is where the floor actually has to hold, because
 * dark is the scheme with no room to spare.
 */
export const MIN_RENDERED_DARKENING = 0.02;

/**
 * The darkest page these ramps still clear `MIN_RENDERED_DARKENING` on, at every step.
 *
 * A shadow is the surface with light taken out of it, so a page with no light left cannot show
 * one: at lightness 0 every step composites to exactly the page it sits on, whatever its opacity.
 * The guarantee therefore has a floor under it, and stating the floor is what keeps the guarantee
 * from being an accident of the one page the scale engine happens to emit.
 *
 * It sat at 0.177 against a dark page of 0.188 before this was written down, which is 3% of head
 * room and nothing pinning the two together. `core/shadow-scale.test.ts` pins the ramps to this
 * number and `core/derive-non-color.test.ts` pins the generated page above it, so moving either
 * one fails rather than quietly shipping an invisible shadow.
 */
export const MIN_VISIBLE_SURFACE_LIGHTNESS = 0.16;

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
 * aliases `neutral.1`, and a page background is near-achromatic by design: it measures around
 * 0.0002 in light and 0.0007 in dark, rising with the seed's own chroma and staying far under
 * 0.002. Passing that number through would satisfy "derives from the surface" on paper while
 * shipping exactly the black-at-an-opacity #7 set out to avoid.
 *
 * So the surface supplies the hue, which it carries faithfully, and the depth of the tint is a
 * constant. Subtle on purpose: a shadow that announces its colour stops reading as a shadow.
 *
 * It is a ceiling rather than a promise. sRGB holds almost no chroma near black, so a shadow on a
 * dark page reaches between 0.0048 at hue 200 and 0.0194 at hue 265, and comes out near-black
 * whichever hue it lands on. That is the honest answer
 * rather than a shortfall: lifting its lightness until 0.02 fits would leave the shadow barely
 * darker than the page it falls on, which is not a shadow. #7 records the trade.
 */
const SHADOW_CHROMA = 0.02;

/** How far blur climbs as the surface darkens. Opacity has its own ramp above. */
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
					color: {
						...color,
						alpha: ON_WHITE_ALPHA[i]! + (ON_BLACK_ALPHA[i]! - ON_WHITE_ALPHA[i]!) * darkness,
					},
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
