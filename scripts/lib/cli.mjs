import { createOklchScaleEngine } from '../../core/oklch-scale-engine.ts';
import { BALANCED } from '../../core/scale-engine.ts';
import { loadSeed, SeedLoadError } from './seed.mjs';

/**
 * Thrown when the scale engine rejects a seed that already parsed. Kept apart from
 * `SeedLoadError` because the two name different points a CLI can fail at, even though both end
 * the same way: a readable message on stderr and a non-zero exit.
 */
export class EngineError extends Error {}

/**
 * Mirrors `ScaleEngineError` in core/scale-engine.ts; kept here rather than exported from the
 * core, which has no CLI-facing seam to hang a formatter on.
 */
function describeEngineError(error) {
	if (error.kind === 'no-key-colors') return 'the seed has no key colours to build a ramp from';

	return `ramp "${error.ramp}" step ${error.step} declared a contrast floor no lightness could reach`;
}

/**
 * Loads a seed file and runs it through the scale engine: the one pipeline both
 * scripts/generate.mjs and scripts/evaluate.mjs need before they diverge into printing a token
 * set or rendering swatches. Sharing it is what keeps a readable message for an engine rejection
 * from existing in one CLI and not the other.
 *
 * Hands back the seed alongside the schemes because `buildTokenSet` needs both: #7's non-colour
 * categories derive from the seed, not from the ramps. It was parsed here anyway, and returning it
 * beats making a caller read and validate the same file a second time.
 */
export async function loadSchemes(seedPath) {
	const seed = await loadSeed(seedPath);
	const result = createOklchScaleEngine().generate(seed, BALANCED);

	if (!result.ok) throw new EngineError(describeEngineError(result.error));

	return { seed, schemes: result.schemes };
}

/**
 * The argv-to-exit skeleton scripts/generate.mjs and scripts/evaluate.mjs both need: read the
 * seed path, print `usage` and exit 1 if it's missing, run `body(seedPath)`, and turn a
 * `SeedLoadError` or `EngineError` into the same readable-message-then-exit-1 shape. This is what
 * kept the two scripts from reporting the same failure two different ways.
 */
export async function runCli(usage, body) {
	const [, , seedPath] = process.argv;

	if (!seedPath) {
		console.error(`usage: ${usage}`);
		process.exitCode = 1;
		return;
	}

	try {
		await body(seedPath);
	} catch (error) {
		if (!(error instanceof SeedLoadError) && !(error instanceof EngineError)) throw error;

		console.error(error.message);
		process.exitCode = 1;
	}
}
