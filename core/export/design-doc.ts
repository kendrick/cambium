import type { BrandSeed } from '../brand-seed';
import type { RepairEntry } from '../contrast/repair';
import { toOklchCss } from '../css/oklch-css';
import { CAMBIUM_NAMESPACE, type TokenProvenance } from '../provenance';
import { RAMP_NAMES } from '../scale-engine';
import type { TokenSet } from '../token-set';

export type DesignDocInput = {
	tokens: TokenSet;
	seed: BrandSeed;
	repairs: readonly RepairEntry[];
};

/** A token's dotted path alongside the one payload every claim in the doc has to trace to. */
type TokenEntry = { path: string; extensions: TokenProvenance };

/** The same entry, plus the CSS colour only a primitive ramp step carries. */
type ColourEntry = TokenEntry & { value: string };

/** Pipes are the one character that would otherwise reopen a table row mid-cell. */
function escapeCell(text: string): string {
	return text.replace(/\|/g, '\\|');
}

function row(cells: readonly string[]): string {
	return `| ${cells.map(escapeCell).join(' | ')} |`;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
	return [row(headers), row(headers.map(() => '---')), ...rows.map(row)];
}

function extensionsOf(holder: {
	$extensions: { [CAMBIUM_NAMESPACE]: TokenProvenance };
}): TokenProvenance {
	return holder.$extensions[CAMBIUM_NAMESPACE];
}

/** Every step of every primitive ramp, in `RAMP_NAMES` then step order, so two runs list them alike. */
function colourEntries(tokens: TokenSet): ColourEntry[] {
	const entries: ColourEntry[] = [];

	for (const ramp of RAMP_NAMES) {
		const steps = tokens.primitives[ramp];

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

function semanticEntries(tokens: TokenSet): TokenEntry[] {
	return Object.entries(tokens.semantic).map(([token, entry]) => ({
		path: `semantic.${token}`,
		extensions: extensionsOf(entry),
	}));
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
 * Every token in the set, walked once, top-level categories only. The top level mirrors
 * `schemes.light` (`checkMirroredLayers`), and the seed's own colour lands on the same step in
 * both schemes (`oklch-scale-engine.ts`'s `BRAND_STEP` placement runs before the schemes diverge),
 * so walking `schemes.dark` too would repeat every entry under a second path rather than add one.
 */
function allEntries(tokens: TokenSet): TokenEntry[] {
	return [
		...colourEntries(tokens),
		...semanticEntries(tokens),
		...recordEntries('shadow.values', tokens.shadow.values),
		...recordEntries('radius.values', tokens.radius.values),
		...recordEntries('typography.values.size', tokens.typography.values.size),
		...recordEntries('typography.values.weight', tokens.typography.values.weight),
		...recordEntries('typography.values.lineHeight', tokens.typography.values.lineHeight),
		...recordEntries('tracking.values', tokens.tracking.values),
		...recordEntries('spacing.values', tokens.spacing.values),
		...recordEntries('opacity.values', tokens.opacity.values),
		...recordEntries('motion.values.duration', tokens.motion.values.duration),
		...recordEntries('motion.values.easing', tokens.motion.values.easing),
		{ path: 'focusRing.values.width', extensions: extensionsOf(tokens.focusRing.values.width) },
		{ path: 'focusRing.values.offset', extensions: extensionsOf(tokens.focusRing.values.offset) },
		...recordEntries('zIndex.values', tokens.zIndex.values),
	];
}

function keyColourSection(colours: readonly ColourEntry[]): string[] {
	const rows = colours
		.filter((entry) => entry.extensions.provenance === 'observed')
		.map((entry) => [
			entry.path,
			entry.value,
			entry.extensions.seedField ?? '',
			entry.extensions.rationale,
		]);

	return ['## Key colours', '', ...table(['Token', 'Value', 'Seed field', 'Rationale'], rows)];
}

function interpretationSection(entries: readonly TokenEntry[]): string[] {
	const rows = entries
		.filter((entry) => entry.extensions.provenance === 'derived')
		.map((entry) => ({
			path: entry.path,
			seedField: entry.extensions.seedField ?? '',
			rationale: entry.extensions.rationale,
		}))
		// `map` already returned a fresh array, so this sort mutates nothing the caller can see.
		// `toSorted` would satisfy the rule directly, but it is ES2023 and tsconfig targets ES2022,
		// the same trade `core/dtcg/report.ts` makes.
		// oxlint-disable-next-line unicorn/no-array-sort
		.sort((a, b) => a.seedField.localeCompare(b.seedField) || a.path.localeCompare(b.path))
		.map((entry) => [entry.path, entry.seedField, entry.rationale]);

	return [
		'## What the interpretation produced',
		'',
		...table(['Token', 'Seed field', 'Rationale'], rows),
	];
}

function inventedSection(entries: readonly TokenEntry[]): string[] {
	const rows = entries
		.filter((entry) => entry.extensions.provenance === 'invented')
		// `filter` already returned a fresh array, so this sort mutates nothing the caller can see.
		// `toSorted` would satisfy the rule directly, but it is ES2023 and tsconfig targets ES2022.
		// oxlint-disable-next-line unicorn/no-array-sort
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((entry) => [entry.path, entry.extensions.provenance, entry.extensions.rationale]);

	return ['## Invented tokens', '', ...table(['Token', 'Provenance', 'Rationale'], rows)];
}

/** `SuggestedPairingSchema`'s three roles, in the order the schema declares them. */
const PAIRING_ROLES = ['display', 'body', 'mono'] as const;

function typeSection(seed: BrandSeed): string[] {
	const measured = seed.typeClassification
		? [
				[
					seed.typeClassification.category,
					seed.typeClassification.tone,
					seed.typeClassification.xHeight,
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
		...table(['Category', 'Tone', 'X-height'], measured),
		'',
		...table(['Family', 'Role', 'Score'], suggestedRows),
	];
}

function repairsSection(repairs: readonly RepairEntry[]): string[] {
	if (repairs.length === 0) return ['## Contrast repairs', '', 'No repairs were applied.'];

	const rows = repairs.map((entry) => [
		`${entry.foreground} / ${entry.background}`,
		`${entry.measured.toFixed(2)} → ${entry.achieved.toFixed(2)}`,
		`${toOklchCss(entry.from)} → ${toOklchCss(entry.to)}`,
		String(entry.target),
	]);

	return [
		'## Contrast repairs',
		'',
		...table(['Pair', 'Measured → Achieved', 'From → To', 'Target'], rows),
	];
}

/**
 * A pure function of a token set, its seed, and the contrast repairs run against it: the same
 * three inputs a caller already has in hand once #15 wires this in, so the doc never reaches past
 * them for a fact it could instead cite.
 *
 * Every section reads straight off one of the three inputs. Where a value has no seed field to
 * name — a system constant, an invented candidate — the doc says so in the same cell rather than
 * omitting the row, since "nothing observed this" is itself a claim the payload carries.
 */
export function designDoc({ tokens, seed, repairs }: DesignDocInput): string {
	const colours = colourEntries(tokens);
	const entries = allEntries(tokens);

	return (
		[
			'# Design doc',
			'',
			...keyColourSection(colours),
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
