import type { Ramp, SemanticEntry, TokenSet } from '../token-set';

/**
 * A DTCG document pair and the `TokenSet` it denotes, both typed out by hand.
 *
 * Nothing here may be generated: not by `serialize.ts`, not by a loop over a step list, not by a
 * helper that folds dark out of light. This file is the one measurement in the suite that did not
 * come out of the code it measures.
 *
 * The defect it guards against has already cost this repo twice. A `deserialize(serialize(x)) === x`
 * assertion built from the serializer's own mapping table on both sides proves that the table
 * agrees with itself, and it keeps proving that while the table is wrong. #72 records what that
 * cost last time. So a reader who had not opened a serializer transcribed the documents below from
 * the vendored schema (`core/dtcg/format.2025.10.json`) and the shape block in the plan for #11,
 * then wrote the `TokenSet` beside them from `TokenSetSchema` the same way. Fold the tedium into a
 * loop and the suite still runs green with nothing left measuring anything.
 *
 * Minimal, which is still large. `RampSchema` wants steps 1 through 12 each exactly once, so one
 * ramp is twelve real steps. One ramp, five semantic aliases into it, one shadow, and one token in
 * each remaining family covers every `$type` in the plan's shape block: color, dimension,
 * fontWeight, number, shadow, duration, cubicBezier.
 *
 * The hex on every colour is the sRGB its components land on, computed once against culori as an
 * outside reference and pasted in. Reading it back off Cambium's own converter would hand the
 * round-trip test the answer it is supposed to check. Every component triple here sits inside the
 * sRGB gamut, so the hex is the colour rather than a clipped approximation of one. On a shadow the
 * hex is an opaque shadow of a translucent colour, because DTCG's `hex` is six digits by design and
 * cannot carry the sibling `alpha`.
 *
 * The one place a literal is written once and referenced twice is the `TokenSet` mirror:
 * `checkMirroredLayers` requires the top-level `primitives`/`semantic`/`shadow` to be deep-equal to
 * `schemes.light.*`, so the light halves below are one constant used in both slots. Stating
 * "identical" by identity is exactly what that schema asks for, and `core/token-set.fixture.ts`
 * already does it with `SHADOW_FIXTURE`. Dark shares nothing with light, and the documents share
 * nothing with the `TokenSet` or with each other.
 *
 * Not a `.test.ts` file, because the Vitest include glob would run it and it holds no tests.
 */

const SPEC_LIGHT_RAMP: Ramp = [
	{
		step: 1,
		l: 0.98,
		c: 0.005,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lifts the brand key colour to the page surface at step 1',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 2,
		l: 0.95,
		c: 0.02,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to step 2 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 3,
		l: 0.9,
		c: 0.03,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to step 3 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 4,
		l: 0.85,
		c: 0.05,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to step 4 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 5,
		l: 0.78,
		c: 0.07,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to step 5 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 6,
		l: 0.7,
		c: 0.09,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to step 6 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 7,
		l: 0.62,
		c: 0.12,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to step 7 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 8,
		l: 0.54,
		c: 0.14,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to step 8 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 9,
		l: 0.48,
		c: 0.16,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'observed',
				rationale: 'the brand key colour the reference image held, placed at step 9',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 10,
		l: 0.42,
		c: 0.15,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'darkens the brand key colour to step 10 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 11,
		l: 0.32,
		c: 0.12,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'darkens the brand key colour to step 11 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 12,
		l: 0.2,
		c: 0.06,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'darkens the brand key colour to the reading text at step 12',
				seedField: 'keyColors',
			},
		},
	},
];

