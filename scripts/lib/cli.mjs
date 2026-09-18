import { createOklchScaleEngine } from '../../core/oklch-scale-engine.ts';
import { BALANCED } from '../../core/scale-engine.ts';
import { loadSeed } from './seed.mjs';

/** Thrown when the scale engine rejects a seed that already parsed. Kept apart from `SeedLoadError` because the two name different points a CLI can fail at, even though both end the same way: a readable message on stderr and a non-zero exit. */
export class EngineError extends Error {}

/** Mirrors `ScaleEngineError` in core/scale-engine.ts; kept here rather than exported from the core, which has no CLI-facing seam to hang a formatter on. */
function describeEngineError(error) {
	if (error.kind === 'no-key-colors') return 'the seed has no key colours to build a ramp from';

	return `ramp "${error.ramp}" step ${error.step} declared a contrast floor no lightness could reach`;
}

/**
 * Loads a seed file and runs it through the scale engine: the one pipeline both
 * scripts/generate.mjs and scripts/evaluate.mjs need before they diverge into printing a token
 * set or rendering swatches. Sharing it is what keeps a readable message for an engine rejection
 * from existing in one CLI and not the other.
 */
export async function loadSchemes(seedPath) {
	const seed = await loadSeed(seedPath);
	const result = createOklchScaleEngine().generate(seed, BALANCED);

	if (!result.ok) throw new EngineError(describeEngineError(result.error));

	return result.schemes;
}
