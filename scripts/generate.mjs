import { withContrastRepairs } from '../core/contrast/repair.ts';
import { buildTokenSet } from '../core/semantic-layer.ts';
import { loadSchemes, runCli } from './lib/cli.mjs';

await runCli('generate <seed-file.json>', async (seedPath) => {
	const { seed, schemes } = await loadSchemes(seedPath);

	// The same repaired set the workspace paints (#8), so a seed's CLI output and its preview agree.
	console.log(JSON.stringify(withContrastRepairs(buildTokenSet(schemes, seed)).tokenSet, null, 2));
});
