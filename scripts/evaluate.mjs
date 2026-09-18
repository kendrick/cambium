import { mkdir, writeFile } from 'node:fs/promises';
import { RAMP_NAMES, SCHEME_NAMES } from '../core/scale-engine.ts';
import { STEP_ROLES } from '../core/step-roles.ts';
import { EngineError, loadSchemes } from './lib/cli.mjs';
import { SeedLoadError } from './lib/seed.mjs';
import { measureRamp, renderSwatchPage } from './lib/swatches.mjs';

const OUT_DIR = new URL('../swatches/', import.meta.url);

const NOTE =
	'Every ramp from this seed, both schemes, measured against the step-role floors in ' +
	'core/step-roles.ts. A step outlined in red misses its WCAG floor against its own ramp’s ' +
	'step 2; APCA rides along as advisory and never decides the outline.';

// measureRamp takes anything culori parses; a Cambium ramp step is `{ step, l, c, h }`, one field
// short of the `{ mode, l, c, h }` shape culori actually wants.
const asCulori = (step) => ({ mode: 'oklch', l: step.l, c: step.c, h: step.h });

const [, , seedPath] = process.argv;

if (!seedPath) {
	console.error('usage: evaluate <seed-file.json>');
	process.exitCode = 1;
} else {
	try {
		const schemes = await loadSchemes(seedPath);

		const groups = SCHEME_NAMES.map((scheme) => ({
			title: `${scheme} scheme`,
			note: NOTE,
			rows: RAMP_NAMES.map((rampName) => ({
				label: rampName,
				steps: measureRamp(schemes[scheme][rampName].map(asCulori), STEP_ROLES),
			})),
		}));

		await mkdir(OUT_DIR, { recursive: true });
		await writeFile(
			new URL('seed.html', OUT_DIR),
			renderSwatchPage(groups, 'Cambium seed evaluation'),
		);

		console.log('Wrote swatches/seed.html');
	} catch (error) {
		if (!(error instanceof SeedLoadError) && !(error instanceof EngineError)) throw error;

		console.error(error.message);
		process.exitCode = 1;
	}
}
