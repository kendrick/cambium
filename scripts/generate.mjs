import { buildTokenSet } from '../core/semantic-layer.ts';
import { EngineError, loadSchemes } from './lib/cli.mjs';
import { SeedLoadError } from './lib/seed.mjs';

const [, , seedPath] = process.argv;

if (!seedPath) {
	console.error('usage: generate <seed-file.json>');
	process.exitCode = 1;
} else {
	try {
		const schemes = await loadSchemes(seedPath);

		console.log(JSON.stringify(buildTokenSet(schemes), null, 2));
	} catch (error) {
		if (!(error instanceof SeedLoadError) && !(error instanceof EngineError)) throw error;

		console.error(error.message);
		process.exitCode = 1;
	}
}
