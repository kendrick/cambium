import { describe, expect, it, vi } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from '../brand-seed';
import { repairContrast } from '../contrast/repair';
import { toOklchCss } from '../css/oklch-css';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { CAMBIUM_NAMESPACE, type TokenProvenance } from '../provenance';
import { RAMP_NAMES } from '../scale-engine';
import { buildTokenSet } from '../semantic-layer';
import type { TokenSet } from '../token-set';
import { designDoc } from './design-doc';

/**
 * Two key colours, both character fields, a full type classification and a ranked pairing, built
 * the way every other fixture in `core/` is: a literal `BrandSeedSchema.parse` with each of the
 * eleven fields spelled out. No existing `core/*.test.ts` fixture combines two key colours with a
 * stated `typeClassification` in one seed (`provenance.test.ts`'s `STATED_SEED` has two key colours
 * and no type classification; `rank-fonts.test.ts`'s classified seeds carry no second key colour),
 * so this fixture is its own rather than an import — see `plan_concerns` in the report for why the
 * plan's "reuse a seed fixture" step didn't apply as written.
 *
 * The brand hue sits at magenta, mid-lightness: `core/contrast/repair.ts`'s own docblock names
 * magenta's dark-scheme repair as the case that drove `STRICT_EPSILON`, so it is a color already
 * known in this codebase to need a repair rather than one hand-picked to force one.
 */
const seed: BrandSeed = BrandSeedSchema.parse({
	keyColors: [
		{ oklch: [0.55, 0.25, 330], proposedRole: 'brand', sourceImageId: 'img-1', sourceRegion: null },
		{ oklch: [0.7, 0.16, 35], proposedRole: 'accent', sourceImageId: 'img-1', sourceRegion: null },
	],
	neutralTemperature: { hue: 259.8, chroma: 0.006 },
	radiusCharacter: { base: 12, progression: 'soft' },
	shadowCharacter: { spread: 'diffuse', tintFromSurface: true },
	trackingFeel: 'wide',
	typeClassification: {
		category: 'sans',
		tone: 'geometric',
		xHeight: 'medium',
		displayDiffersFromBody: true,
	},
	suggestedPairing: {
		display: [
			{
				provenance: 'derived',
				family: 'Geo Sans',
				score: 92,
				rationale: 'Scores 92 on /Sans/Geometric, matching the seed tone.',
			},
		],
		body: [
			{
				provenance: 'derived',
				family: 'Reading Sans',
				score: 81,
				rationale: 'Scores 81 on /Sans/Neutral, matching the seed tone.',
			},
		],
		mono: [
			{
				provenance: 'invented',
				family: 'System Mono',
				score: null,
				rationale: 'No monospace candidate scored highly enough to suggest one.',
			},
		],
	},
	typeScaleRatio: 1.25,
	imageClassifications: [{ imageId: 'img-1', detected: 'logo' }],
	expressive: [{ axis: 'Calm', score: 88 }],
});

const generated = createOklchScaleEngine().generate(seed, BALANCED);

if (!generated.ok)
	throw new Error(`the scale engine rejected the fixture seed: ${generated.error.kind}`);

const tokens: TokenSet = buildTokenSet(generated.schemes, seed);
const { report: repairs } = repairContrast(tokens);

// The fixture's whole point is exercising the repairs section, so a seed that stopped needing one
// (a future engine change, say) has to fail loudly here rather than leave that section untested.
if (repairs.length === 0) {
	throw new Error(
		'fixture seed produced no contrast repairs; the repairs section would go untested',
	);
}

const doc = designDoc({ tokens, seed, repairs });
const docLines = doc.split('\n');

/**
 * A markdown table as this generator writes it: a header row, a `---` separator of the same width,
 * then zero or more data rows, each `|`-delimited and ending exactly where a blank line or the
 * document does.
 */
type ParsedTable = { headers: string[]; rows: string[][] };

function splitRow(line: string): string[] {
	// Strips the leading/trailing pipe rather than splitting on `|`, so an escaped `\|` inside a
	// cell survives the split; unescaped after, once each cell is on its own.
	const inner = line.slice(1, -1);
	const cells: string[] = [];
	let current = '';

	for (let i = 0; i < inner.length; i += 1) {
		if (inner[i] === '\\' && inner[i + 1] === '|') {
			current += '|';
			i += 1;
		} else if (inner[i] === '|') {
			cells.push(current.trim());
			current = '';
		} else {
			current += inner[i];
		}
	}
	cells.push(current.trim());

	return cells;
}

