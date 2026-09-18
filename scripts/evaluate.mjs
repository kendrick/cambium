import { mkdir, writeFile } from 'node:fs/promises';
import { createOklchScaleEngine } from '../core/oklch-scale-engine.ts';
import { BALANCED, RAMP_NAMES, SCHEME_NAMES } from '../core/scale-engine.ts';
import { STEP_ROLES } from '../core/step-roles.ts';
import { measureRamp, renderSwatchPage } from './lib/swatches.mjs';
import { loadSeed, SeedLoadError } from './lib/seed.mjs';

const OUT_DIR = new URL('../swatches/', import.meta.url);

const NOTE =
	'Every ramp from this seed, both schemes, measured against the step-role floors in ' +
	'core/step-roles.ts. A step outlined in red misses its WCAG floor against its own ramp’s ' +
	'step 2; APCA rides along as advisory and never decides the outline.';

// measureRamp takes anything culori parses; a Cambium ramp step is `{ step, l, c, h }`, one field
// short of the `{ mode, l, c, h }` shape culori actually wants.
const asCulori = (step) => ({ mode: 'oklch', l: step.l, c: step.c, h: step.h });

function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

const [, , seedPath] = process.argv;

if (!seedPath) {
	fail('usage: evaluate <seed-file.json>');
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
			fail(`scale engine rejected the seed: ${result.error.kind}`);
		} else {
			const groups = SCHEME_NAMES.map((scheme) => ({
				title: `${scheme} scheme`,
				note: NOTE,
				rows: RAMP_NAMES.map((rampName) => ({
					label: rampName,
					steps: measureRamp(result.schemes[scheme][rampName].map(asCulori), STEP_ROLES),
				})),
			}));

			await mkdir(OUT_DIR, { recursive: true });
			await writeFile(
				new URL('seed.html', OUT_DIR),
				renderSwatchPage(groups, 'Cambium seed evaluation'),
			);

			console.log('Wrote swatches/seed.html');
		}
	}
}
