/**
 * How far Cambium strays from the seed, in Cambium's own terms.
 *
 * These sit apart from any engine deliberately. A second scale engine translates them into its
 * native settings rather than replacing them, which is what keeps a preset meaning the same thing
 * across engines. `core/shadow-scale.ts` also reads them under an import guard that admits no
 * module able to reach a colour, and a module holding ramps and schemes cannot satisfy that.
 */

/**
 * Cambium's own knobs, stated in Cambium's terms rather than any engine's.
 *
 * Two modules read a field off these: `core/oklch-scale-engine.ts` takes the four colour knobs, and
 * `shadowScale` takes `surfaceTinting`. `radiusScale`, `trackingScale` and `typeScale` take a seed
 * field and nothing else. Most of what they hold could not be a preset at all—`MAX_BASE_PX`,
 * `RATIO_FLOOR`, `RATIO_CEILING`, the ratio a seed that measured none falls back to—since nobody
 * ships an interpretation that moves the widest radius an interface can have. Two could:
 * `FEEL_SHIFT` in `core/tracking-scale.ts`, and the `sharp` and `pill` rows of `MULTIPLIERS` in
 * `core/radius-scale.ts`, which between them set how hard a stated character gets expressed. Those
 * are unparameterized because no preset has asked for them yet, not because they are already wired,
 * so a preset that wants them is a signature change rather than a new value here.
 *
 * #4 declared these inside the scale engine because it was the first consumer; #10 moved them out
 * when the second one turned out to be a module forbidden from importing anything that can reach a
 * colour.
 */
export type InterpretationParams = {
	/**
	 * How far the neutral ramp's chroma pulls toward the brand hue, where the seed measured no
	 * neutral temperature. 0 leaves it dead neutral only in that case: a stated `neutralTemperature`
	 * sets the tint itself and this does not override it, so step 9 comes back at the stated chroma
	 * and hue with its provenance tracing to that field.
	 */
	neutralTinting: number;
	/** Multiplier on the chroma curve. Above 1 widens the spread, below 1 mutes it. */
	chromaSpread: number;
	/** How far status hues rotate toward the brand hue. 0 keeps danger unmistakably red. */
	harmonization: number;
	/** Degrees to rotate the brand hue by when the seed offers no second key color. */
	accentRotation: number;
	/**
	 * The chroma a shadow carries where the gamut has room for it, in OKLCH chroma rather than as a
	 * fraction like the fields above. Reading it off the page surface is the obvious implementation
	 * and it produces black: `background` aliases `neutral.1`, whose chroma scales with the brand's
	 * own rather than sitting at a figure. Across brand chromas 0.05 to 0.25 it runs 0.00006 to
	 * 0.0003 in light and 0.0002 to 0.0012 in dark, an order of magnitude under the depth below at
	 * every one of them. So the surface supplies the hue and this supplies the depth.
	 *
	 * A ceiling the gamut imposes, not a floor this lifts to. `shadowScale` fits the value to sRGB at
	 * the shadow's own lightness, 15% of the page's, so a chroma the gamut already holds is declared
	 * exactly as asked: 0.004 stays 0.004 at every hue on either page. The dark page is where the
	 * fit starts cutting. Its shadow sits at lightness 0.0282, where the sRGB chroma ceiling runs
	 * 0.0048 to 0.0196 around the hue circle, so Balanced's 0.02 is over it at every hue and comes
	 * back 0.0114 at hue 259.8. The light page's shadow sits at 0.1491, where the ceiling starts at
	 * 0.0253 and 0.02 survives whole. No value here buys a dark page the tint a light one carries.
	 * #7 records that trade.
	 */
	surfaceTinting: number;
};

/**
 * The one named value #10 asks for. Faithful and Expressive are #37's work and deliberately absent:
 * shipping two more constants now would mean guessing what they mean before anyone can see a ramp.
 *
 * `harmonization` sits at 0 because a danger color that has drifted toward the brand hue stops
 * reading as danger, and that is the whole job of a status color. Issue #1 reserves strong tinting
 * for the Expressive preset.
 *
 * `accentRotation` is a third of the circle. A complement at 180 degrees reads as a second brand
 * rather than as an accent, and anything under about 90 is close enough to the brand hue to look
 * like a mistake.
 */
export const BALANCED: InterpretationParams = {
	neutralTinting: 0.25,
	chromaSpread: 1,
	harmonization: 0,
	accentRotation: 120,
	surfaceTinting: 0.02,
};
