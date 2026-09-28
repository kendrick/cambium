import type { BrandSeed } from '../brand-seed';
import type { RepairEntry } from '../contrast/repair';
import { toOklchCss } from '../css/oklch-css';
import { CAMBIUM_NAMESPACE, type TokenProvenance } from '../provenance';
import { RAMP_NAMES, type SchemeName } from '../scale-engine';
import { VALUE_CATEGORIES } from '../token-overrides';
import type { ColorScheme, TokenSet } from '../token-set';

export type DesignDocInput = {
	tokens: TokenSet;
	seed: BrandSeed;
	repairs: readonly RepairEntry[];
};

/**
 * A token's dotted path alongside the one payload every claim in the doc has to trace to. `scheme`
 * is set only once a light/dark pair has turned out to disagree (see `mergeSchemes`): an entry still
 * shared between the two schemes carries no scheme of its own, because it isn't one scheme's claim.
 */
type TokenEntry = { path: string; extensions: TokenProvenance; scheme?: SchemeName };

/**
 * The same entry, plus a value: a primitive ramp step's CSS colour, or a semantic alias's target
 * (`ramp.step`, the same spelling the alias field itself uses). Both answer the same reader
 * question — "what does this token actually resolve to" — so one field serves both.
 */
type ColourEntry = TokenEntry & { value: string };

/**
 * Two characters would otherwise break a table row: an unescaped `|` reopens it mid-cell, and a raw
 * newline turns the rest of a cell into a line with no leading `|`, which a table parser reads as
 * broken structure rather than as part of the row. Both go to their two-character backslash form.
 * `RationaleSchema` bounds a rationale to one sentence, so a raw `\n` reaching here would itself be a
 * data bug worth surfacing as literal `\n` text rather than silently reformatting.
 */
function escapeCell(text: string): string {
	return text.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '\\n');
}

function row(cells: readonly string[]): string {
	return `| ${cells.map(escapeCell).join(' | ')} |`;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
	return [row(headers), row(headers.map(() => '---')), ...rows.map(row)];
}

export function extensionsOf(holder: {
	$extensions: { [CAMBIUM_NAMESPACE]: TokenProvenance };
}): TokenProvenance {
	return holder.$extensions[CAMBIUM_NAMESPACE];
}

/** The path a row prints, scheme-qualified the way `contrast/repair.ts`'s `PinKey` already spells one. */
function entryPath(entry: TokenEntry): string {
	return entry.scheme ? `${entry.scheme}:${entry.path}` : entry.path;
}

/**
 * Whether two payloads make the same claim: same provenance, same seed field, same rationale. Never
 * the raw colour value, because a light and a dark ramp step curve to genuinely different lightness
 * at every step but for one (`oklch-scale-engine.ts`'s `buildRamp` runs `BRAND_STEP` through
 * `fitToSrgbGamut(anchor)` alone, with no scheme-dependent term, so an *observed* step's value is
 * provably identical across schemes whenever its claim is) — and the claim, not the byte, is what a
 * reader of this doc is being told. Comparing on the claim means a curved step whose wording doesn't
 * mention the scheme collapses to one row, while a semantic alias that resolves to a different step
 * per scheme (this fixture's `primary-foreground`, `sidebar-primary-foreground`) still splits.
 */
function sameClaim(a: TokenProvenance, b: TokenProvenance): boolean {
	return (
		a.provenance === b.provenance && a.seedField === b.seedField && a.rationale === b.rationale
	);
}

/**
 * One list, in light's own order: each of light's entries either matches its counterpart at the same
 * path in dark, in which case it prints once, or the two rows print separately, each tagged with its
 * scheme. A path dark doesn't carry is dropped instead of printed unpaired, since `TokenSetSchema`
 * requires both schemes to declare the same primitive, semantic and shadow keys.
 */