const SPEC_DARK_RAMP: Ramp = [
	{
		step: 1,
		l: 0.16,
		c: 0.03,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'drops the brand key colour to the dark page surface at step 1',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 2,
		l: 0.2,
		c: 0.04,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 2 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 3,
		l: 0.25,
		c: 0.05,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 3 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 4,
		l: 0.3,
		c: 0.07,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 4 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 5,
		l: 0.36,
		c: 0.09,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 5 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 6,
		l: 0.42,
		c: 0.11,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 6 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 7,
		l: 0.5,
		c: 0.13,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 7 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 8,
		l: 0.58,
		c: 0.15,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 8 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 9,
		l: 0.66,
		c: 0.14,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'raises the brand key colour until it carries the dark surface at step 9',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 10,
		l: 0.74,
		c: 0.11,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 10 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 11,
		l: 0.86,
		c: 0.06,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to dark step 11 on the measured ramp',
				seedField: 'keyColors',
			},
		},
	},
	{
		step: 12,
		l: 0.96,
		c: 0.01,
		h: 259.8,
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'lightens the brand key colour to the reading text at dark step 12',
				seedField: 'keyColors',
			},
		},
	},
];

/**
 * Five roles, chosen because they address five different steps: the schema resolves each alias
 * against the ramp, so an alias set that all pointed at one step would leave eleven steps unread.
 */
const SPEC_LIGHT_SEMANTIC: Record<string, SemanticEntry> = {
	background: {
		alias: 'brand.1',
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'the page surface takes the lightest step of the brand ramp',
				seedField: 'keyColors',
			},
		},
	},
	border: {
		alias: 'brand.6',
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'a border reads at step 6, where the ramp separates without stating itself',
				seedField: 'keyColors',
			},
		},
	},
	primary: {
		alias: 'brand.9',
		$extensions: {
			'com.cambium': {
				provenance: 'observed',
				rationale: 'the primary role takes the key colour the reference image held',
				seedField: 'keyColors',
			},
		},
	},
	ring: {
		alias: 'brand.11',
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'the focus ring takes step 11 so it clears the surface it draws over',
				seedField: 'keyColors',
			},
		},
	},
	foreground: {
		alias: 'brand.12',
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'reading text takes the darkest step of the brand ramp',
				seedField: 'keyColors',
			},
		},
	},
};

/** Same roles and same targets as light; only the ramp underneath them moved. */
const SPEC_DARK_SEMANTIC: Record<string, SemanticEntry> = {
	background: {
		alias: 'brand.1',
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'the page surface takes the darkest step of the brand ramp',
				seedField: 'keyColors',
			},
		},
	},
	border: {
		alias: 'brand.6',
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'a border reads at step 6, where the ramp separates without stating itself',
				seedField: 'keyColors',
			},
		},
	},
	primary: {
		alias: 'brand.9',
		$extensions: {
			'com.cambium': {
				provenance: 'observed',
				rationale: 'the primary role takes the key colour the reference image held',
				seedField: 'keyColors',
			},
		},
	},
	ring: {
		alias: 'brand.11',
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'the focus ring takes step 11 so it clears the surface it draws over',
				seedField: 'keyColors',
			},
		},
	},
	foreground: {
		alias: 'brand.12',
		$extensions: {
			'com.cambium': {
				provenance: 'derived',
				rationale: 'reading text takes the lightest step of the brand ramp',
				seedField: 'keyColors',
			},
		},
	},
};

const SPEC_LIGHT_SHADOW: TokenSet['shadow'] = {
	source: 'derived',
	values: {
		md: {
			color: { l: 0.15, c: 0.02, h: 259.8, alpha: 0.1 },
			offsetX: { value: 0, unit: 'px' },
			offsetY: { value: 4, unit: 'px' },
			blur: { value: 6, unit: 'px' },
			spread: { value: -1, unit: 'px' },
			$extensions: {
				'com.cambium': {
					provenance: 'derived',
					rationale: 'tints the shadow from the measured spread and the light surface',
					seedField: 'shadowCharacter',
				},
			},
		},
	},
};

const SPEC_DARK_SHADOW: TokenSet['shadow'] = {
	source: 'derived',
	values: {
		md: {
			color: { l: 0.1, c: 0.015, h: 259.8, alpha: 0.4 },
			offsetX: { value: 0, unit: 'px' },
			offsetY: { value: 4, unit: 'px' },
			blur: { value: 6, unit: 'px' },
			spread: { value: -1, unit: 'px' },
			$extensions: {
				'com.cambium': {
					provenance: 'derived',
					rationale: 'tints the shadow from the measured spread and the dark surface',
					seedField: 'shadowCharacter',
				},
			},
		},
	},
};

