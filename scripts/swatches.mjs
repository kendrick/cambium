import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import tailwindColors from 'tailwindcss/colors.js';
import { createOklchScaleEngine } from '../core/oklch-scale-engine.ts';
import { BALANCED } from '../core/interpretation.ts';
import { RAMP_NAMES } from '../core/scale-engine.ts';
import { asCulori, measureRamp, renderSwatchPage } from './lib/swatches.mjs';

// @radix-ui/colors ships CJS with types that only declare `export * from './light'` etc., so any
// static `import x from` reads to a linter as reaching for a default export that doesn't exist.
// `require` sidesteps the false positive and hands back exactly what the package actually is: a
// plain object of the 252 named scales.
const radixColors = createRequire(import.meta.url)('@radix-ui/colors');

const OUT_DIR = new URL('../swatches/', import.meta.url);

const NEUTRALS = new Set(['gray', 'mauve', 'slate', 'sage', 'olive', 'sand']);

const RADIX_NOTE =
	'Radix publishes exactly one numeric guarantee across twelve steps, so these are measured ' +
	'values and a taste reference, never a correctness oracle.';

const TAILWIND_NOTE =
	'Tailwind has eleven positional stops and publishes no step roles, so this is a familiarity ' +
	'reference for curve shape only and contributes nothing to the target table.';

// Radix ships every scale four ways (solid, alpha, P3, P3-alpha); these two shapes are the only
// ones this driver wants. `Dark` never collides with a hue name because every Radix hue is
// lowercase.
const isSolidLightName = (name) => /^[a-z]+$/.test(name);
const isSolidDarkName = (name) => /^[a-z]+Dark$/.test(name);

function radixRow(name) {
	return { label: name.replace(/Dark$/, ''), steps: measureRamp(Object.values(radixColors[name])) };
}

const lightNames = Object.keys(radixColors).filter(isSolidLightName);
const darkNames = Object.keys(radixColors).filter(isSolidDarkName);

const chromaticLightNames = lightNames.filter((name) => !NEUTRALS.has(name));
const neutralLightNames = lightNames.filter((name) => NEUTRALS.has(name));
const chromaticDarkNames = darkNames.filter((name) => !NEUTRALS.has(name.replace(/Dark$/, '')));
const neutralDarkNames = darkNames.filter((name) => NEUTRALS.has(name.replace(/Dark$/, '')));

// Tailwind's export mixes real scales with string aliases (`inherit`, `current`, deprecated
// hues); a scale is only ever a plain object of stop strings, so anything else is skipped.
const isColorScale = (value) =>
	typeof value === 'object' &&
	value !== null &&
	Object.values(value).every((stop) => typeof stop === 'string');

const TAILWIND_SAMPLE = ['slate', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];

const tailwindRows = TAILWIND_SAMPLE.filter((name) => isColorScale(tailwindColors[name])).map(
	(name) => ({
		label: name,
		steps: measureRamp(Object.values(tailwindColors[name])),
	}),
);

const CAMBIUM_NOTE =
	'Steps 9 and 10 carry the seed colour itself rather than a curve value, so they are exempt ' +
	'from the monotonic lightness chain and can land lighter than step 8 for a light brand like ' +
	'yellow. That is deliberate: Radix does the same for its own yellow, amber, lime, mint and ' +
	'sky scales.';

// Four seeds spanning the hue wheel, and more usefully spanning lightness: yellow sits at 0.795
// and crimson at 0.586, which is the spread that makes the step 9 and 10 carve-out visible.
const CAMBIUM_SEEDS = [
	{ name: 'blue', oklch: [0.6231, 0.188, 259.8] },
	{ name: 'yellow', oklch: [0.7952, 0.1617, 86.0] },
	{ name: 'crimson', oklch: [0.5858, 0.222, 17.6] },
	{ name: 'green', oklch: [0.6959, 0.1491, 162.5] },
];

// Every field is a required key holding a nullable value, never an optional key. The engine
// reads a seed shaped exactly like the one the extractors would eventually produce.
function seedFrom(oklch) {
	return {
		keyColors: [{ oklch, proposedRole: 'brand', sourceImageId: 'swatch-seed', sourceRegion: null }],
		neutralTemperature: null,
		surfacePolarity: null,
		radiusCharacter: null,
		shadowCharacter: null,
		trackingFeel: null,
		typeClassification: null,
		suggestedPairing: null,
		typeScaleRatio: null,
		imageClassifications: null,
		expressive: null,
	};
}

const oklchEngine = createOklchScaleEngine();

const cambiumSeeds = CAMBIUM_SEEDS.map(({ name, oklch }) => {
	const result = oklchEngine.generate(seedFrom(oklch), BALANCED);

	if (!result.ok) throw new Error(`scale engine rejected the ${name} seed: ${result.error.kind}`);

	return { name, schemes: result.schemes };
});

function cambiumRows(scheme) {
	return cambiumSeeds.flatMap(({ name, schemes }) =>
		RAMP_NAMES.map((rampName) => ({
			label: `${name} / ${rampName}`,
			steps: measureRamp(schemes[scheme][rampName].map(asCulori)),
		})),
	);
}

const blueCambium = cambiumSeeds.find((seed) => seed.name === 'blue');

// Radix's blue is the closest published scale to Cambium's blue seed, so it is the one worth
// laying curve-against-curve rather than picking a scale that would flatter either side.
const comparisonRows = [
	{ label: 'cambium / light', steps: measureRamp(blueCambium.schemes.light.brand.map(asCulori)) },
	{ label: 'radix / light', steps: measureRamp(Object.values(radixColors.blue)) },
	{ label: 'cambium / dark', steps: measureRamp(blueCambium.schemes.dark.brand.map(asCulori)) },
	{ label: 'radix / dark', steps: measureRamp(Object.values(radixColors.blueDark)) },
];

