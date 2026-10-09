/**
 * One digest per shipped engine id, over the complete `ScaleEngineResult`—schemes, anchor, and any
 * failure shape—that engine produces for the four seeds in `core/scale-engine-contract.ts` run under
 * every params set in that file's PARAM_SETS, plus that file's `P3_ONLY_SEED` and
 * `NO_KEY_COLORS_SEED`, the two fixed points that actually move `anchor.deviation` off zero and give
 * the hash a failure shape to see. The digest-pin case there fails an id whose output moved without a
 * new id following it; see the docblock on `ScaleEngine.id` in `core/scale-engine.ts` for the rule
 * this fixture samples rather than proves.
 *
 * Append only. A shipped id's digest never changes in place: output moving under an id that already
 * has an entry here is exactly the failure the contract exists to catch, so the only green path is
 * a new id with a new entry, the old one left untouched beside it.
 *
 * Widening what PARAM_SETS or SEEDS samples is the one deliberate exception, and it looks nothing
 * like that failure: every shipped id's digest moves at once, because the same wider input is being
 * re-hashed for all of them, not just one. That's why it's safe to review—both literal copies of
 * every entry change together, here and in `PINNED_DIGESTS`—and why nothing here asserts that two
 * ids' digests differ. A change an id bump was required for but this sample never varies leaves the
 * new id's digest identical to the old one's, and appending that shared value is the compliant
 * update, not a collision.
 */
export const ENGINE_DIGESTS: Readonly<Record<string, string>> = {
	// The first id the pin covers. `cambium-oklch-1` gets no entry, because it named several outputs
	// (see `OKLCH_SCALE_ENGINE_ID`), so no single digest describes it.
	'cambium-oklch-2': '5c33f508696b0466ada2a2eefa6d7134a7053cfb9d1f429a43bcefef27833711',
	// Same digest on purpose: #146 changed repair, not the ramps this sample sees.
	'cambium-oklch-3': '5c33f508696b0466ada2a2eefa6d7134a7053cfb9d1f429a43bcefef27833711',
};
