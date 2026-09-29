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
 * The one named value #10 asks for. Faithful and Expressive sit beside it below, #37's work, now
 * that a ramp exists to judge each one against.
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

/**
 * The preset that trusts the seed over any opinion of Cambium's. `chromaSpread` and `harmonization`
 * hold Balanced's values rather than moving toward some more neutral setting, because damping the
 * chroma curve or pulling status hues toward the brand would already be a stance, and Faithful's
 * whole job is not taking one. `accentRotation` stays at Balanced's third-of-circle too: rotation
 * only ever fires where the seed offers no second key color, so a narrower angle there would be
 * inventing a preference this preset exists to avoid having.
 *
 * `neutralTinting` and `surfaceTinting` still sit above zero, at 0.05 and 0.01, rather than at
 * nothing. A neutral ramp with no trace of the brand hue and a shadow with no chroma at all read as
 * a broken renderer rather than as a deliberate choice, and "faithful" means reproducing what a
 * designed interface actually looks like, not stripping every trace of the color that made it.
 */
export const FAITHFUL: InterpretationParams = {
	neutralTinting: 0.05,
	chromaSpread: 1,
	harmonization: 0,
	accentRotation: 120,
	surfaceTinting: 0.01,
};

/**
 * The preset that leans into interpretation instead of staying out of its way. `neutralTinting` at
 * 0.6 pulls the neutral ramp noticeably toward the brand hue, since a preset named "expressive"
 * that still ships a dead-grey scale would not have earned the name. `chromaSpread` above 1 widens
 * the chroma curve at every step but the anchor itself: step 9 is `fitToSrgbGamut(anchor)` outright
 * in `buildRamp` (`core/oklch-scale-engine.ts`) and never reads this field, so a wider spread makes
 * the ramp around the brand and accent colours bolder without moving either colour. `harmonization`
 * is the one field every other preset holds at 0: letting status hues drift toward the brand is the
 * move `BALANCED`'s docblock reserves for this preset, on the understanding that a brand-tinted
 * danger color is a choice here rather than the defect it would be anywhere else. `accentRotation`
 * opens past Balanced's third-of-circle, still short of the 180-degree complement that reads as a
 * second brand rather than an accent of the first. `surfaceTinting` raises the shadow's chroma
 * ceiling to 0.03, since a livelier interface reads a flat, chromaless shadow as a rendering miss.
 */
export const EXPRESSIVE: InterpretationParams = {
	neutralTinting: 0.6,
	chromaSpread: 1.3,
	harmonization: 0.15,
	accentRotation: 150,
	surfaceTinting: 0.03,
};