/**
 * The token set the two documents below denote.
 *
 * The light colour halves appear twice by reference rather than twice by hand, which is what
 * `checkMirroredLayers` is asking for; every other value in this file is written out.
 */
export const SPEC_TOKEN_SET: TokenSet = {
	primitives: { brand: SPEC_LIGHT_RAMP },
	semantic: SPEC_LIGHT_SEMANTIC,
	shadow: SPEC_LIGHT_SHADOW,
	schemes: {
		light: {
			primitives: { brand: SPEC_LIGHT_RAMP },
			semantic: SPEC_LIGHT_SEMANTIC,
			shadow: SPEC_LIGHT_SHADOW,
		},
		dark: {
			primitives: { brand: SPEC_DARK_RAMP },
			semantic: SPEC_DARK_SEMANTIC,
			shadow: SPEC_DARK_SHADOW,
		},
	},
	radius: {
		source: 'derived',
		values: {
			md: {
				value: 0.625,
				unit: 'rem',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'sets the corner radius from the measured base',
						seedField: 'radiusCharacter',
					},
				},
			},
		},
	},
	typography: {
		source: 'derived',
		values: {
			size: {
				base: {
					value: 1,
					unit: 'rem',
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'sets the base size from the measured scale ratio',
							seedField: 'typeScaleRatio',
						},
					},
				},
			},
			weight: {
				regular: {
					value: 400,
					$extensions: {
						'com.cambium': {
							provenance: 'invented',
							rationale: 'the schema requires a weight set that no seed field measures',
							seedField: null,
						},
					},
				},
			},
			lineHeight: {
				normal: {
					value: 1.5,
					$extensions: {
						'com.cambium': {
							provenance: 'invented',
							rationale: 'the schema requires a line height set that no seed field measures',
							seedField: null,
						},
					},
				},
			},
		},
	},
	/**
	 * Negative and in `em`. The unit is what keeps tracking out of DTCG's `dimension`, whose unit enum
	 * holds `px` and `rem` only, so the plan types it as `number` and rides the unit in
	 * `com.cambium.dtcg`.
	 */
	tracking: {
		source: 'derived',
		values: {
			tight: {
				value: -0.01,
				unit: 'em',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'shifts the tracking scale by the stated feel',
						seedField: 'trackingFeel',
					},
				},
			},
		},
	},
	spacing: {
		source: 'system',
		values: {
			md: {
				value: 1,
				unit: 'rem',
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a spacing scale that no seed field measures',
						seedField: null,
					},
				},
			},
		},
	},
	opacity: {
		source: 'system',
		values: {
			disabled: {
				value: 0.5,
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a disabled opacity that no seed field measures',
						seedField: null,
					},
				},
			},
		},
	},
	motion: {
		source: 'system',
		values: {
			duration: {
				fast: {
					value: 150,
					unit: 'ms',
					$extensions: {
						'com.cambium': {
							provenance: 'invented',
							rationale: 'the schema requires a duration set that no seed field measures',
							seedField: null,
						},
					},
				},
			},
			easing: {
				standard: {
					value: [0.2, 0, 0, 1],
					$extensions: {
						'com.cambium': {
							provenance: 'invented',
							rationale: 'the schema requires an easing set that no seed field measures',
							seedField: null,
						},
					},
				},
			},
		},
	},
	focusRing: {
		source: 'system',
		values: {
			width: {
				value: 3,
				unit: 'px',
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a focus ring width that no seed field measures',
						seedField: null,
					},
				},
			},
			offset: {
				value: 0,
				unit: 'px',
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a focus ring offset that no seed field measures',
						seedField: null,
					},
				},
			},
		},
	},
	zIndex: {
		source: 'system',
		values: {
			modal: {
				value: 1300,
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a modal layer that no seed field measures',
						seedField: null,
					},
				},
			},
		},
	},
};

/**
 * Deliberately untyped: annotating it with the serializer's own `DtcgDocument` would let a wrong
 * type make a wrong document compile. `validateDtcg` is the consumer here, and it takes `unknown`.
 */
