import type { BrandSeed } from './brand-seed';
import type { Oklch } from './oklch';
import { radiusScale } from './radius-scale';
import type { SchemeName } from './scale-engine';
import { resolveScheme } from './semantic-layer';
import { shadowScale } from './shadow-scale';
import { systemConstants } from './system-constants';
import type {
	ColorScheme,
	RadiusScale,
	ShadowScale,
	SystemConstants,
	TrackingScale,
	Typography,
} from './token-set';
import { trackingScale } from './tracking-scale';
import { typeScale } from './type-scale';

/**
 * Shadow is keyed by scheme and nothing else is, because a shadow is the only non-colour value that
 * depends on a colour. The other eight categories hold still across light and dark.
 */
export type NonColorTokens = SystemConstants & {
	radius: RadiusScale;
	typography: Typography;
	tracking: TrackingScale;
	shadow: Record<SchemeName, ShadowScale>;
};

/**
 * The four seed-derived categories and the five constants, assembled.
 *
 * This module holds the whole of #7's contact with colour, and it is one read: `resolveScheme`, for
 * the `background` token, once per scheme. `SEMANTIC_MAP` aliases `background` to `neutral.1`, the
 * token that means "the page", which is the surface a shadow actually falls on. Nothing is
 * authored, no alias moves, and no colour is repaired. Keeping that read here rather than inside
 * `shadow-scale.ts` is what lets that module stay ignorant of ramps, aliases and schemes, and what
 * lets it be tested against two synthetic surfaces.
 *
 * `neutral.1` resolves to a different colour in each scheme, so the two shadows would differ even
 * if the derivation treated them identically. It does not: `shadow-scale.ts` separately raises
 * alpha and blur as the surface darkens, because a shadow tuned for a white page is invisible on a
 * near-black one. Both reasons are asserted, because either alone would let the other regress.
 */
export function deriveNonColor(
	seed: BrandSeed,
	schemes: Record<SchemeName, ColorScheme>,
): NonColorTokens {
	return {
		radius: radiusScale(seed.radiusCharacter),
		typography: typeScale(seed.typeScaleRatio),
		tracking: trackingScale(seed.trackingFeel),
		shadow: {
			light: shadowScale(surfaceOf(schemes.light, 'light'), seed.shadowCharacter),
			dark: shadowScale(surfaceOf(schemes.dark, 'dark'), seed.shadowCharacter),
		},
		...systemConstants(),
	};
}

/**
 * Throws instead of falling back to black. Only a hand-built scheme reaches the throw, because
 * `SEMANTIC_MAP` declares `background` and `TokenSetSchema` rejects a dangling alias. Kept anyway:
 * a shadow tinted from `undefined` reaches an export looking like a colour somebody chose.
 */
function surfaceOf(scheme: ColorScheme, name: SchemeName): Oklch {
	const surface = resolveScheme(scheme).background;

	if (!surface) {
		throw new Error(
			`the ${name} scheme declares no background token, so a shadow has no surface to take its tint from`,
		);
	}

	return surface;
}
