import type { BrandSeed } from './brand-seed';
import type { Dimension, TrackingScale } from './token-set';

/** Tailwind's own tracking names and values, which a `normal` feel reproduces exactly. */
const STEPS = ['tighter', 'tight', 'normal', 'wide', 'wider'] as const;
const BASE_EM = [-0.05, -0.025, 0, 0.025, 0.05];

/** Half a step, so a shifted scale still reads as the same five names rather than as new ones. */
const FEEL_SHIFT = 0.0125;

/**
 * The unit is `em`, because letter-spacing has to scale with the size it applies to and `rem` does
 * not. That costs something worth naming: DTCG's `dimension` type accepts `px` and `rem` only, so
 * the DTCG adapter has a conversion to make for tracking rather than a value to copy. Issue #7
 * records it there so the adapter ticket finds it before the format validator does.
 *
 * The feel moves the whole scale and leaves the step spacing alone. Respacing instead would let
 * `tighter` under a wide feel land on the same value as `normal` under a tight one, and the five
 * names would stop meaning the same distance apart from one theme to the next.
 */
export function trackingScale(feel: BrandSeed['trackingFeel']): TrackingScale {
	const shift = feel === 'tight' ? -FEEL_SHIFT : feel === 'wide' ? FEEL_SHIFT : 0;

	const values = Object.fromEntries(
		STEPS.map((step, i): [string, Dimension] => [step, { value: BASE_EM[i]! + shift, unit: 'em' }]),
	) as TrackingScale['values'];

	return { source: 'derived', values };
}
