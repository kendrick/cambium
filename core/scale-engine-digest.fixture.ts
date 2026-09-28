/**
 * One digest per shipped engine id, over the schemes that engine produces for the four seeds in
 * `core/scale-engine-contract.ts`. The digest-pin case there fails an id whose output moved without
 * a new id following it; see the docblock on `ScaleEngine.id` in `core/scale-engine.ts` for the
 * rule this fixture exists to hold.
 *
 * Append only. A shipped id's digest never changes in place: output moving under an id that already
 * has an entry here is exactly the failure the contract exists to catch, so the only green path is
 * a new id with a new entry, the old one left untouched beside it.
 */
export const ENGINE_DIGESTS: Readonly<Record<string, string>> = {
	// The engine's original output, pinned when #99 added this fixture.
	'cambium-oklch-1': 'e4d6a1874554b831892f52ab35f0e31d89e67a4f3dff7c733af77ca7b874ba4c',
};
