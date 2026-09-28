/**
 * One digest per shipped engine id, over the schemes that engine produces for the four seeds in
 * `core/scale-engine-contract.ts`, each seed run under every params set in that file's PARAM_SETS.
 * The digest-pin case there fails an id whose output moved without a new id following it; see the
 * docblock on `ScaleEngine.id` in `core/scale-engine.ts` for the rule this fixture samples rather
 * than proves.
 *
 * Append only. A shipped id's digest never changes in place: output moving under an id that already
 * has an entry here is exactly the failure the contract exists to catch, so the only green path is
 * a new id with a new entry, the old one left untouched beside it.
 */
export const ENGINE_DIGESTS: Readonly<Record<string, string>> = {
	// Re-hashed for #99's repair wave to also cover PARAM_SETS's stress case, not just Balanced.
	// The engine's output did not change; this is the same shipped output over wider sampled input,
	// replacing the Balanced-only digest #99 first pinned.
	'cambium-oklch-1': '0a383775a85aee1a28e3a7ec7de39dc9e71a53f02a0021ec078efa2f8f2ecb1a',
};
