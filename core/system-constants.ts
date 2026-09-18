import type { CubicBezier, Dimension, Duration, SystemConstants } from './token-set';

/**
 * Five design system categories that #7 names exhaustively and that no seed informs.
 *
 * Issue #7 requires that no system-constant category varies with the seed, and a function that
 * takes no argument cannot vary with one. Every value here is either a vendored authority
 * (components/ui/button.tsx paints with `disabled:opacity-50` and `focus-visible:ring-3`), or
 * a stated default nobody has measured yet. `source: 'system'` records that distinction.
 *
 * `focusRing` rather than `ring`: SEMANTIC_MAP.ring is already a colour that reaches a stylesheet
 * as `--ring`. A constant sharing that name would flatten to the same variable and overwrite the
 * colour with a width. No adapter writing a flat variable list would report the collision.
 */
export function systemConstants(): SystemConstants {
	return {
		spacing: {
			source: 'system',
			values: {
				none: { value: 0, unit: 'rem' },
				xs: { value: 0.25, unit: 'rem' },
				sm: { value: 0.5, unit: 'rem' },
				md: { value: 1, unit: 'rem' },
				lg: { value: 1.5, unit: 'rem' },
				xl: { value: 2, unit: 'rem' },
				'2xl': { value: 3, unit: 'rem' },
			},
		},
		opacity: {
			source: 'system',
			values: {
				// disabled and ring are vendored: components/ui/button.tsx paints a disabled
				// control with `disabled:opacity-50` and its focus halo with `ring-ring/50`.
				disabled: 0.5,
				ring: 0.5,
				// muted and overlay are stated defaults nobody measured, which is exactly what
				// `source: 'system'` records.
				muted: 0.7,
				overlay: 0.8,
			},
		},
		motion: {
			source: 'system',
			values: {
				duration: {
					instant: { value: 0, unit: 'ms' },
					fast: { value: 150, unit: 'ms' },
					normal: { value: 250, unit: 'ms' },
					slow: { value: 400, unit: 'ms' },
				},
				easing: {
					standard: [0.2, 0, 0, 1],
					enter: [0, 0, 0.2, 1],
					exit: [0.4, 0, 1, 1],
					linear: [0, 0, 1, 1],
				},
			},
		},
		focusRing: {
			source: 'system',
			values: {
				// width is the one components/ui/button.tsx paints, through `focus-visible:ring-3`.
				// offset is 0 because that component lays no ring offset.
				width: { value: 3, unit: 'px' },
				offset: { value: 0, unit: 'px' },
			},
		},
		zIndex: {
			source: 'system',
			values: {
				base: 0,
				dropdown: 1000,
				sticky: 1100,
				overlay: 1200,
				modal: 1300,
				popover: 1400,
				toast: 1500,
				tooltip: 1600,
			},
		},
	};
}
