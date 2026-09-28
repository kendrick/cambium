import { describe, expect, it, vi } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from '../brand-seed';
import { repairContrast } from '../contrast/repair';
import { toOklchCss } from '../css/oklch-css';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { CAMBIUM_NAMESPACE, type TokenProvenance } from '../provenance';
import { SCHEME_NAMES, type SchemeName } from '../scale-engine';
import { buildTokenSet } from '../semantic-layer';
import { applyOverrides } from '../token-overrides';
import { TokenSetSchema, type TokenSet } from '../token-set';
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
	// Strips the leading/trailing pipe rather than splitting on `|`, so an escaped `\|` or `\\` inside
	// a cell survives the split; unescaped after, once each cell is on its own. Both escapes consume
	// exactly the backslash and the character after it, the same two-at-a-time rule a markdown reader
	// applies, so a `\\|` from `escapeCell`'s own backslash-then-pipe escaping resolves to one literal
	// `\` followed by one live `|` — never to a lone survivor from the wrong pairing.
	const inner = line.slice(1, -1);
	const cells: string[] = [];
	let current = '';

	for (let i = 0; i < inner.length; i += 1) {
		if (inner[i] === '\\' && (inner[i + 1] === '|' || inner[i + 1] === '\\')) {
			current += inner[i + 1];
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
 * categories that happen to carry one today. `design-doc.ts`'s `allEntries` still works from lists:
 * it picks colours, semantic and shadow out by name and walks `VALUE_CATEGORIES` for the rest. This
 * walk shares neither list, so a category the generator forgets to include still turns
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

	/**
	 * `brand.9` is the one ramp step `oklch-scale-engine.ts`'s `observed()` call marks straight from
	 * the seed, so a `primitive` override on dark alone (`token-overrides.ts`'s `write`, which sets
	 * l/c/h and never touches `$extensions`) leaves both schemes' claims identical while their printed
	 * values diverge. A merge keyed on the claim alone would still collapse this to one row showing
	 * only light's value, silently hiding the override this table exists to surface.
	 */
	it('splits an observed ramp step into light:/dark: rows when a per-scheme override edits its value without touching its claim', () => {
		const overridden = applyOverrides(tokens, [
			{ kind: 'primitive', scheme: 'dark', ramp: 'brand', step: 9, l: 0.7, c: 0.2, h: 330 },
		]);

		if (!overridden.ok) throw new Error(`applyOverrides rejected the repro: ${overridden.key}`);

		const overriddenDoc = designDoc({ tokens: overridden.tokenSet, seed, repairs });
		const overriddenTables = parseTables(overriddenDoc.split('\n'));
		const keyColours = overriddenTables.find(
			(t) => t.headers[0] === 'Token' && t.headers[1] === 'Value',
		)!;

		const lightRow = keyColours.rows.find((r) => r[0] === 'light:brand.9');
		const darkRow = keyColours.rows.find((r) => r[0] === 'dark:brand.9');
		const mergedRow = keyColours.rows.find((r) => r[0] === 'brand.9');

		expect(lightRow, 'no light: row for the overridden step').toBeDefined();
		expect(darkRow, 'no dark: row for the overridden step').toBeDefined();
		expect(
			mergedRow,
			'an overridden step must not collapse into one unlabeled row',
		).toBeUndefined();

		const lightStep = tokens.schemes.light.primitives.brand!.find((s) => s.step === 9)!;

		expect(lightRow![1]).toBe(toOklchCss({ l: lightStep.l, c: lightStep.c, h: lightStep.h }));
		expect(darkRow![1]).toBe(toOklchCss({ l: 0.7, c: 0.2, h: 330 }));
	});

	/**
	 * `SemanticLayerSchema` and `PrimitiveLayerSchema` are plain records (`token-set.ts`) with no
	 * cross-scheme key check, so a token only one scheme declares is schema-valid. `TokenSetSchema
	 * .safeParse` accepting this set proves that, rather than assuming it.
	 */
	it('prints a dark-only semantic token as a dark: row instead of dropping it', () => {
		const darkOnlyExtensions: TokenProvenance = {
			provenance: 'observed',
			rationale: 'Present in dark only, to prove an unpaired path still prints',
			seedField: 'keyColors',
		};

		const withDarkOnly: TokenSet = {
			...tokens,
			schemes: {
				...tokens.schemes,
				dark: {
					...tokens.schemes.dark,
					semantic: {
						...tokens.schemes.dark.semantic,
						'dark-only-token': {
							alias: 'brand.9',
							$extensions: { [CAMBIUM_NAMESPACE]: darkOnlyExtensions },
						},
					},
				},
			},
		};

		expect(TokenSetSchema.safeParse(withDarkOnly).success).toBe(true);

		const withDarkOnlyDoc = designDoc({ tokens: withDarkOnly, seed, repairs });
		const withDarkOnlyTables = parseTables(withDarkOnlyDoc.split('\n'));
		const keyColours = withDarkOnlyTables.find(
			(t) => t.headers[0] === 'Token' && t.headers[1] === 'Value',
		)!;

		const darkRow = keyColours.rows.find((r) => r[0] === 'dark:semantic.dark-only-token');
		const unlabeledRow = keyColours.rows.find((r) => r[0] === 'semantic.dark-only-token');

		expect(darkRow, 'no dark: row for the dark-only semantic token').toBeDefined();
		expect(darkRow![1]).toBe('brand.9');
		expect(darkRow![2]).toBe('keyColors');
		expect(darkRow![3]).toBe(darkOnlyExtensions.rationale);
		expect(
			unlabeledRow,
			'an unpaired dark token must not print without its scheme label',
		).toBeUndefined();
	});

	/**
	 * `xs` is a shadow, and a shadow's colour tints from the resolved page surface (`shadowEntries`'s
	 * own WHY comment in design-doc.ts), so light and dark disagree on lightness, alpha and blur on
	 * every run — the value genuinely differs, even though the row still makes the same claim in both
	 * schemes. Pinning this to the unsplit case removes the coverage test's 1/0/0-or-0/1/1 ambiguity
	 * for shadow specifically: a regression that started splitting shadow rows would still satisfy
	 * that test's "either is fine" bar, but not this one's.
	 */
	it('keeps a shadow value merged into one unlabelled row even though its value differs by scheme', () => {
		const lightXs = tokens.schemes.light.shadow.values.xs;
		const darkXs = tokens.schemes.dark.shadow.values.xs;

		// The fixture only proves this test if light and dark genuinely disagree on this shadow's
		// value; check that against the real schemes before trusting what the doc does.
		expect(lightXs.color.l).not.toBe(darkXs.color.l);
		expect(lightXs.color.alpha).not.toBe(darkXs.color.alpha);
		expect(lightXs.blur.value).not.toBe(darkXs.blur.value);

		const interpretation = tables.find(
			(t) => t.headers[0] === 'Token' && t.headers[1] === 'Seed field',
		)!;
		const unlabeledRow = interpretation.rows.find((r) => r[0] === 'shadow.values.xs');
		const lightRow = interpretation.rows.find((r) => r[0] === 'light:shadow.values.xs');
		const darkRow = interpretation.rows.find((r) => r[0] === 'dark:shadow.values.xs');

		expect(unlabeledRow, 'shadow.values.xs must print as one unlabelled row').toBeDefined();
		expect(lightRow, 'shadow.values.xs must not split despite its differing value').toBeUndefined();
		expect(darkRow, 'shadow.values.xs must not split despite its differing value').toBeUndefined();
	});

	/**
	 * The shadow row above is the concrete case; this is the doc saying so in words, for a reader who
	 * never cross-checks a row against the two schemes themselves.
	 */
	it.each(['What the interpretation produced', 'Invented tokens'])(
		'states under "%s" that an unlabelled row makes the same claim in both schemes',
		(heading) => {
			expect(sectionLines(doc, heading)).toContain(
				'A row with no `light:` or `dark:` label makes the same claim in both schemes, even where the value it resolves to differs between them.',
			);
		},
	);
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

	/**
	 * Every path in one scheme, walked straight off that scheme rather than off `walked` — `walked`
	 * skips `schemes` entirely (see `walkGeneric`'s own docblock) and only ever holds the top-level
	 * mirror, which is light's copy, so it has no entry for a dark-only path or for dark's own value
	 * where light and dark disagree. Resolving each row against its actual scheme, instead of against
	 * whichever token in the whole set happens to carry a matching string, is what makes a wrong-row
	 * mutation ((a) hard-coding a cell, (b) copying one row's field onto every row) fail here instead
	 * of passing under `allowedAtoms`'s set-membership check above.
	 */
	function schemeWalk(scheme: TokenSet['schemes']['light']): Observed[] {
		const out: Observed[] = [];

		walkGeneric(scheme, '', out);

		return out;
	}

	const byPathPerScheme: Record<SchemeName, Map<string, Observed>> = {
		light: new Map(schemeWalk(tokens.schemes.light).map((entry) => [entry.path, entry])),
		dark: new Map(schemeWalk(tokens.schemes.dark).map((entry) => [entry.path, entry])),
	};
	const plainByPath = new Map(walked.map((entry) => [entry.path, entry]));

	function rowToken(cell: string): Observed {
		const schemeMatch = SCHEME_PREFIX.exec(cell);
		const scheme = schemeMatch ? (schemeMatch[1] as SchemeName) : undefined;
		const path = schemeMatch ? schemeMatch[2]! : cell;
		const entry = (scheme ? byPathPerScheme[scheme] : plainByPath).get(path);

		if (!entry) {
			throw new Error(`traceability: no token at path "${path}" (scheme ${scheme ?? 'plain'})`);
		}

		return entry;
	}

	it("ties every provenance-derived cell to its own row's token, not to any token in the set", () => {
		// Key colours, Interpretation and Invented tokens are the three sections whose first column is
		// a token path; Type and Contrast repairs key their rows on something else (a role, a scheme)
		// and carry no per-token seed field, provenance or rationale cell to check this way.
		const tokenTables = tables.filter(
			(t) =>
				t.headers[0] === 'Token' &&
				(t.headers.includes('Seed field') || t.headers.includes('Provenance')),
		);

		expect(tokenTables.length).toBeGreaterThan(0);

		let checked = 0;

		for (const t of tokenTables) {
			// Built once per table rather than branched on per row, so every `expect` below runs
			// unconditionally over a column list already known to apply to this table.
			const columns = (
				[
					['Seed field', (e: Observed) => e.extensions.seedField],
					['Provenance', (e: Observed) => e.extensions.provenance],
					['Rationale', (e: Observed) => e.extensions.rationale],
				] as const
			)
				.map(([name, expected]) => ({ index: t.headers.indexOf(name), name, expected }))
				.filter((column) => column.index !== -1);

			for (const r of t.rows) {
				const entry = rowToken(r[0]!);

				for (const column of columns) {
					expect(r[column.index], `row "${r[0]}" ${column.name}`).toBe(column.expected(entry));
					checked += 1;
				}
			}
		}

		// A per-row pass that checked nothing would pass vacuously, same as the set-membership pass above.
		expect(checked).toBeGreaterThan(0);
	});

	/**
	 * The Suggested table's first column is a role, not a token path, so `tokenTables` above never
	 * picks it up and the set-membership check has the last word on it: "Geo Sans" and 92 are real
	 * atoms no matter which role's row prints them, so a bug that mapped every role to
	 * `seed.suggestedPairing.display` would still pass that check. Looking a row's own role up in
	 * `seed.suggestedPairing` and matching on family, the way `typeSection`'s own `flatMap` does,
	 * closes that gap the same way `rowToken` closes it for the Token-keyed tables above.
	 */
	it('ties every Suggested row to a candidate its own role actually holds', () => {
		const suggested = tables.find((t) => t.headers[0] === 'Family')!;

		expect(suggested.rows.length).toBeGreaterThan(0);

		for (const row of suggested.rows) {
			const [family, role, scoreCell] = row;
			const candidates = seed.suggestedPairing![role as (typeof PAIRING_ROLES)[number]];
			const candidate = candidates.find((c) => c.family === family);

			expect(candidate, `no "${role}" candidate named "${family}"`).toBeDefined();
			expect(scoreCell).toBe(candidate!.score === null ? 'no score' : String(candidate!.score));
		}
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

	/**
	 * CodeQL js/incomplete-sanitization on #167: `escapeCell` escaped `|` without first escaping a
	 * pre-existing `\`, so a rationale already containing `\|` printed as `\\|` — an escaped backslash
	 * (consumed as one unit) followed by a live, unescaped pipe. Built by concatenation rather than as
	 * one string literal, so the real backslash sits immediately before the real pipe with nothing
	 * between them for a human transcribing the literal to lose.
	 */
	it('escapes a backslash-then-pipe pair and round-trips it back through the table parser unchanged', () => {
		const rationale = [
			'Has a backslash',
			'\\',
			'| pair right next to each other, to check escaping',
		].join('');
		const pipeAndBackslashDoc = designDoc({
			tokens: withRationale(tokens, 'brand', 9, rationale),
			seed,
			repairs,
		});

		const tablesWithPipeAndBackslash = parseTables(pipeAndBackslashDoc.split('\n'));
		const keyColours = tablesWithPipeAndBackslash.find(
			(t) => t.headers[0] === 'Token' && t.headers[1] === 'Value',
		)!;
		const row = keyColours.rows.find((r) => r[0] === 'brand.9')!;

		expect(row).toBeDefined();
		// The header column count staying put is the direct evidence: a live, unescaped pipe from the
		// old bug would have reopened the row and pushed every later cell one column further along.
		expect(row).toHaveLength(keyColours.headers.length);
		// The table parser is this test's stand-in for a markdown reader; what it recovers from the
		// row is what a real one would render, not what escapeCell happened to write to the string.
		expect(row[3]).toBe(rationale);
	});
});