const groups = [
	{ title: 'Cambium light', note: CAMBIUM_NOTE, rows: cambiumRows('light') },
	{ title: 'Cambium dark', note: CAMBIUM_NOTE, rows: cambiumRows('dark') },
	{ title: 'Cambium against Radix, blue brand ramp', note: CAMBIUM_NOTE, rows: comparisonRows },
	{ title: 'Radix light, chromatic', note: RADIX_NOTE, rows: chromaticLightNames.map(radixRow) },
	{ title: 'Radix light, neutrals', note: RADIX_NOTE, rows: neutralLightNames.map(radixRow) },
	{ title: 'Radix dark, chromatic', note: RADIX_NOTE, rows: chromaticDarkNames.map(radixRow) },
	{ title: 'Radix dark, neutrals', note: RADIX_NOTE, rows: neutralDarkNames.map(radixRow) },
	{ title: 'Tailwind v4 reference', note: TAILWIND_NOTE, rows: tailwindRows },
];

function median(values) {
	const sorted = values.toSorted((a, b) => a - b);
	const mid = sorted.length >> 1;

	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * The target table wants a floor most scales clear, not an average a third of them miss, so
 * median stands in for mean. Min/max ride along so an outlier scale doesn't hide behind the
 * median. APCA sign flips between light and dark ramps (it encodes text-over-background
 * polarity, not ramp quality), so it's folded to magnitude before aggregating.
 */
function aggregateStats(rows) {
	const stepCount = rows[0].steps.length;

	return Array.from({ length: stepCount }, (_, index) => {
		const atStep = rows.map((row) => row.steps[index]);
		const l = atStep.map((step) => step.l);
		const c = atStep.map((step) => step.c);
		const wcag = atStep.map((step) => step.wcag);
		const apca = atStep.map((step) => Math.abs(step.apca));

		return {
			step: index + 1,
			l: { median: median(l), min: Math.min(...l), max: Math.max(...l) },
			c: { median: median(c), min: Math.min(...c), max: Math.max(...c) },
			wcag: { median: median(wcag), min: Math.min(...wcag), max: Math.max(...wcag) },
			apca: { median: median(apca) },
		};
	});
}

const measurements = {
	chromaticLight: aggregateStats(chromaticLightNames.map(radixRow)),
	chromaticDark: aggregateStats(chromaticDarkNames.map(radixRow)),
	neutralLight: aggregateStats(neutralLightNames.map(radixRow)),
	neutralDark: aggregateStats(neutralDarkNames.map(radixRow)),
};

// Radix's own stated guarantee is APCA Lc 60 at step 11 and Lc 90 at step 12, both against step
// 2. Checking every solid scale (not just the aggregate) is what surfaces which named scales miss
// their own vendor's promise, which the median alone would smooth over.
function guaranteeFailures(names) {
	return names.flatMap((name) => {
		const steps = measureRamp(Object.values(radixColors[name]));
		const lc11 = Math.abs(steps[10].apca);
		const lc12 = Math.abs(steps[11].apca);
		const misses = [];

		if (lc11 < 60) misses.push(`step 11 Lc ${lc11.toFixed(1)} (< 60)`);
		if (lc12 < 90) misses.push(`step 12 Lc ${lc12.toFixed(1)} (< 90)`);

		return misses.length > 0 ? [`${name}: ${misses.join(', ')}`] : [];
	});
}

const allSolidNames = [...lightNames, ...darkNames];
const failures = guaranteeFailures(allSolidNames);

const pad = (value, width) => String(value).padEnd(width);
const num = (value, digits, width) => value.toFixed(digits).padStart(width);

function printStatsTable(title, stats) {
	console.log(`\n${title}`);
	console.log(
		pad('step', 5) +
			pad('L median (min-max)', 24) +
			pad('C median (min-max)', 24) +
			pad('WCAG median (min-max)', 24) +
			'APCA median',
	);

	for (const row of stats) {
		const lCell = `${num(row.l.median, 3, 5)} (${row.l.min.toFixed(3)}-${row.l.max.toFixed(3)})`;
		const cCell = `${num(row.c.median, 3, 5)} (${row.c.min.toFixed(3)}-${row.c.max.toFixed(3)})`;
		const wCell = `${num(row.wcag.median, 2, 5)} (${row.wcag.min.toFixed(2)}-${row.wcag.max.toFixed(2)})`;
		const aCell = row.apca.median.toFixed(1);

		console.log(pad(row.step, 5) + pad(lCell, 24) + pad(cCell, 24) + pad(wCell, 24) + aCell);
	}
}

await mkdir(OUT_DIR, { recursive: true });

await writeFile(new URL('index.html', OUT_DIR), renderSwatchPage(groups));
await writeFile(
	new URL('measurements.json', OUT_DIR),
	`${JSON.stringify(measurements, null, '\t')}\n`,
);

console.log('Wrote swatches/index.html and swatches/measurements.json');

printStatsTable('Radix chromatic, light (25 scales)', measurements.chromaticLight);
printStatsTable('Radix chromatic, dark (25 scales)', measurements.chromaticDark);
printStatsTable('Radix neutrals, light (6 scales)', measurements.neutralLight);
printStatsTable('Radix neutrals, dark (6 scales)', measurements.neutralDark);

console.log('\nScales missing Radix’s own Lc 60 / Lc 90 guarantee at steps 11 / 12 vs. step 2:');
if (failures.length === 0) {
	console.log('  none');
} else {
	for (const line of failures) console.log(`  ${line}`);
}
