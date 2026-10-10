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

export type FailingRow = { entry: ContrastEntry; line: string; cause: string };

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
	// `declineFor` spreads `entry.from` into the decline, so a held decline carries the same numbers
	// and exact equality is safe.
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

export type FailureContext = {
	attributed: Readonly<Record<string, readonly ContrastEntry[]>>;
	overrides: Readonly<Record<string, TokenOverride>>;
	tokenSet: TokenSet;
};

/**
 * The cause when no single override or repair reason explains a failure, as with two alias
 * overrides.
 */
export const COMBINED_CAUSE =
	'Several of your overrides cause this together, so taking back just one won’t fix it.';

/**
 * `line` keeps the text the tab printed before #27, because `e2e/token-list.spec.ts` and
 * `e2e/accessibility.spec.ts` both find a failing pair by it.
 */
export function failingRows(
	contrast: { report: readonly ContrastEntry[]; unrepaired: readonly UnrepairedEntry[] },
	rows: readonly RepairRow[],
	context: FailureContext,
): FailingRow[] {
	return contrast.report
		.filter((entry) => !entry.passes)
		.map((entry) => ({
			entry,
			line: `${entry.scheme}: ${entry.foreground} on ${entry.background}: ${entry.wcag.toFixed(2)}:1, needs ${entry.target}`,
			cause: causeOf(entry, contrast.unrepaired, rows, context),
		}));
}

type PairRef = { scheme: string; foreground: string; background: string };

const same = (a: PairRef, b: PairRef) =>
	a.scheme === b.scheme && a.foreground === b.foreground && a.background === b.background;

function causeOf(
	entry: ContrastEntry,
	unrepaired: readonly UnrepairedEntry[],
	rows: readonly RepairRow[],
	{ attributed, overrides, tokenSet }: FailureContext,
): string {
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
		const override = overrides[key];

		if (override?.kind !== 'alias' || !entries.some((candidate) => same(candidate, entry)))
			continue;

		return `Your override of ${override.token}`;
	}

	// #153 attribution skips primitive overrides, so a hand-edited step needs its own lookup. A
	// decline on an operand step never reaches this lookup when `rows` and `tokenSet` agree, as they
	// do in the panel, because the declined check above returns first.
	const semantic = tokenSet.schemes[entry.scheme].semantic;
	const operands = [semantic[entry.foreground]?.alias, semantic[entry.background]?.alias];
	const edited = Object.values(overrides).find(
		(override) =>
			override.kind === 'primitive' &&
			override.scheme === entry.scheme &&
			operands.includes(`${override.ramp}.${override.step}`),
	);

	if (edited?.kind === 'primitive')
		return `Your override of ${edited.scheme} ${edited.ramp}.${edited.step}`;

	const reason = unrepaired.find((candidate) => same(candidate, entry));

	return reason ? UNREPAIRED_REASON_TEXT[reason.reason] : COMBINED_CAUSE;
}