export const SPEC_LIGHT_DOCUMENT = {
	color: {
		primitive: {
			brand: {
				'1': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.98, 0.005, 259.8], hex: '#f6f9fc' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lifts the brand key colour to the page surface at step 1',
							seedField: 'keyColors',
						},
					},
				},
				'2': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.95, 0.02, 259.8], hex: '#e7effc' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to step 2 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'3': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.9, 0.03, 259.8], hex: '#d3dff2' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to step 3 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'4': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.85, 0.05, 259.8], hex: '#bbcfef' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to step 4 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'5': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.78, 0.07, 259.8], hex: '#9db9e5' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to step 5 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'6': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.7, 0.09, 259.8], hex: '#7d9fd7' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to step 6 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'7': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.62, 0.12, 259.8], hex: '#5a86ce' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to step 7 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'8': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.54, 0.14, 259.8], hex: '#3a6cbf' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to step 8 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'9': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.48, 0.16, 259.8], hex: '#1e58b6' },
					$extensions: {
						'com.cambium': {
							provenance: 'observed',
							rationale: 'the brand key colour the reference image held, placed at step 9',
							seedField: 'keyColors',
						},
					},
				},
				'10': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.42, 0.15, 259.8], hex: '#11479d' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'darkens the brand key colour to step 10 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'11': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.32, 0.12, 259.8], hex: '#052e6e' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'darkens the brand key colour to step 11 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'12': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.2, 0.06, 259.8], hex: '#051531' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'darkens the brand key colour to the reading text at step 12',
							seedField: 'keyColors',
						},
					},
				},
			},
		},
		semantic: {
			background: {
				$type: 'color',
				$value: '{color.primitive.brand.1}',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'the page surface takes the lightest step of the brand ramp',
						seedField: 'keyColors',
					},
				},
			},
			border: {
				$type: 'color',
				$value: '{color.primitive.brand.6}',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'a border reads at step 6, where the ramp separates without stating itself',
						seedField: 'keyColors',
					},
				},
			},
			primary: {
				$type: 'color',
				$value: '{color.primitive.brand.9}',
				$extensions: {
					'com.cambium': {
						provenance: 'observed',
						rationale: 'the primary role takes the key colour the reference image held',
						seedField: 'keyColors',
					},
				},
			},
			ring: {
				$type: 'color',
				$value: '{color.primitive.brand.11}',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'the focus ring takes step 11 so it clears the surface it draws over',
						seedField: 'keyColors',
					},
				},
			},
			foreground: {
				$type: 'color',
				$value: '{color.primitive.brand.12}',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'reading text takes the darkest step of the brand ramp',
						seedField: 'keyColors',
					},
				},
			},
		},
	},
	radius: {
		md: {
			$type: 'dimension',
			$value: { value: 0.625, unit: 'rem' },
			$extensions: {
				'com.cambium': {
					provenance: 'derived',
					rationale: 'sets the corner radius from the measured base',
					seedField: 'radiusCharacter',
				},
			},
		},
	},
	spacing: {
		md: {
			$type: 'dimension',
			$value: { value: 1, unit: 'rem' },
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a spacing scale that no seed field measures',
					seedField: null,
				},
			},
		},
	},
	typography: {
		size: {
			base: {
				$type: 'dimension',
				$value: { value: 1, unit: 'rem' },
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'sets the base size from the measured scale ratio',
						seedField: 'typeScaleRatio',
					},
				},
			},
		},
		weight: {
			regular: {
				$type: 'fontWeight',
				$value: 400,
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a weight set that no seed field measures',
						seedField: null,
					},
				},
			},
		},
		lineHeight: {
			normal: {
				$type: 'number',
				$value: 1.5,
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a line height set that no seed field measures',
						seedField: null,
					},
				},
			},
		},
	},
	tracking: {
		tight: {
			$type: 'number',
			$value: -0.01,
			$extensions: {
				'com.cambium': {
					provenance: 'derived',
					rationale: 'shifts the tracking scale by the stated feel',
					seedField: 'trackingFeel',
				},
				'com.cambium.dtcg': { unit: 'em' },
			},
		},
	},
	shadow: {
		md: {
			$type: 'shadow',
			$value: {
				color: {
					colorSpace: 'oklch',
					components: [0.15, 0.02, 259.8],
					alpha: 0.1,
					hex: '#070b14',
				},
				offsetX: { value: 0, unit: 'px' },
				offsetY: { value: 4, unit: 'px' },
				blur: { value: 6, unit: 'px' },
				spread: { value: -1, unit: 'px' },
			},
			$extensions: {
				'com.cambium': {
					provenance: 'derived',
					rationale: 'tints the shadow from the measured spread and the light surface',
					seedField: 'shadowCharacter',
				},
			},
		},
	},
	motion: {
		duration: {
			fast: {
				$type: 'duration',
				$value: { value: 150, unit: 'ms' },
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a duration set that no seed field measures',
						seedField: null,
					},
				},
			},
		},
		easing: {
			standard: {
				$type: 'cubicBezier',
				$value: [0.2, 0, 0, 1],
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires an easing set that no seed field measures',
						seedField: null,
					},
				},
			},
		},
	},
	opacity: {
		disabled: {
			$type: 'number',
			$value: 0.5,
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a disabled opacity that no seed field measures',
					seedField: null,
				},
			},
		},
	},
	zIndex: {
		modal: {
			$type: 'number',
			$value: 1300,
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a modal layer that no seed field measures',
					seedField: null,
				},
			},
		},
	},
	focusRing: {
		width: {
			$type: 'dimension',
			$value: { value: 3, unit: 'px' },
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a focus ring width that no seed field measures',
					seedField: null,
				},
			},
		},
		offset: {
			$type: 'dimension',
			$value: { value: 0, unit: 'px' },
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a focus ring offset that no seed field measures',
					seedField: null,
				},
			},
		},
	},
};