function parseTables(lines: readonly string[]): ParsedTable[] {
	const tables: ParsedTable[] = [];

	for (let i = 0; i < lines.length - 1; i += 1) {
		const header = lines[i]!;
		const separator = lines[i + 1]!;

		if (!header.startsWith('| ') || !/^\|(\s*-+\s*\|)+$/.test(separator)) continue;

		const headers = splitRow(header);
		const rows: string[][] = [];
		let j = i + 2;

		while (j < lines.length && lines[j]!.startsWith('| ')) {
			rows.push(splitRow(lines[j]!));
			j += 1;
		}

		tables.push({ headers, rows });
	}

	return tables;
}

const tables = parseTables(docLines);

describe('designDoc structure', () => {
	it('renders valid markdown that parses without broken structure', () => {
		expect(doc.length).toBeGreaterThan(0);
		expect(doc.endsWith('\n')).toBe(true);
	});

	it('uses only # then ## heading levels, never skipping a level', () => {
		const levels = docLines
			.filter((line) => /^#{1,6} /.test(line))
			.map((line) => line.match(/^#+/)![0]!.length);

		expect(levels[0]).toBe(1);

		for (let i = 1; i < levels.length; i += 1) {
			expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
			expect(levels[i]).toBeLessThanOrEqual(2);
		}
	});

	it('gives every table row the same column count as its header', () => {
		expect(tables.length).toBeGreaterThan(0);

		for (const t of tables) {
			for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
		}
	});

	it('never leaves an odd number of unescaped backticks on a line', () => {
		for (const line of docLines) {
			const unescaped = line.replace(/\\`/g, '');
			const backticks = unescaped.match(/`/g)?.length ?? 0;

			expect(backticks % 2).toBe(0);
		}
	});
});

describe('designDoc purity', () => {
	it('returns the same string for the same input', () => {
		expect(designDoc({ tokens, seed, repairs })).toBe(doc);
	});

	it('is pure even with fetch stubbed to throw', () => {
		vi.stubGlobal('fetch', () => {
			throw new Error('designDoc must never call fetch');
		});

		try {
			expect(designDoc({ tokens, seed, repairs })).toBe(doc);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

/**
 * Independently re-derived from the three inputs, not imported from `design-doc.ts`: a coverage or
 * traceability check that walked the set the same way the generator does would only prove the
 * generator agrees with itself. `TokenSet`'s shape is public (`core/token-set.ts`), so re-walking it
 * here is the same move `core/provenance.test.ts`'s `payloadOf` makes.
 */
function extensionsOf(holder: {
	$extensions: { [CAMBIUM_NAMESPACE]: TokenProvenance };
}): TokenProvenance {
	return holder.$extensions[CAMBIUM_NAMESPACE];
}

type Observed = { path: string; extensions: TokenProvenance; value?: string };

function independentWalk(set: TokenSet): Observed[] {
	const out: Observed[] = [];

	for (const ramp of RAMP_NAMES) {
		for (const step of set.primitives[ramp] ?? []) {
			out.push({
				path: `${ramp}.${step.step}`,
				extensions: extensionsOf(step),
				value: toOklchCss({ l: step.l, c: step.c, h: step.h }),
			});
		}
	}

	for (const [token, entry] of Object.entries(set.semantic)) {
		out.push({ path: `semantic.${token}`, extensions: extensionsOf(entry) });
	}

	const record = (prefix: string, values: Record<string, { $extensions: unknown }>) => {
		for (const [key, value] of Object.entries(values)) {
			out.push({ path: `${prefix}.${key}`, extensions: extensionsOf(value as never) });
		}
	};

	record('shadow.values', set.shadow.values);
	record('radius.values', set.radius.values);
	record('typography.values.size', set.typography.values.size);
	record('typography.values.weight', set.typography.values.weight);
	record('typography.values.lineHeight', set.typography.values.lineHeight);
	record('tracking.values', set.tracking.values);
	record('spacing.values', set.spacing.values);
	record('opacity.values', set.opacity.values);
	record('motion.values.duration', set.motion.values.duration);
	record('motion.values.easing', set.motion.values.easing);
	out.push({
		path: 'focusRing.values.width',
		extensions: extensionsOf(set.focusRing.values.width),
	});
	out.push({
		path: 'focusRing.values.offset',
		extensions: extensionsOf(set.focusRing.values.offset),
	});
	record('zIndex.values', set.zIndex.values);

	return out;
}

const walked = independentWalk(tokens);
const observedTokens = walked.filter((e) => e.extensions.provenance === 'observed');
const inventedTokens = walked.filter((e) => e.extensions.provenance === 'invented');

describe('designDoc coverage', () => {
	it('names every observed token path and the seed field it came from', () => {
		expect(observedTokens.length).toBeGreaterThan(0);

		for (const entry of observedTokens) {
			expect(doc).toContain(entry.path);
			expect(doc).toContain(entry.extensions.seedField as string);
		}
	});

	it('marks every invented token path on a line naming it invented', () => {
		expect(inventedTokens.length).toBeGreaterThan(0);

		for (const entry of inventedTokens) {
			const line = docLines.find((l) => l.includes(entry.path));

			expect(line, `no line carries ${entry.path}`).toBeDefined();
			expect(line).toContain('invented');
		}
	});

	it('prints both ratios of every repair', () => {
		for (const entry of repairs) {
			expect(doc).toContain(entry.measured.toFixed(2));
			expect(doc).toContain(entry.achieved.toFixed(2));
		}
	});

	it('distinguishes the measured type classification from the suggested family list', () => {
		expect(doc).toContain(seed.typeClassification!.category);
		expect(doc).toContain(seed.typeClassification!.tone);
		expect(doc).toContain(seed.typeClassification!.xHeight);
		expect(doc).toContain('Geo Sans');
		expect(doc).toContain('Reading Sans');
		expect(doc).toContain('no score');
	});
});

/**
 * The universe of strings a table cell is allowed to be built from: every rationale, every path
 * component, every seed field name, every provenance value, every formatted number the three
 * inputs actually carry. A cell outside this set is a free-form assertion the plan forbids.
 */
function allowedAtoms(): Set<string> {
	const atoms = new Set<string>();

	for (const entry of walked) {
		atoms.add(entry.path);
		atoms.add(entry.extensions.rationale);
		atoms.add(entry.extensions.provenance);
		if (entry.extensions.seedField) atoms.add(entry.extensions.seedField);
		if (entry.value) atoms.add(entry.value);
	}

	if (seed.typeClassification) {
		atoms.add(seed.typeClassification.category);
		atoms.add(seed.typeClassification.tone);
		atoms.add(seed.typeClassification.xHeight);
	}

	if (seed.suggestedPairing) {
		for (const role of ['display', 'body', 'mono'] as const) {
			atoms.add(role);
			for (const candidate of seed.suggestedPairing[role]) {
				atoms.add(candidate.family);
				atoms.add(candidate.score === null ? 'no score' : String(candidate.score));
			}
		}
	}

	for (const entry of repairs) {
		atoms.add(entry.foreground);
		atoms.add(entry.background);
		atoms.add(entry.measured.toFixed(2));
		atoms.add(entry.achieved.toFixed(2));
		atoms.add(toOklchCss(entry.from));
		atoms.add(toOklchCss(entry.to));
		atoms.add(String(entry.target));
	}

	return atoms;
}

const atoms = allowedAtoms();

/** Cells built from two atoms glued with a separator the generator, not the data, supplies. */
function partsOf(cell: string): string[] {
	if (cell.includes(' → ')) return cell.split(' → ');
	if (cell.includes(' / ')) return cell.split(' / ');

	return [cell];
}

describe('designDoc traceability', () => {
	it('draws every data-row cell from a string one of the three inputs actually carries', () => {
		let checked = 0;

		for (const t of tables) {
			for (const r of t.rows) {
				for (const cell of r) {
					if (cell === '') continue; // an absent seedField on an invented row

					for (const part of partsOf(cell)) {
						expect(
							atoms.has(part),
							`cell "${cell}" (part "${part}") traces to no input field`,
						).toBe(true);
						checked += 1;
					}
				}
			}
		}

		// A traceability pass that checked nothing would pass vacuously.
		expect(checked).toBeGreaterThan(0);
	});
});

/** The lines between a `## <heading>` and the next `## ` (or the document's end). */
function sectionLines(source: string, heading: string): string[] {
	const lines = source.split('\n');
	const start = lines.indexOf(`## ${heading}`);

	if (start === -1) throw new Error(`no "## ${heading}" heading in the rendered doc`);

	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => line.startsWith('## '));

	return rest.slice(0, end === -1 ? rest.length : end);
}

/**
 * The same fixture token set with `brand.9`'s rationale replaced by one carrying a literal `|`, so
 * `escapeCell` has something to prove itself against. Only `primitives.brand` changes: `colourEntries`
 * reads the top-level layer alone (see `allEntries`'s docblock in `design-doc.ts`), so the schemes
 * copies never need touching for this to reach the Key colours table.
 */
function withPipeInRationale(base: TokenSet): TokenSet {
	const brand = base.primitives.brand!;
	const target = brand[8]!; // step 9, the observed brand key colour

	const mutated = {
		...target,
		$extensions: {
			...target.$extensions,
			[CAMBIUM_NAMESPACE]: {
				...target.$extensions[CAMBIUM_NAMESPACE],
				rationale: 'Uses a pipe | character to check escaping',
			},
		},
	};

	return {
		...base,
		primitives: { ...base.primitives, brand: brand.map((step, i) => (i === 8 ? mutated : step)) },
	};
}

describe('designDoc edge cases', () => {
	it('renders an empty Measured table and no added prose when typeClassification is null', () => {
		const noType = designDoc({ tokens, seed: { ...seed, typeClassification: null }, repairs });
		const lines = sectionLines(noType, 'Type');

		for (const line of lines) {
			expect(line === '' || line.startsWith('|'), `stray prose line: "${line}"`).toBe(true);
		}

		const noTypeTables = parseTables(noType.split('\n'));
		const measured = noTypeTables.find((t) => t.headers[0] === 'Category');
		const suggested = noTypeTables.find((t) => t.headers[0] === 'Family');

		expect(measured).toBeDefined();
		expect(measured!.rows).toHaveLength(0);
		// suggestedPairing is still stated, so that table keeps its rows.
		expect(suggested!.rows.length).toBeGreaterThan(0);

		for (const t of noTypeTables) {
			for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
		}
	});

	it('renders an empty Suggested table and no added prose when suggestedPairing is null', () => {
		const noPairing = designDoc({ tokens, seed: { ...seed, suggestedPairing: null }, repairs });
		const lines = sectionLines(noPairing, 'Type');

		for (const line of lines) {
			expect(line === '' || line.startsWith('|'), `stray prose line: "${line}"`).toBe(true);
		}

		const noPairingTables = parseTables(noPairing.split('\n'));
		const measured = noPairingTables.find((t) => t.headers[0] === 'Category');
		const suggested = noPairingTables.find((t) => t.headers[0] === 'Family');

		// typeClassification is still stated, so that table keeps its row.
		expect(measured!.rows.length).toBeGreaterThan(0);
		expect(suggested).toBeDefined();
		expect(suggested!.rows).toHaveLength(0);

		for (const t of noPairingTables) {
			for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
		}
	});

	it('escapes a pipe inside a rationale and keeps the row at the header column count', () => {
		const pipeDoc = designDoc({ tokens: withPipeInRationale(tokens), seed, repairs });

		expect(pipeDoc).toContain('Uses a pipe \\| character to check escaping');

		const pipeTables = parseTables(pipeDoc.split('\n'));
		const keyColours = pipeTables.find(
			(t) => t.headers[0] === 'Token' && t.headers[1] === 'Value',
		)!;
		const row = keyColours.rows.find((r) => r[0] === 'brand.9')!;

		expect(row).toBeDefined();
		expect(row).toHaveLength(keyColours.headers.length);
		// `splitRow` unescapes `\|` back to `|`, so the round-tripped cell holds the real character.
		expect(row[3]).toBe('Uses a pipe | character to check escaping');
	});
});