function mergeSchemes<T extends TokenEntry>(light: readonly T[], dark: readonly T[]): T[] {
	const darkByPath = new Map(dark.map((entry) => [entry.path, entry]));
	const merged: T[] = [];

	for (const entry of light) {
		const counterpart = darkByPath.get(entry.path);

		if (counterpart && sameClaim(entry.extensions, counterpart.extensions)) {
			merged.push(entry);
			continue;
		}

		merged.push({ ...entry, scheme: 'light' });
		if (counterpart) merged.push({ ...counterpart, scheme: 'dark' });
	}

	return merged;
}

/** Every step of every primitive ramp in one scheme, in `RAMP_NAMES` then step order. */
function colourEntriesFor(primitives: ColorScheme['primitives']): ColourEntry[] {
	const entries: ColourEntry[] = [];

	for (const ramp of RAMP_NAMES) {
		const steps = primitives[ramp];

		if (!steps) continue;

		for (const step of steps) {
			entries.push({
				path: `${ramp}.${step.step}`,
				value: toOklchCss({ l: step.l, c: step.c, h: step.h }),
				extensions: extensionsOf(step),
			});
		}
	}

	return entries;
}

function colourEntries(tokens: TokenSet): ColourEntry[] {
	return mergeSchemes(
		colourEntriesFor(tokens.schemes.light.primitives),
		colourEntriesFor(tokens.schemes.dark.primitives),
	);
}

/** Every semantic alias in one scheme, `entry.alias` (`ramp.step`) doubling as its printable value. */
function semanticEntriesFor(semantic: ColorScheme['semantic']): ColourEntry[] {
	return Object.entries(semantic).map(([token, entry]) => ({
		path: `semantic.${token}`,
		value: entry.alias,
		extensions: extensionsOf(entry),
	}));
}

function semanticEntries(tokens: TokenSet): ColourEntry[] {
	return mergeSchemes(
		semanticEntriesFor(tokens.schemes.light.semantic),
		semanticEntriesFor(tokens.schemes.dark.semantic),
	);
}

function recordEntries(
	prefix: string,
	values: Record<string, { $extensions: { [CAMBIUM_NAMESPACE]: TokenProvenance } }>,
): TokenEntry[] {
	return Object.entries(values).map(([key, value]) => ({
		path: `${prefix}.${key}`,
		extensions: extensionsOf(value),
	}));
}

function shadowEntries(tokens: TokenSet): TokenEntry[] {
	return mergeSchemes(
		recordEntries('shadow.values', tokens.schemes.light.shadow.values),
		recordEntries('shadow.values', tokens.schemes.dark.shadow.values),
	);
}

/** The one shape `valueEntries`' walk bottoms out on; anything else found along the way is nesting. */
function isValueHolder(
	node: unknown,
): node is { $extensions: { [CAMBIUM_NAMESPACE]: TokenProvenance } } {
	if (typeof node !== 'object' || node === null || !Object.hasOwn(node, '$extensions'))
		return false;

	const extensions = (node as { $extensions: unknown }).$extensions;

	return typeof extensions === 'object' && extensions !== null && CAMBIUM_NAMESPACE in extensions;
}

function walkValues(node: unknown, path: string, out: TokenEntry[]): void {
	if (isValueHolder(node)) {
		out.push({ path, extensions: extensionsOf(node) });
		return;
	}

	if (typeof node === 'object' && node !== null) {
		for (const [key, value] of Object.entries(node)) walkValues(value, `${path}.${key}`, out);
	}
}

/**
 * `VALUE_CATEGORIES`'s eight names (`token-overrides.ts`) cover four shapes: a flat record, one
 * further level of nesting under a fixed key (`typography`'s `size`/`weight`/`lineHeight`,
 * `motion`'s `duration`/`easing`), and two named fields rather than a record at all (`focusRing`).
 * Walking generically by node kind — plain object versus `$extensions` holder — covers all four
 * without branching on which category is which, the same way `design-doc.test.ts`'s own
 * `walkGeneric` already covers the whole token set to check this function's output independently.
 */
