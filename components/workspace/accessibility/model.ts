import { type ContrastEntry } from '../../../core/contrast/check';
import { CONTRAST_PAIRS } from '../../../core/contrast/pairs';
import type { RepairEntry, UnrepairedEntry, UnrepairedReason } from '../../../core/contrast/repair';
import { type Oklch, renderedContrast } from '../../../core/oklch';
import { resolveScheme } from '../../../core/resolve-scheme';
import { overrideKey, type TokenOverride } from '../../../core/token-overrides';
import type { TokenSet } from '../../../core/token-set';

export type RepairStatus = 'applied' | 'declined' | 'edited';

type Painted = { fg: Oklch; bg: Oklch; ratio: number };

/** One declared pair a repaired step backs, painted at the step's pre-repair and repaired colours. */
export type Specimen = {
	foreground: string;
	background: string;
	target: number;
	kind: 'text' | 'non-text';
	before: Painted;
	after: Painted;
};

export type RepairRow = {
	id: string;
	entry: RepairEntry;
	status: RepairStatus;
	decline: TokenOverride;
	key: string;
	specimens: Specimen[];
};

export type FailingRow = { entry: ContrastEntry; line: string; cause: string | null };

/**
 * `both-pinned` is parked (ADR-0010 keeps it unreachable from the workspace), but the `Record`
 * makes a reason added later a type error here instead of a blank cause line.
 */
export const UNREPAIRED_REASON_TEXT: Record<UnrepairedReason, string> = {
	'both-pinned': 'Both colours are pinned, so repair left them alone.',
	'no-lightness-clears': 'No lightness for either side reaches the target at this hue.',
	'did-not-converge': 'Two pairs pull the same step in opposite directions, so repair stopped.',
};

/** A primitive override at the step's pre-repair colour: the one edit that undoes a repair. */
export function declineFor(entry: RepairEntry): TokenOverride {
	return {
		kind: 'primitive',
		scheme: entry.scheme,
		ramp: entry.ramp,
		step: entry.step,
		...entry.from,
	};
}

function statusOf(entry: RepairEntry, held: TokenOverride | undefined): RepairStatus {
	if (held === undefined) return 'applied';
	// Exact equality is safe: `from` is already on the grid every ramp step is quantized to.
	if (
		held.kind === 'primitive' &&
		held.l === entry.from.l &&
		held.c === entry.from.c &&
		held.h === entry.from.h
	) {
		return 'declined';
	}

	return 'edited';
}

/**
 * Every ratio comes from `renderedContrast` of the two colours the panel paints, never from
 * `entry.measured`/`achieved`: those describe the pair that triggered the move, and a step often
 * backs more pairs than that one.
 */
function specimensFor(entry: RepairEntry, tokenSet: TokenSet): Specimen[] {
	const resolved = resolveScheme(tokenSet.schemes[entry.scheme]);
	const semantic = tokenSet.schemes[entry.scheme].semantic;
	const alias = `${entry.ramp}.${entry.step}`;
	const specimens: Specimen[] = [];

	for (const pair of CONTRAST_PAIRS) {
		const onForeground = semantic[pair.foreground]?.alias === alias;
		const onBackground = semantic[pair.background]?.alias === alias;

		if (!onForeground && !onBackground) continue;

		const at = (step: Oklch): Painted => {
			const fg = onForeground ? step : resolved[pair.foreground]!;
			const bg = onBackground ? step : resolved[pair.background]!;

			return { fg, bg, ratio: renderedContrast(fg, bg) };
		};

		specimens.push({
			foreground: pair.foreground,
			background: pair.background,
			target: pair.target,
			kind: pair.target === 3 ? 'non-text' : 'text',
			before: at(entry.from),
			after: at(entry.to),
		});
	}

	return specimens;
}

export function repairRows(
	applied: readonly RepairEntry[],
	tokenSet: TokenSet,
	overrides: Readonly<Record<string, TokenOverride>>,
): RepairRow[] {
	return applied.map((entry) => {
		const decline = declineFor(entry);
		const key = overrideKey(decline);

		return {
			id: `${entry.scheme}:${entry.ramp}.${entry.step}`,
			entry,
			status: statusOf(entry, overrides[key]),
			decline,
			key,
			specimens: specimensFor(entry, tokenSet),
		};
	});
}

/**
 * The line keeps the exact text the tab printed before #27 (two e2e specs find it by substring);
 * the cause rides beside it so those specs stay green.
 */
export function failingRows(
	contrast: { report: readonly ContrastEntry[]; unrepaired: readonly UnrepairedEntry[] },
	rows: readonly RepairRow[],
	attributed: Readonly<Record<string, readonly ContrastEntry[]>>,
): FailingRow[] {
	return contrast.report
		.filter((entry) => !entry.passes)
		.map((entry) => ({
			entry,
			line: `${entry.scheme}: ${entry.foreground} on ${entry.background}: ${entry.wcag.toFixed(2)}:1, needs ${entry.target}`,
			cause: causeOf(entry, contrast.unrepaired, rows, attributed),
		}));
}

type PairRef = { scheme: string; foreground: string; background: string };

const same = (a: PairRef, b: PairRef) =>
	a.scheme === b.scheme && a.foreground === b.foreground && a.background === b.background;

function causeOf(
	entry: ContrastEntry,
	unrepaired: readonly UnrepairedEntry[],
	rows: readonly RepairRow[],
	attributed: Readonly<Record<string, readonly ContrastEntry[]>>,
): string | null {
	const declined = rows.find(
		(row) =>
			row.status === 'declined' &&
			row.entry.scheme === entry.scheme &&
			row.specimens.some(
				(s) => s.foreground === entry.foreground && s.background === entry.background,
			),
	);

	if (declined)
		return `Repair declined: ${declined.entry.scheme} ${declined.entry.ramp}.${declined.entry.step}`;

	for (const [key, entries] of Object.entries(attributed)) {
		if (!entries.some((candidate) => same(candidate, entry))) continue;

		// Keys are `overrideKey` JSON; alias keys are `['alias', scheme, token]`.
		const token = (JSON.parse(key) as unknown[])[2];

		return `Your override of ${String(token)}`;
	}

	const reason = unrepaired.find((candidate) => same(candidate, entry));

	return reason ? UNREPAIRED_REASON_TEXT[reason.reason] : null;
}
