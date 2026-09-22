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
 * Every derivation module takes these rather than holding a constant of its own, so adding a preset
 * later is a new value here instead of a sweep through every function. #4 declared them inside the
 * scale engine because it was the first consumer; #10 moved them out when the second one turned out
 * to be a module forbidden from importing anything that can reach a colour.
 */
export type InterpretationParams = {
	/** How far the neutral ramp's chroma pulls toward the brand hue. 0 leaves it dead neutral. */
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
	 * and it produces black: `background` aliases `neutral.1`, which measures around 0.0002 in light
	 * and 0.0007 in dark. So the surface supplies the hue and this supplies the depth.
	 *
	 * A ceiling rather than a promise. sRGB holds almost no chroma near black, so a shadow on a dark
	 * page lands between 0.0048 and 0.0194 whatever this says. #7 records that trade.
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
