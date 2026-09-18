import type { BrandSeed } from './brand-seed';
import { CAMBIUM_NAMESPACE, invented } from './provenance';
import { radiusScale } from './radius-scale';
import type { SchemeName } from './scale-engine';
import { resolveScheme } from './resolve-scheme';
import { type ShadowSurface, shadowScale } from './shadow-scale';
import { systemConstants, type UntaggedSystemConstants } from './system-constants';
import type {
	ColorScheme,
	RadiusScale,
	ShadowScale,
	SystemConstants,
	TokenExtensions,
	TrackingScale,
	Typography,
} from './token-set';
import { trackingScale } from './tracking-scale';
import { typeScale } from './type-scale';

/** Shadow is keyed by scheme and nothing else is; `token-set.ts` records why. */
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
		...tagSystemConstants(systemConstants()),
	};
}

/**
 * One rationale per category rather than one per token. `source: 'system'` on the category is
 * already the proof that no seed field reached anything inside it, so tagging leaf by leaf would
 * restate the same fact forty times with forty chances to word it differently. Radius, typography,
 * tracking and shadow tag their own leaves in their own modules, each against a seed field that
 * varies per token; nothing here decides for them.
 */
const SPACING_RATIONALE =
	'An evenly stepped scale invented for the prototype; no seed field speaks to spacing';
const OPACITY_RATIONALE =
	"Disabled and ring are vendored from components/ui/button.tsx's opacity classes; muted and overlay are stated defaults nobody has measured";
const MOTION_RATIONALE =
	'Durations and easings are invented interaction defaults, not read from any seed field';
const FOCUS_RING_RATIONALE =
	"Width is vendored from components/ui/button.tsx's focus ring; offset is 0 because that component sets no ring offset";
const ZINDEX_RATIONALE =
	'An invented layering default assigned by role, not read from any seed field';

/** Attaches `$extensions` to a `{ value, unit }` leaf, invented because the category is `system`. */
function tagValueUnit<T extends { value: number; unit: string }>(
	leaf: T,
	rationale: string,
): T & { $extensions: TokenExtensions } {
	return { ...leaf, $extensions: invented(rationale) };
}

/** Attaches `$extensions` to a bare number or tuple, wrapping it the way `scalarToken` does in the schema. */
function tagScalar<T>(value: T, rationale: string): { value: T; $extensions: TokenExtensions } {
	return { value, $extensions: invented(rationale) };
}

function tagRecord<T, U>(record: Record<string, T>, tag: (leaf: T) => U): Record<string, U> {
	return Object.fromEntries(Object.entries(record).map(([key, leaf]) => [key, tag(leaf)]));
}

/**
 * The one pass that turns `systemConstants()`'s plain statement of the five categories into the
 * tagged shape `TokenSetSchema` requires. Every leaf becomes `invented` with a null `seedField`:
 * that is what `source: 'system'` already means, so this is the single place that fact turns into
 * forty payloads rather than forty hand-written literals inside `system-constants.ts`.
 */
function tagSystemConstants(raw: UntaggedSystemConstants): SystemConstants {
	return {
		spacing: {
			source: 'system',
			values: tagRecord(raw.spacing.values, (leaf) => tagValueUnit(leaf, SPACING_RATIONALE)),
		},
		opacity: {
			source: 'system',
			values: tagRecord(raw.opacity.values, (leaf) => tagScalar(leaf, OPACITY_RATIONALE)),
		},
		motion: {
			source: 'system',
			values: {
				duration: tagRecord(raw.motion.values.duration, (leaf) =>
					tagValueUnit(leaf, MOTION_RATIONALE),
				),
				easing: tagRecord(raw.motion.values.easing, (leaf) => tagScalar(leaf, MOTION_RATIONALE)),
			},
		},
		focusRing: {
			source: 'system',
			values: {
				width: tagValueUnit(raw.focusRing.values.width, FOCUS_RING_RATIONALE),
				offset: tagValueUnit(raw.focusRing.values.offset, FOCUS_RING_RATIONALE),
			},
		},
		zIndex: {
			source: 'system',
			values: tagRecord(raw.zIndex.values, (leaf) => tagScalar(leaf, ZINDEX_RATIONALE)),
		},
	};
}

/**
 * Throws instead of falling back to black. Only a hand-built scheme reaches the throw, because
 * `SEMANTIC_MAP` declares `background` and `TokenSetSchema` rejects a dangling alias. Kept anyway:
 * a shadow tinted from `undefined` reaches an export looking like a colour somebody chose.
 */
function surfaceOf(scheme: ColorScheme, name: SchemeName): ShadowSurface {
	const color = resolveScheme(scheme).background;
	const entry = scheme.semantic.background;

	if (!color || !entry) {
		throw new Error(
			`the ${name} scheme declares no background token, so a shadow has no surface to take its tint from`,
		);
	}

	// The shadow needs what reached the surface, not just the colour it landed on. `background`
	// already carries that: a semantic token inherits the provenance of the ramp step it resolves
	// to, so reading its payload here is reading the neutral ramp's answer one hop back.
	return { color, provenance: entry.$extensions[CAMBIUM_NAMESPACE] };
}
