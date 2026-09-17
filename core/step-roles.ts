/**
 * Cambium's step-role target table.
 *
 * Radix publishes exactly one numeric guarantee across all twelve steps, stated in APCA against
 * step 2, and `radix-ui/colors#42` has reported several of its own scales missing the guarantee the
 * documentation used to state in WCAG terms since February 2024. So the Radix scales are a taste
 * reference and never a correctness oracle, and this table is Cambium's own work rather than an
 * inheritance. Every floor below was measured off the installed `@radix-ui/colors` package with
 * `scripts/swatches.mjs`, taking the minimum across all sixty-two solid scales in both schemes and
 * leaving the curve some room underneath.
 *
 * Two floors deliberately sit above what Radix achieves. Step 11 is set at the WCAG AA threshold of
 * 4.5, where Radix's own light scales bottom out at 4.25, because Radix targets APCA there and
 * Cambium gates on WCAG. Step 12 is set at 7, the AAA threshold, which Radix clears comfortably.
 *
 * Tailwind was rendered alongside as a familiarity check while the curves were tuned. It publishes
 * no step roles and eleven positional stops rather than twelve, so it contributed nothing here.
 */

export type StepRole = {
	step: number;
	role: string;
	/**
	 * WCAG contrast floor against step 2 of the same ramp, which is the background every other step
	 * is seen on. Null where the step is itself a background, and null at steps 9 and 10, whose
	 * lightness comes from the seed rather than from the curve.
	 */
	minWcagVsStep2: number | null;
	/**
	 * Advisory APCA Lc against step 2, never a gate. APCA is polarity-aware, so one figure cannot
	 * cover both schemes: the number here is what the light scheme is expected to land near. At
	 * steps 11 and 12 it is also the guarantee Radix publishes.
	 *
	 * Zero is a real reading rather than a missing one: steps 3 and 4 sit close enough to step 2 that
	 * APCA reports no perceptible contrast, which is what a background at rest is supposed to do.
	 * Null is reserved for the steps that declare no target at all.
	 *
	 * APCA appears zero times in the WCAG 3.0 Working Draft of 10 September 2026, whose editor's
	 * note says the contrast algorithm for WCAG 3 is still undecided. So it stays advisory, and the
	 * figure is an independent implementation of APCA-1.0.98G rather than a conformance claim.
	 */
	apcaGuidance: number | null;
	/**
	 * The step this one's lightness is measured against. Usually the previous step. Step 11 reaches
	 * back past the anchored pair to step 8, because 9 and 10 float with the seed and a separation
	 * measured against a floating step says nothing.
	 */
	separationFrom: number | null;
	/** Minimum OKLCH lightness between this step and `separationFrom`, so the two stay distinct. */
	minLightnessSeparation: number;
	/**
	 * Steps 9 and 10 carry the seed's own colour rather than a value the curve chose, so they are
	 * exempt from the monotonic chain.
	 *
	 * This is not a convenience. A brand at OKLCH lightness 0.795 cannot sit at step 9 of a ramp
	 * whose step 8 is at 0.734 and still darken monotonically, and issue #4 asks for both. Radix
	 * resolves it the same way: its yellow, amber, lime, mint and sky scales all jump lighter at
	 * steps 9 and 10 and then drop back at 11, and iris breaks later, at step 11.
	 *
	 * All sixty-two solid Radix scales hold the weaker invariant this table encodes, which is that
	 * steps 1 through 8 run monotonically, step 11 continues past step 8, and step 12 continues past
	 * step 11. Step 11 is measured against step 8 rather than step 10 for exactly the reason iris
	 * shows: the anchored pair floats, so a comparison against it proves nothing.
	 *
	 * Reproducing the brand colour wins over an unbroken lightness sequence, because a token set
	 * whose primary is not the brand is not a brand's token set.
	 */
	anchoredToSeed: boolean;
};

export const STEP_ROLES: readonly StepRole[] = [
	{
		step: 1,
		role: 'page background',
		minWcagVsStep2: null,
		apcaGuidance: null,
		separationFrom: null,
		minLightnessSeparation: 0,
		anchoredToSeed: false,
	},
	{
		step: 2,
		role: 'subtle background',
		minWcagVsStep2: null,
		apcaGuidance: null,
		separationFrom: 1,
		minLightnessSeparation: 0.008,
		anchoredToSeed: false,
	},
	{
		step: 3,
		role: 'component background at rest',
		minWcagVsStep2: 1.04,
		apcaGuidance: 0,
		separationFrom: 2,
		minLightnessSeparation: 0.018,
		anchoredToSeed: false,
	},
	{
		step: 4,
		role: 'component background on hover',
		minWcagVsStep2: 1.1,
		apcaGuidance: 0,
		separationFrom: 3,
		minLightnessSeparation: 0.02,
		anchoredToSeed: false,
	},
	{
		step: 5,
		role: 'component background when active',
		minWcagVsStep2: 1.18,
		apcaGuidance: 13,
		separationFrom: 4,
		minLightnessSeparation: 0.024,
		anchoredToSeed: false,
	},
	{
		step: 6,
		role: 'subtle border',
		minWcagVsStep2: 1.3,
		apcaGuidance: 20,
		separationFrom: 5,
		minLightnessSeparation: 0.03,
		anchoredToSeed: false,
	},
	{
		step: 7,
		role: 'border',
		minWcagVsStep2: 1.45,
		apcaGuidance: 30,
		separationFrom: 6,
		minLightnessSeparation: 0.04,
		anchoredToSeed: false,
	},
	{
		step: 8,
		role: 'strong border',
		minWcagVsStep2: 1.8,
		apcaGuidance: 42,
		separationFrom: 7,
		minLightnessSeparation: 0.05,
		anchoredToSeed: false,
	},
	{
		step: 9,
		role: 'solid fill, the brand colour itself',
		minWcagVsStep2: null,
		apcaGuidance: null,
		separationFrom: null,
		minLightnessSeparation: 0,
		anchoredToSeed: true,
	},
	{
		step: 10,
		role: 'solid fill on hover',
		minWcagVsStep2: null,
		apcaGuidance: null,
		separationFrom: 9,
		minLightnessSeparation: 0.01,
		anchoredToSeed: true,
	},
	{
		step: 11,
		role: 'low-contrast text',
		minWcagVsStep2: 4.5,
		apcaGuidance: 60,
		separationFrom: 8,
		minLightnessSeparation: 0.12,
		anchoredToSeed: false,
	},
	{
		step: 12,
		role: 'high-contrast text',
		minWcagVsStep2: 7,
		apcaGuidance: 90,
		separationFrom: 11,
		minLightnessSeparation: 0.08,
		anchoredToSeed: false,
	},
];

/** The step the semantic layer in #6 takes as the pure brand colour. */
export const BRAND_STEP = 9;