function valueEntries(tokens: TokenSet): TokenEntry[] {
	const entries: TokenEntry[] = [];

	for (const category of VALUE_CATEGORIES) {
		walkValues(tokens[category].values, `${category}.values`, entries);
	}

	return entries;
}

/**
 * Every token in the set. `primitives`, `semantic` and `shadow` are the three categories
 * `SCHEME_SHAPE` (`token-set.ts`) makes per-scheme, so each is walked in both `schemes.light` and
 * `schemes.dark` and merged by `mergeSchemes`. The other eight categories (`VALUE_CATEGORIES`) live
 * at the top level only — nothing in the seed or the engine varies them by scheme — so `valueEntries`
 * walks each one's `.values` tree generically instead of reading it once by name.
 */
function allEntries(
	tokens: TokenSet,
	colours: readonly ColourEntry[],
	semantic: readonly ColourEntry[],
): TokenEntry[] {
	return [...colours, ...semantic, ...shadowEntries(tokens), ...valueEntries(tokens)];
}

/**
 * Sorted on a copy: every call site here sorts a `map`/`filter` result, never a caller's own array,
 * so the mutation `Array#sort` performs is invisible outside this function. `Array#toSorted` would
 * make that true by construction instead of by convention, but it's ES2023 and this repo's tsconfig
 * targets ES2022 (the trade `core/dtcg/report.ts` also makes), so the lint rule aimed at exactly this
 * mutation is disabled once, here, rather than at each of this file's two call sites.
 */
function sortedByKeys<T>(items: readonly T[], keysOf: (item: T) => readonly string[]): T[] {
	// oxlint-disable-next-line unicorn/no-array-sort
	return [...items].sort((a, b) => {
		const [aKeys, bKeys] = [keysOf(a), keysOf(b)];

		for (let i = 0; i < aKeys.length; i += 1) {
			const compared = aKeys[i]!.localeCompare(bKeys[i]!);

			if (compared !== 0) return compared;
		}

		return 0;
	});
}

/**
 * `observed`'s and `derived`'s `seedField` is a non-null `SeedField` (`TokenProvenanceSchema`);
 * `invented`'s alone is null. A filter above already excludes `invented`, so the field is never
 * actually missing here — asserted with `!` instead of read past. Only if this file's filters ever
 * stop discriminating on `provenance` first would a real `null` reach the cast, and that would be a
 * bug in the filter, not something a fallback like `?? ''` should paper over with a blank cell no
 * reader could distinguish from a row that really had nothing to say.
 */
function seedFieldOf(extensions: TokenProvenance): string {
	return extensions.seedField!;
}

function keyColourSection(
	colours: readonly ColourEntry[],
	semantic: readonly ColourEntry[],
): string[] {
	const toRow = (entry: ColourEntry) => [
		entryPath(entry),
		entry.value,
		seedFieldOf(entry.extensions),
		entry.extensions.rationale,
	];

	const rampRows = colours.filter((entry) => entry.extensions.provenance === 'observed').map(toRow);

	// An observed semantic alias (this fixture's `primary`, `sidebar-primary`) inherits its
	// provenance straight from the ramp step it names (`semantic-layer.ts`'s `inherit`), so it is as
	// much an observed key colour as that step is — the alias itself is the "value" a reader checks
	// against the seed, the way a ramp step's own OKLCH channels are.
	const aliasRows = sortedByKeys(
		semantic.filter((entry) => entry.extensions.provenance === 'observed'),
		(entry) => [entryPath(entry)],
	).map(toRow);

	return [
		'## Key colours',
		'',
		...table(['Token', 'Value', 'Seed field', 'Rationale'], [...rampRows, ...aliasRows]),
	];
}

function interpretationSection(entries: readonly TokenEntry[]): string[] {
	const rows = sortedByKeys(
		entries.filter((entry) => entry.extensions.provenance === 'derived'),
		(entry) => [seedFieldOf(entry.extensions), entryPath(entry)],
	).map((entry) => [entryPath(entry), seedFieldOf(entry.extensions), entry.extensions.rationale]);

	return [
		'## What the interpretation produced',
		'',
		...table(['Token', 'Seed field', 'Rationale'], rows),
	];
}

