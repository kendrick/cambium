import { createOklchScaleEngine } from '../core/oklch-scale-engine.ts';
import { BALANCED } from '../core/scale-engine.ts';
import { buildTokenSet } from '../core/semantic-layer.ts';
import { loadSeed, SeedLoadError } from './lib/seed.mjs';

/** Mirrors `ScaleEngineError` in core/scale-engine.ts; kept here rather than exported from the core, which has no CLI-facing seam to hang a formatter on. */
function describeEngineError(error) {
	if (error.kind === 'no-key-colors') return 'the seed has no key colours to build a ramp from';

	return `ramp "${error.ramp}" step ${error.step} declared a contrast floor no lightness could reach`;
}

function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

const [, , seedPath] = process.argv;

if (!seedPath) {
	fail('usage: generate <seed-file.json>');
} else {
	let seed;

	try {
		seed = await loadSeed(seedPath);
	} catch (error) {
		if (!(error instanceof SeedLoadError)) throw error;
		fail(error.message);
	}

	if (seed) {
		const result = createOklchScaleEngine().generate(seed, BALANCED);

		if (!result.ok) {
			fail(`scale engine rejected the seed: ${describeEngineError(result.error)}`);
		} else {
			console.log(JSON.stringify(buildTokenSet(result.schemes), null, 2));
		}
	}
}
