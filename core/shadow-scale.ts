import type { BrandSeed } from './brand-seed';
import type { Oklch } from './oklch';
import type { Shadow, ShadowScale } from './token-set';

/**
 * Issue #7: this derivation "never touches the ramps or the semantic colour layer." The surface
 * arrives here already resolved to a plain OKLCH triple; `core/derive-non-color.ts` owns the
 * single read-only lookup that resolves it against a scheme. That split is what keeps this module
 * from learning what a ramp, an alias, or a scheme is, so it takes no scheme name as an argument:
 * teaching it one would be teaching it a concept it has no business knowing.
 *
 * A shadow is light the surface is not receiving, and the surface's own lightness already carries
 * that information, which is why alpha and blur both rise as the surface darkens: the alpha that
 * reads as depth on a white page reads as nothing at all on a near-black one. The chroma ceiling on
 * a tinted shadow keeps a saturated brand surface from producing a shadow that reads as a coloured
 * glow rather than a shadow.
 *
 * `character.spread` is the seed's word for how far the shadow diffuses, i.e. the blur. It is not
 * the CSS spread radius that `Shadow.spread` carries below; the two share a name by coincidence of
 * English, not by shared meaning.
 */

const STEPS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

/** Base geometry and opacity per elevation step, before the diffusion and darkness modifiers. */
const BASE = [
	{ offsetY: 1, blur: 2, spread: 0, alpha: 0.05 },
	{ offsetY: 2, blur: 4, spread: -1, alpha: 0.07 },
	{ offsetY: 4, blur: 6, spread: -1, alpha: 0.1 },
	{ offsetY: 10, blur: 15, spread: -3, alpha: 0.12 },
	{ offsetY: 20, blur: 25, spread: -5, alpha: 0.15 },
] as const;

const CHROMA_CEILING = 0.04;

/** Null means the seed measured nothing; 1 is the neutral multiplier that leaves blur untouched for it. */
function diffusionMultiplier(spread: 'tight' | 'diffuse' | undefined): number {
	if (spread === 'tight') return 0.7;
	if (spread === 'diffuse') return 1.5;
	return 1;
}

function px(value: number): { value: number; unit: 'px' } {
	return { value, unit: 'px' };
}

export function shadowScale(surface: Oklch, character: BrandSeed['shadowCharacter']): ShadowScale {
	const diffusion = diffusionMultiplier(character?.spread);
	const darkness = 1 - surface.l;
	const tinted = character === null ? true : character.tintFromSurface;

	// A shadow is the surface with the light taken out of it, which is also what keeps a light and
	// a dark surface's shadows apart in lightness as well as in alpha.
	const l = surface.l * 0.15;
	const c = tinted ? Math.min(surface.c, CHROMA_CEILING) : 0;
	const h = tinted ? surface.h : 0;

	const values = Object.fromEntries(
		STEPS.map((step, i) => {
			const base = BASE[i];

			const blur = base.blur * diffusion * (1 + 0.5 * darkness);
			const alpha = Math.min(1, base.alpha * (1 + 1.5 * darkness));

			const shadow: Shadow = {
				color: { l, c, h, alpha },
				offsetX: px(0),
				offsetY: px(base.offsetY),
				blur: px(blur),
				spread: px(base.spread),
			};

			return [step, shadow];
		}),
	) as ShadowScale['values'];

	return { source: 'derived', values };
}
