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
 * Three things would otherwise break a table row or mangle it silently: an unescaped `|` reopens it
 * mid-cell, a raw newline turns the rest of a cell into a line with no leading `|`, and a raw `\`
 * left untouched pairs up with the backslash this function inserts ahead of a `|`, so a rationale
 * already containing `\|` came out as `\\|` — which a markdown reader consumes as an escaped
 * backslash followed by a live, cell-splitting pipe rather than an escaped one. Escaping `\` first
 * doubles a pre-existing one before `|`'s own escape goes in, so the two can never combine that way.
 * `RationaleSchema` bounds a rationale to one sentence, so a raw `\n` reaching here would itself be a
 * data bug worth surfacing as literal `\n` text rather than silently reformatting.
 */
function escapeCell(text: string): string {
	return text
		.replace(/\\/g, '\\\\')
		.replace(/\|/g, '\\|')
		.replace(/\r\n|\r|\n/g, '\\n');
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
 * the raw colour value on its own — a derived or invented ramp step curves to genuinely different
 * lightness in every scheme (`oklch-scale-engine.ts`'s `buildRamp` fits each scheme's own background),
 * so requiring value equality here would split nearly every row in "What the interpretation produced"
 * and "Invented tokens", neither of which even prints a value a reader could compare. A caller that
 * does print a value — `keyColourSection`, the one section with a Value column — checks it separately
 * against its own value-aware merge, so an edit that changes a value without touching `$extensions`
 * (`token-overrides.ts`'s `write` never does) still surfaces there instead of hiding behind a claim
 * this function alone can't tell has stopped being the whole story.
 */
function sameClaim(a: TokenProvenance, b: TokenProvenance): boolean {
	return (
		a.provenance === b.provenance && a.seedField === b.seedField && a.rationale === b.rationale
	);
}

/**
 * One list, in light's own order, light-exclusive paths trailed by any dark-exclusive ones in dark's
 * order: each of light's entries either matches its counterpart at the same path in dark, in which
 * case it prints once, or the two rows print separately, each tagged with its scheme. Neither
 * scheme's exclusive paths are dropped: `PrimitiveLayerSchema` and `SemanticLayerSchema` are plain
 * records (`token-set.ts`) with no cross-scheme key check, so a path only one scheme declares — a
 * dark-only semantic token, say — is real data, and it prints under that scheme's own label rather
 * than vanishing because the other scheme has nothing to pair it with.
 *
 * `sameValue`, when a caller supplies one, adds a second bar to clearing as one row: same claim AND
 * the same printed value. Every caller but `keyColourSection`'s leaves it unset, because `sameClaim`
 * alone is already the right bar for a section with no Value column to disagree over.
 */
function mergeSchemes<T extends TokenEntry>(
	light: readonly T[],
	dark: readonly T[],
	sameValue?: (a: T, b: T) => boolean,
): T[] {
	const lightPaths = new Set(light.map((entry) => entry.path));
	const darkByPath = new Map(dark.map((entry) => [entry.path, entry]));
	const merged: T[] = [];

	for (const entry of light) {
		const counterpart = darkByPath.get(entry.path);
		const collapses =
			counterpart &&
			sameClaim(entry.extensions, counterpart.extensions) &&
			(!sameValue || sameValue(entry, counterpart));

		if (collapses) {
			merged.push(entry);
			continue;
		}

		merged.push({ ...entry, scheme: 'light' });
		if (counterpart) merged.push({ ...counterpart, scheme: 'dark' });
	}

	for (const entry of dark) {
		if (!lightPaths.has(entry.path)) merged.push({ ...entry, scheme: 'dark' });
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

/** The Value cell `keyColourSection` prints, so a per-scheme edit that misses `$extensions` still splits there. */
function sameColourValue(a: ColourEntry, b: ColourEntry): boolean {
	return a.value === b.value;
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

/**
 * Merged on the claim alone (`mergeSchemes`'s default `sameValue`), never the value: a shadow tints
 * from the resolved page surface (this function's own `$extensions.rationale` says so), so light and
 * dark disagree on colour, alpha and blur on every run, the same way a derived or invented ramp step
 * does (`sameClaim`'s docblock). "What the interpretation produced" has no Value column for a reader
 * to compare anyway, and the sentence that section prints above its table is what makes an unlabelled
 * shadow row here the same claim made twice rather than the same number twice.
 */
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
 *
 * Ordered by UTF-16 code unit, not `localeCompare`: this is the only locale-sensitive sort in `core/`,
 * and a token path is an identifier, not prose a reader collates by a language's own rules. `aKey <
 * bKey` isn't quite codepoint order — an astral character (U+10000 and up, a surrogate pair) can sort
 * ahead of a single unit in U+E000–U+FFFF even though its codepoint is larger — but it's still
 * locale-free and deterministic, because it follows the string's own encoding rather than a runtime's
 * ICU tables. `localeCompare` without an explicit locale reads the runtime's default ICU locale, so
 * the same token set could sort this table into a different row order on a machine configured
 * differently — exactly the kind of environment-dependent output a pure function (`designDoc`'s own
 * docblock) can't afford.
 */
function sortedByKeys<T>(items: readonly T[], keysOf: (item: T) => readonly string[]): T[] {
	// oxlint-disable-next-line unicorn/no-array-sort
	return [...items].sort((a, b) => {
		const [aKeys, bKeys] = [keysOf(a), keysOf(b)];

		for (let i = 0; i < aKeys.length; i += 1) {
			const [aKey, bKey] = [aKeys[i]!, bKeys[i]!];
			const compared = aKey < bKey ? -1 : aKey > bKey ? 1 : 0;

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

/** Only the observed half of `entries`, so a caller merging for this table never sees a claim it can't print here. */
function observedOnly(entries: readonly ColourEntry[]): ColourEntry[] {
	return entries.filter((entry) => entry.extensions.provenance === 'observed');
}

/** A Key colours row: the one section with a Value column, alongside every other section's Seed field and Rationale. */
function toColourRow(entry: ColourEntry): string[] {
	return [entryPath(entry), entry.value, seedFieldOf(entry.extensions), entry.extensions.rationale];
}

/**
 * The one section with a Value column, so it's the one place a merge has to agree on the value as
 * well as the claim (`mergeSchemes`'s `sameValue`). Filtering each scheme's own entries to `observed`
 * before merging, rather than merging everything once and filtering after, keeps this section's
 * pairing decision from being made by a row it will never print: a derived or invented step's value
 * is expected to differ by scheme (see `sameClaim`), and letting that decide whether an *observed*
 * counterpart pairs up would be answering this table's question with another table's data.
 */
function keyColourSection(tokens: TokenSet): string[] {
	const rampRows = mergeSchemes(
		observedOnly(colourEntriesFor(tokens.schemes.light.primitives)),
		observedOnly(colourEntriesFor(tokens.schemes.dark.primitives)),
		sameColourValue,
	).map(toColourRow);

	// An observed semantic alias (this fixture's `primary`, `sidebar-primary`) inherits its
	// provenance straight from the ramp step it names (`semantic-layer.ts`'s `inherit`), so it is as
	// much an observed key colour as that step is — the alias itself is the "value" a reader checks
	// against the seed, the way a ramp step's own OKLCH channels are.
	const aliasRows = sortedByKeys(
		mergeSchemes(
			observedOnly(semanticEntriesFor(tokens.schemes.light.semantic)),
			observedOnly(semanticEntriesFor(tokens.schemes.dark.semantic)),
			sameColourValue,
		),
		(entry) => [entryPath(entry)],
	).map(toColourRow);

	return [
		'## Key colours',
		'',
		...table(['Token', 'Value', 'Seed field', 'Rationale'], [...rampRows, ...aliasRows]),
	];
}

/**
 * Printed under both sections whose rows carry no Value column. Derived and invented ramp steps,
 * and shadows, differ by scheme on every run, yet merge into one unlabelled row because their claim
 * doesn't (`mergeSchemes`), so a reader could otherwise take an unlabelled row as scheme-invariant.
 */
const SAME_CLAIM_NOTE =
	'A row with no `light:` or `dark:` label makes the same claim in both schemes, even where the value it resolves to differs between them.';

function interpretationSection(entries: readonly TokenEntry[]): string[] {
	const rows = sortedByKeys(
		entries.filter((entry) => entry.extensions.provenance === 'derived'),
		(entry) => [seedFieldOf(entry.extensions), entryPath(entry)],
	).map((entry) => [entryPath(entry), seedFieldOf(entry.extensions), entry.extensions.rationale]);

	return [
		'## What the interpretation produced',
		'',
		SAME_CLAIM_NOTE,
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

	return [
		'## Invented tokens',
		'',
		SAME_CLAIM_NOTE,
		'',
		...table(['Token', 'Provenance', 'Rationale'], rows),
	];
}

/** `SuggestedPairingSchema`'s three roles, in the order the schema declares them. */
const PAIRING_ROLES = ['display', 'body', 'mono'] as const;

/**
 * `displayDiffersFromBody` decides whether the pairing ranks display and body as separate roles
 * (`brand-seed.ts`'s own docblock), so it's a type decision as real as category or tone: leaving it
 * off the Measured row let two seeds that disagree on it render an identical Type section. "yes"/"no"
 * matches how a reader already reads this row rather than the raw `true`/`false` the field holds, and
 * "not classified" reuses this row's own wording for every other cell an absent classification leaves
 * unanswered.
 */
function displayDiffersCell(typeClassification: BrandSeed['typeClassification']): string {
	if (!typeClassification) return 'not classified';

	return typeClassification.displayDiffersFromBody ? 'yes' : 'no';
}

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
						displayDiffersCell(seed.typeClassification),
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
		...table(
			['Category', 'Tone', 'X-height', 'Type scale ratio', 'Display differs from body'],
			measured,
		),
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
			...keyColourSection(tokens),
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
