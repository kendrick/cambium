/**
 * One digest per shipped engine id, over the complete `ScaleEngineResult`—schemes, anchor, and any
 * failure shape—that engine produces for the four seeds in `core/scale-engine-contract.ts`,
 * each seed run under every params set in that file's PARAM_SETS. The digest-pin case there fails
 * an id whose output moved without a new id following it; see the docblock on `ScaleEngine.id` in
 * `core/scale-engine.ts` for the rule this fixture samples rather than proves.
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
	// Re-hashed for PR #162's review to cover the complete result (schemes, anchor, and any failure
	// shape) rather than schemes alone, closing the gap where an anchor-only or failure-shaped change
	// left the old, schemes-only digest untouched. The engine's output did not change; this replaces
	// the schemes-only digest #99's widening wave pinned.
	'cambium-oklch-1': 'e094831b05d498887caef00d6cd3c0000e0269dbf78b3e2a3a16b1cda2d2705b',
};