/**
 * The Provenance column here only ever reads "invented", which looks redundant next to a heading
 * that already says so. It stays because the acceptance criterion it satisfies is per-row, not
 * per-section: "every invented token's path appears on a line containing 'invented'" has to hold for
 * a reader (or a test) looking at one row in isolation, and the section heading is not on that row.
 */
function inventedSection(entries: readonly TokenEntry[]): string[] {
	const rows = sortedByKeys(
		entries.filter((entry) => entry.extensions.provenance === 'invented'),
		(entry) => [entryPath(entry)],
	).map((entry) => [entryPath(entry), entry.extensions.provenance, entry.extensions.rationale]);

	return ['## Invented tokens', '', ...table(['Token', 'Provenance', 'Rationale'], rows)];
}

/** `SuggestedPairingSchema`'s three roles, in the order the schema declares them. */
const PAIRING_ROLES = ['display', 'body', 'mono'] as const;

/**
 * A stated ratio with no classification is still a measured scale (criterion 4 asks the doc to say
 * so), so the row prints whenever either half is present, each missing half saying it's missing
 * rather than the whole row vanishing because one field came back empty.
 */
function typeSection(seed: BrandSeed): string[] {
	const measured =
		seed.typeClassification || seed.typeScaleRatio !== null
			? [
					[
						seed.typeClassification?.category ?? 'not classified',
						seed.typeClassification?.tone ?? 'not classified',
						seed.typeClassification?.xHeight ?? 'not classified',
						seed.typeScaleRatio === null ? 'no ratio' : String(seed.typeScaleRatio),
					],
				]
			: [];

	const suggestedRows = seed.suggestedPairing
		? PAIRING_ROLES.flatMap((role) =>
				seed.suggestedPairing![role].map((candidate) => [
					candidate.family,
					role,
					candidate.score === null ? 'no score' : String(candidate.score),
				]),
			)
		: [];

	return [
		'## Type',
		'',
		'**Measured**',
		'',
		...table(['Category', 'Tone', 'X-height', 'Type scale ratio'], measured),
		'',
		'**Suggested**',
		'',
		...table(['Family', 'Role', 'Score'], suggestedRows),
	];
}

function repairsSection(repairs: readonly RepairEntry[]): string[] {
	if (repairs.length === 0) return ['## Contrast repairs', '', 'No repairs were applied.'];

	const rows = repairs.map((entry) => [
		entry.scheme,
		`${entry.foreground} / ${entry.background}`,
		`${entry.ramp}.${entry.step}`,
		`${entry.measured.toFixed(2)} → ${entry.achieved.toFixed(2)}`,
		`${toOklchCss(entry.from)} → ${toOklchCss(entry.to)}`,
		String(entry.target),
	]);

	return [
		'## Contrast repairs',
		'',
		...table(['Scheme', 'Pair', 'Moved token', 'Measured → Achieved', 'From → To', 'Target'], rows),
	];
}

/**
 * A pure function of a token set, its seed, and the contrast repairs run against it: the same three
 * inputs a caller already has in hand once #15 wires this in, so the doc never reaches past them for
 * a fact it could instead cite.
 *
 * Every section reads straight off one of the three inputs. Where a value has no seed field to
 * name — a system constant, an invented candidate — the doc says so in the row itself (the
 * Provenance or Score cell) rather than omitting the row, since "nothing observed this" is itself a
 * claim the payload carries.
 */
export function designDoc({ tokens, seed, repairs }: DesignDocInput): string {
	const colours = colourEntries(tokens);
	const semantic = semanticEntries(tokens);
	const entries = allEntries(tokens, colours, semantic);

	return (
		[
			'# Design doc',
			'',
			...keyColourSection(colours, semantic),
			'',
			...interpretationSection(entries),
			'',
			...inventedSection(entries),
			'',
			...typeSection(seed),
			'',
			...repairsSection(repairs),
		].join('\n') + '\n'
	);
}
