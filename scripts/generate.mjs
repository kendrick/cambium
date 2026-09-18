import { buildTokenSet } from '../core/semantic-layer.ts';
import { loadSchemes, runCli } from './lib/cli.mjs';

await runCli('generate <seed-file.json>', async (seedPath) => {
	const schemes = await loadSchemes(seedPath);

	console.log(JSON.stringify(buildTokenSet(schemes), null, 2));
});