/**
 * Written out rather than folded out of light, the eight identical non-colour families included.
 * Shadow is the ninth and the one that differs, because a shadow tuned for a white page is
 * invisible on a near-black one.
 *
 * Those eight families live once on the `TokenSet` and appear in both documents, so the
 * deserializer has to read them from light and fail on a dark disagreement. A dark document built
 * from the light one can never exercise that check.
 */
export const SPEC_DARK_DOCUMENT = {
	color: {
		primitive: {
			brand: {
				'1': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.16, 0.03, 259.8], hex: '#060d1a' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'drops the brand key colour to the dark page surface at step 1',
							seedField: 'keyColors',
						},
					},
				},
				'2': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.2, 0.04, 259.8], hex: '#0b1628' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 2 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'3': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.25, 0.05, 259.8], hex: '#132139' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 3 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'4': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.3, 0.07, 259.8], hex: '#182d50' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 4 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'5': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.36, 0.09, 259.8], hex: '#1f3c6c' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 5 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'6': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.42, 0.11, 259.8], hex: '#264b88' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 6 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'7': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.5, 0.13, 259.8], hex: '#3361ac' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 7 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'8': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.58, 0.15, 259.8], hex: '#4178d2' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 8 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'9': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.66, 0.14, 259.8], hex: '#5d91e7' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'raises the brand key colour until it carries the dark surface at step 9',
							seedField: 'keyColors',
						},
					},
				},
				'10': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.74, 0.11, 259.8], hex: '#81acf0' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 10 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'11': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.86, 0.06, 259.8], hex: '#bad2f9' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to dark step 11 on the measured ramp',
							seedField: 'keyColors',
						},
					},
				},
				'12': {
					$type: 'color',
					$value: { colorSpace: 'oklch', components: [0.96, 0.01, 259.8], hex: '#eef2f9' },
					$extensions: {
						'com.cambium': {
							provenance: 'derived',
							rationale: 'lightens the brand key colour to the reading text at dark step 12',
							seedField: 'keyColors',
						},
					},
				},
			},
		},
		semantic: {
			background: {
				$type: 'color',
				$value: '{color.primitive.brand.1}',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'the page surface takes the darkest step of the brand ramp',
						seedField: 'keyColors',
					},
				},
			},
			border: {
				$type: 'color',
				$value: '{color.primitive.brand.6}',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'a border reads at step 6, where the ramp separates without stating itself',
						seedField: 'keyColors',
					},
				},
			},
			primary: {
				$type: 'color',
				$value: '{color.primitive.brand.9}',
				$extensions: {
					'com.cambium': {
						provenance: 'observed',
						rationale: 'the primary role takes the key colour the reference image held',
						seedField: 'keyColors',
					},
				},
			},
			ring: {
				$type: 'color',
				$value: '{color.primitive.brand.11}',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'the focus ring takes step 11 so it clears the surface it draws over',
						seedField: 'keyColors',
					},
				},
			},
			foreground: {
				$type: 'color',
				$value: '{color.primitive.brand.12}',
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'reading text takes the lightest step of the brand ramp',
						seedField: 'keyColors',
					},
				},
			},
		},
	},
	radius: {
		md: {
			$type: 'dimension',
			$value: { value: 0.625, unit: 'rem' },
			$extensions: {
				'com.cambium': {
					provenance: 'derived',
					rationale: 'sets the corner radius from the measured base',
					seedField: 'radiusCharacter',
				},
			},
		},
	},
	spacing: {
		md: {
			$type: 'dimension',
			$value: { value: 1, unit: 'rem' },
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a spacing scale that no seed field measures',
					seedField: null,
				},
			},
		},
	},
	typography: {
		size: {
			base: {
				$type: 'dimension',
				$value: { value: 1, unit: 'rem' },
				$extensions: {
					'com.cambium': {
						provenance: 'derived',
						rationale: 'sets the base size from the measured scale ratio',
						seedField: 'typeScaleRatio',
					},
				},
			},
		},
		weight: {
			regular: {
				$type: 'fontWeight',
				$value: 400,
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a weight set that no seed field measures',
						seedField: null,
					},
				},
			},
		},
		lineHeight: {
			normal: {
				$type: 'number',
				$value: 1.5,
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a line height set that no seed field measures',
						seedField: null,
					},
				},
			},
		},
	},
	tracking: {
		tight: {
			$type: 'number',
			$value: -0.01,
			$extensions: {
				'com.cambium': {
					provenance: 'derived',
					rationale: 'shifts the tracking scale by the stated feel',
					seedField: 'trackingFeel',
				},
				'com.cambium.dtcg': { unit: 'em' },
			},
		},
	},
	shadow: {
		md: {
			$type: 'shadow',
			$value: {
				color: {
					colorSpace: 'oklch',
					components: [0.1, 0.015, 259.8],
					alpha: 0.4,
					hex: '#020307',
				},
				offsetX: { value: 0, unit: 'px' },
				offsetY: { value: 4, unit: 'px' },
				blur: { value: 6, unit: 'px' },
				spread: { value: -1, unit: 'px' },
			},
			$extensions: {
				'com.cambium': {
					provenance: 'derived',
					rationale: 'tints the shadow from the measured spread and the dark surface',
					seedField: 'shadowCharacter',
				},
			},
		},
	},
	motion: {
		duration: {
			fast: {
				$type: 'duration',
				$value: { value: 150, unit: 'ms' },
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires a duration set that no seed field measures',
						seedField: null,
					},
				},
			},
		},
		easing: {
			standard: {
				$type: 'cubicBezier',
				$value: [0.2, 0, 0, 1],
				$extensions: {
					'com.cambium': {
						provenance: 'invented',
						rationale: 'the schema requires an easing set that no seed field measures',
						seedField: null,
					},
				},
			},
		},
	},
	opacity: {
		disabled: {
			$type: 'number',
			$value: 0.5,
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a disabled opacity that no seed field measures',
					seedField: null,
				},
			},
		},
	},
	zIndex: {
		modal: {
			$type: 'number',
			$value: 1300,
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a modal layer that no seed field measures',
					seedField: null,
				},
			},
		},
	},
	focusRing: {
		width: {
			$type: 'dimension',
			$value: { value: 3, unit: 'px' },
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a focus ring width that no seed field measures',
					seedField: null,
				},
			},
		},
		offset: {
			$type: 'dimension',
			$value: { value: 0, unit: 'px' },
			$extensions: {
				'com.cambium': {
					provenance: 'invented',
					rationale: 'the schema requires a focus ring offset that no seed field measures',
					seedField: null,
				},
			},
		},
	},
};
