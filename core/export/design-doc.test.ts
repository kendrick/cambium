import { describe, expect, it, vi } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from '../brand-seed';
import { repairContrast } from '../contrast/repair';
import { toOklchCss } from '../css/oklch-css';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { CAMBIUM_NAMESPACE, type TokenProvenance } from '../provenance';
import { SCHEME_NAMES } from '../scale-engine';
import { buildTokenSet } from '../semantic-layer';
import type { TokenSet } from '../token-set';
import { designDoc, extensionsOf } from './design-doc';

/**
 * Two key colours, both character fields, a full type classification and a ranked pairing, built
 * the way every other fixture in `core/` is: a literal `BrandSeedSchema.parse` with each of the
 * eleven fields spelled out. No seed literal in this repo's test suite combines two key colours with
 * a stated `typeClassification` (`provenance.test.ts`'s `STATED_SEED` has two key colours and no
 * type classification; `rank-fonts.test.ts`'s classified seeds carry no second key colour), so this
 * fixture is its own rather than an import.
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

/** `SuggestedPairingSchema`'s three roles, in the order the schema declares them. */
const PAIRING_ROLES = ['display', 'body', 'mono'] as const;

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
	it('is non-empty and ends with a trailing newline', () => {
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

/** One `$extensions` payload this walk found, at the path it found it, plus a colour if it had one. */
type Observed = { path: string; extensions: TokenProvenance; value?: string };

function isCambiumHolder(
	node: unknown,
): node is { $extensions: { [CAMBIUM_NAMESPACE]: TokenProvenance } } {
	if (typeof node !== 'object' || node === null || !Object.hasOwn(node, '$extensions'))
		return false;

	const extensions = (node as { $extensions: unknown }).$extensions;

	return typeof extensions === 'object' && extensions !== null && CAMBIUM_NAMESPACE in extensions;
}

/** A primitive ramp step is the one `$extensions` holder that also carries its own OKLCH channels. */
function colourValueOf(node: Record<string, unknown>): string | undefined {
	const { l, c, h } = node;

	return typeof l === 'number' && typeof c === 'number' && typeof h === 'number'
		? toOklchCss({ l, c, h })
		: undefined;
}

/**
 * Walks the whole top-level `TokenSet` for `$extensions` payloads, rather than naming the nine
 * categories that happen to carry one today. `design-doc.ts`'s `allEntries` names them one by one
 * because the doc's section order depends on telling them apart; this walk doesn't need to, so it
 * doesn't hold a second copy of that list. A category the generator forgets to include still turns
 * up here, so a coverage or traceability test built on this catches the omission — with a hard-coded
 * list on both sides, one bug in the list would have been invisible to both.
 *
 * `schemes` is skipped on purpose: the top level already mirrors `schemes.light`
 * (`checkMirroredLayers`, `token-set.ts`), so walking it too would double every light-scheme entry,
 * and the behaviour that actually depends on both schemes — a path where light and dark disagree —
 * is checked directly against `tokens.schemes.light` / `tokens.schemes.dark` in the "scheme
 * handling" tests below, not through this walk.
 *
 * Path segments follow the real property path, with one exception: `primitives` contributes no
 * segment of its own, so a ramp step's path reads `brand.9` rather than `primitives.brand.9`,
 * matching the `ramp.step` alias spelling `semantic-map.ts` already uses everywhere else. An array
 * index becomes a 1-based segment, which for a primitive ramp is exactly its `step` number
 * (`RampSchema` pins a ramp to steps 1 through 12, each exactly once, in order).
 */
function walkGeneric(node: unknown, path: string, out: Observed[]): void {
	if (isCambiumHolder(node)) {
		out.push({ path, extensions: extensionsOf(node), value: colourValueOf(node) });
		return;
	}

	if (Array.isArray(node)) {
		node.forEach((item, index) => walkGeneric(item, `${path}.${index + 1}`, out));
		return;
	}

	if (node !== null && typeof node === 'object') {
		for (const [key, value] of Object.entries(node)) {
			if (key === 'schemes') continue;

			const nextPath = key === 'primitives' ? path : path ? `${path}.${key}` : key;

			walkGeneric(value, nextPath, out);
		}
	}
}

function independentWalk(set: TokenSet): Observed[] {
	const out: Observed[] = [];

	walkGeneric(set, '', out);

	return out;
}

const walked = independentWalk(tokens);
/**
 * Every observed payload the walk finds, ramp step or semantic alias alike: `semantic.primary` and
 * `semantic.sidebar-primary` inherit `observed` from the `brand.9` they alias
 * (`semantic-layer.ts`'s `inherit`), and the Key colours section prints both kinds now
 * (`design-doc.ts`'s `keyColourSection`, given `semanticEntries` alongside `colourEntries`). Scoping
 * this to entries with a colour `value` (as an earlier pass did) silently excluded the alias rows,
 * which is exactly the gap that went unnoticed until an exact-cell check was run over the two
 * separately instead of assuming the first sufficed.
 */
const observedTokens = walked.filter((e) => e.extensions.provenance === 'observed');
const inventedTokens = walked.filter((e) => e.extensions.provenance === 'invented');

describe('designDoc coverage', () => {
	it('names every observed token exactly, with the seed field it came from, in the Key colours table', () => {
		const keyColours = tables.find((t) => t.headers[0] === 'Token' && t.headers[1] === 'Value')!;

		expect(observedTokens.length).toBeGreaterThan(0);

		for (const entry of observedTokens) {
			const row = keyColours.rows.find(
				(r) => r[0] === entry.path || r[0] === `light:${entry.path}`,
			);

			expect(row, `no exact row for "${entry.path}"`).toBeDefined();
			expect(row![2]).toBe(entry.extensions.seedField);
		}
	});

	it('marks every invented token exactly, on a row whose Provenance cell says invented', () => {
		const invented = tables.find((t) => t.headers[0] === 'Token' && t.headers[1] === 'Provenance')!;

		expect(inventedTokens.length).toBeGreaterThan(0);

		for (const entry of inventedTokens) {
			const row = invented.rows.find((r) => r[0] === entry.path || r[0] === `light:${entry.path}`);

			expect(row, `no exact row for "${entry.path}"`).toBeDefined();
			expect(row![1]).toBe('invented');
		}
	});

	it('prints the exact before/after ratio pair for every repair', () => {
		const repairsTable = tables.find((t) => t.headers[0] === 'Scheme')!;
		const ratioCells = repairsTable.rows.map((r) => r[3]);

		for (const entry of repairs) {
			expect(ratioCells).toContain(`${entry.measured.toFixed(2)} → ${entry.achieved.toFixed(2)}`);
		}
	});

	/**
	 * `walkGeneric`'s docblock claims a category the generator forgets still turns up here, so a
	 * coverage test built on it catches the omission. No test actually did that for derived tokens
	 * until now: a category dropped from `allEntries` (`shadowEntries`, any one `recordEntries` call)
	 * left the suite green, because the three tables above are each checked against their own
	 * filtered slice, and a path missing from every slice at once was never cross-checked against the
	 * full walk. This closes that gap by checking every walked path against every table row at once.
	 */
	it('places every path walkGeneric finds in exactly one row of the document, or its light/dark split pair', () => {
		const allRows = tables.flatMap((t) => t.rows);

		for (const entry of walked) {
			const plain = allRows.filter((r) => r[0] === entry.path).length;
			const light = allRows.filter((r) => r[0] === `light:${entry.path}`).length;
			const dark = allRows.filter((r) => r[0] === `dark:${entry.path}`).length;

			// Printed once, unsplit (1/0/0), or split into exactly a light/dark pair (0/1/1). A
			// dropped category leaves all three at zero; anything else is a stray duplicate.
			const isUnsplit = plain === 1 && light === 0 && dark === 0;
			const isSplitPair = plain === 0 && light === 1 && dark === 1;

			expect(
				isUnsplit || isSplitPair,
				`"${entry.path}" appears plain=${plain} light=${light} dark=${dark}, want 1/0/0 or 0/1/1`,
			).toBe(true);
		}
	});
});

describe('designDoc scheme handling', () => {
	it('keeps a semantic alias that differs between schemes split and labeled, and collapses one that does not', () => {
		const lightPrimaryFg = extensionsOf(tokens.schemes.light.semantic['primary-foreground']!);
		const darkPrimaryFg = extensionsOf(tokens.schemes.dark.semantic['primary-foreground']!);
		const lightRing = extensionsOf(tokens.schemes.light.semantic.ring!);
		const darkRing = extensionsOf(tokens.schemes.dark.semantic.ring!);

		// The fixture only proves this test if light and dark genuinely disagree on one alias and
		// agree on another; check that against the real schemes before trusting what the doc does.
		expect(lightPrimaryFg.rationale).not.toBe(darkPrimaryFg.rationale);
		expect(lightRing.rationale).toBe(darkRing.rationale);

		const interpretation = tables.find(
			(t) => t.headers[0] === 'Token' && t.headers[1] === 'Seed field',
		)!;
		const lightRow = interpretation.rows.find((r) => r[0] === 'light:semantic.primary-foreground');
		const darkRow = interpretation.rows.find((r) => r[0] === 'dark:semantic.primary-foreground');
		const ambiguousRow = interpretation.rows.find((r) => r[0] === 'semantic.primary-foreground');
		const ringRow = interpretation.rows.find((r) => r[0] === 'semantic.ring');

		expect(lightRow, 'no light: row for primary-foreground').toBeDefined();
		expect(darkRow, 'no dark: row for primary-foreground').toBeDefined();
		expect(lightRow![2]).toBe(lightPrimaryFg.rationale);
		expect(darkRow![2]).toBe(darkPrimaryFg.rationale);
		// An unlabeled row here would tell a reader nothing about which scheme it describes.
		expect(ambiguousRow, 'primary-foreground printed without a scheme label').toBeUndefined();
		expect(ringRow, 'ring, which agrees across schemes, printed unnecessarily split').toBeDefined();
		expect(ringRow![2]).toBe(lightRing.rationale);
	});
});

describe('designDoc repairs', () => {
	it("names each repair row's scheme and the moved ramp.step token beside its ratios", () => {
		const repairsTable = tables.find((t) => t.headers[0] === 'Scheme')!;

		expect(repairsTable.rows).toHaveLength(repairs.length);

		for (const entry of repairs) {
			const row = repairsTable.rows.find(
				(r) => r[0] === entry.scheme && r[2] === `${entry.ramp}.${entry.step}`,
			);

			expect(row, `no row for ${entry.scheme} ${entry.ramp}.${entry.step}`).toBeDefined();
			expect(row![1]).toBe(`${entry.foreground} / ${entry.background}`);
			expect(row![3]).toBe(`${entry.measured.toFixed(2)} → ${entry.achieved.toFixed(2)}`);
			expect(row![4]).toBe(`${toOklchCss(entry.from)} → ${toOklchCss(entry.to)}`);
			expect(row![5]).toBe(String(entry.target));
		}
	});
});

describe('designDoc type section', () => {
	it("labels the Measured and Suggested tables and shows the seed's typeScaleRatio", () => {
		expect(docLines).toContain('**Measured**');
		expect(docLines).toContain('**Suggested**');

		const measured = tables.find((t) => t.headers[0] === 'Category')!;

		expect(measured.rows[0]?.[3]).toBe(String(seed.typeScaleRatio));
	});

	it('shows an empty-ratio state when typeScaleRatio is null but typeClassification is stated', () => {
		const noRatioDoc = designDoc({ tokens, seed: { ...seed, typeScaleRatio: null }, repairs });
		const noRatioTables = parseTables(noRatioDoc.split('\n'));
		const measured = noRatioTables.find((t) => t.headers[0] === 'Category')!;

		expect(measured.rows[0]?.[3]).toBe('no ratio');
	});
});

/**
 * The universe of strings a table cell is allowed to be built from: every rationale, every path
 * component, every seed field name, every provenance value, every scheme name, every formatted
 * number the three inputs actually carry. A cell outside this set is a free-form assertion the plan
 * forbids.
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

	// Scheme-qualified rows glue one of these onto a path with `:` (see `partsOf`); both are real
	// `SchemeName` values. The dark half of a split semantic alias isn't in `walked` (that walk
	// skips `schemes` on purpose), so its rationale and seed field are added here instead, read
	// straight off `tokens.schemes.dark`.
	for (const scheme of SCHEME_NAMES) atoms.add(scheme);

	for (const entry of Object.values(tokens.schemes.dark.semantic)) {
		const extensions = extensionsOf(entry);

		atoms.add(extensions.rationale);
		if (extensions.seedField) atoms.add(extensions.seedField);
	}

	if (seed.typeClassification) {
		atoms.add(seed.typeClassification.category);
		atoms.add(seed.typeClassification.tone);
		atoms.add(seed.typeClassification.xHeight);
	}

	atoms.add(seed.typeScaleRatio === null ? 'no ratio' : String(seed.typeScaleRatio));

	if (seed.suggestedPairing) {
		for (const role of PAIRING_ROLES) {
			atoms.add(role);
			for (const candidate of seed.suggestedPairing[role]) {
				atoms.add(candidate.family);
				atoms.add(candidate.score === null ? 'no score' : String(candidate.score));
			}
		}
	}

	for (const entry of repairs) {
		atoms.add(entry.scheme);
		atoms.add(entry.foreground);
		atoms.add(entry.background);
		atoms.add(`${entry.ramp}.${entry.step}`);
		atoms.add(entry.measured.toFixed(2));
		atoms.add(entry.achieved.toFixed(2));
		atoms.add(toOklchCss(entry.from));
		atoms.add(toOklchCss(entry.to));
		atoms.add(String(entry.target));
	}

	return atoms;
}

const atoms = allowedAtoms();
const SCHEME_PREFIX = new RegExp(`^(${SCHEME_NAMES.join('|')}):(.+)$`);

/** Cells built from two atoms glued with a separator the generator, not the data, supplies. */
function partsOf(cell: string): string[] {
	if (cell.includes(' → ')) return cell.split(' → ');
	if (cell.includes(' / ')) return cell.split(' / ');

	const schemeMatch = SCHEME_PREFIX.exec(cell);

	if (schemeMatch) return [schemeMatch[1]!, schemeMatch[2]!];

	return [cell];
}

describe('designDoc traceability', () => {
	it('draws every data-row cell from a string one of the three inputs actually carries', () => {
		let checked = 0;

		for (const t of tables) {
			for (const r of t.rows) {
				for (const cell of r) {
					// `seedFieldOf` (design-doc.ts) asserts a seed field for every row these tables
					// can produce, so a blank cell would mean that assertion stopped holding.
					expect(cell).not.toBe('');

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
 * The fixture token set with one primitive step's rationale replaced, so `escapeCell` has something
 * to prove itself against. Only the two schemes' copies of `primitives` change: `colourEntries`
 * (`design-doc.ts`) reads `tokens.schemes.light`/`.dark` directly, not the top-level mirror, and both
 * copies get the same new rationale so the row stays merged (unprefixed) rather than exercising the
 * scheme-split behaviour the "scheme handling" tests above already cover on their own.
 */
function withRationale(base: TokenSet, ramp: string, step: number, rationale: string): TokenSet {
	const replaceStep = (steps: TokenSet['primitives'][string]) =>
		steps!.map((s) =>
			s.step === step
				? {
						...s,
						$extensions: {
							...s.$extensions,
							[CAMBIUM_NAMESPACE]: { ...s.$extensions[CAMBIUM_NAMESPACE], rationale },
						},
					}
				: s,
		);

	return {
		...base,
		schemes: {
			light: {
				...base.schemes.light,
				primitives: {
					...base.schemes.light.primitives,
					[ramp]: replaceStep(base.schemes.light.primitives[ramp]),
				},
			},
			dark: {
				...base.schemes.dark,
				primitives: {
					...base.schemes.dark.primitives,
					[ramp]: replaceStep(base.schemes.dark.primitives[ramp]),
				},
			},
		},
	};
}

describe('designDoc edge cases', () => {
	it('keeps the Measured row, labelled "not classified", when only typeClassification is null', () => {
		// A stated ratio with no classification is still a measured scale, so the row must survive —
		// this is the scenario criterion 4 names, not the true-empty case covered separately below.
		const noClass = designDoc({ tokens, seed: { ...seed, typeClassification: null }, repairs });
		const lines = sectionLines(noClass, 'Type');

		for (const line of lines) {
			expect(
				line === '' || line.startsWith('|') || line === '**Measured**' || line === '**Suggested**',
				`stray prose line: "${line}"`,
			).toBe(true);
		}

		const noClassTables = parseTables(noClass.split('\n'));
		const measured = noClassTables.find((t) => t.headers[0] === 'Category');
		const suggested = noClassTables.find((t) => t.headers[0] === 'Family');

		expect(measured!.rows).toEqual([
			['not classified', 'not classified', 'not classified', String(seed.typeScaleRatio)],
		]);
		// suggestedPairing is still stated, so that table keeps its rows.
		expect(suggested!.rows.length).toBeGreaterThan(0);

		for (const t of noClassTables) {
			for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
		}
	});

	it('renders an empty Measured table only when neither typeClassification nor typeScaleRatio is stated', () => {
		const noMeasurement = designDoc({
			tokens,
			seed: { ...seed, typeClassification: null, typeScaleRatio: null },
			repairs,
		});
		const measured = parseTables(noMeasurement.split('\n')).find(
			(t) => t.headers[0] === 'Category',
		);

		expect(measured).toBeDefined();
		expect(measured!.rows).toHaveLength(0);
	});

	it('renders an empty Suggested table and no added prose when suggestedPairing is null', () => {
		const noPairing = designDoc({ tokens, seed: { ...seed, suggestedPairing: null }, repairs });
		const lines = sectionLines(noPairing, 'Type');

		for (const line of lines) {
			expect(
				line === '' || line.startsWith('|') || line === '**Measured**' || line === '**Suggested**',
				`stray prose line: "${line}"`,
			).toBe(true);
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
		const pipeDoc = designDoc({
			tokens: withRationale(tokens, 'brand', 9, 'Uses a pipe | character to check escaping'),
			seed,
			repairs,
		});

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

	it('escapes a newline inside a rationale and keeps the row at the header column count', () => {
		const newlineDoc = designDoc({
			tokens: withRationale(tokens, 'brand', 9, 'Has a line\nbreak to check escaping'),
			seed,
			repairs,
		});

		expect(newlineDoc).toContain('Has a line\\nbreak to check escaping');
		// The raw newline must not survive: a real one would turn the rest of the cell into a
		// second, headerless line.
		expect(newlineDoc).not.toContain('Has a line\nbreak');

		const newlineTables = parseTables(newlineDoc.split('\n'));
		const keyColours = newlineTables.find(
			(t) => t.headers[0] === 'Token' && t.headers[1] === 'Value',
		)!;
		const row = keyColours.rows.find((r) => r[0] === 'brand.9')!;

		expect(row).toBeDefined();
		expect(row).toHaveLength(keyColours.headers.length);
	});
});
