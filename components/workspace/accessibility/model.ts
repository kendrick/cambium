import { type ContrastEntry, checkContrast } from '../../../core/contrast/check';
import { CONTRAST_PAIRS } from '../../../core/contrast/pairs';
import type { RepairEntry, UnrepairedEntry, UnrepairedReason } from '../../../core/contrast/repair';
import { type Oklch, renderedContrast } from '../../../core/oklch';
import { resolveScheme } from '../../../core/resolve-scheme';
import type { RampSet, SchemeName } from '../../../core/scale-engine';
import { applyOverrides, overrideKey, type TokenOverride } from '../../../core/token-overrides';
import { stepForAlias, type TokenSet } from '../../../core/token-set';

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
	/**
	 * The scale engine's ramps, before repair. The store doesn't expose its repaired set, so these
	 * ramps and `rows` rebuild a hand-edited step's colour from before the edit.
	 */
	ramps: Readonly<Record<SchemeName, RampSet>>;
};

/**
 * The cause when no single override or repair reason explains a failure, as with two overrides
 * that each keep the pair failing on their own.
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
	const passesWithout = revertChecker(rows, context);

	return contrast.report
		.filter((entry) => !entry.passes)
		.map((entry) => ({
			entry,
			line: `${entry.scheme}: ${entry.foreground} on ${entry.background}: ${entry.wcag.toFixed(2)}:1, needs ${entry.target}`,
			cause: causeOf(entry, contrast.unrepaired, rows, context, passesWithout),
		}));
}

type PairRef = { scheme: string; foreground: string; background: string };

const same = (a: PairRef, b: PairRef) =>
	a.scheme === b.scheme && a.foreground === b.foreground && a.background === b.background;

/**
 * Whether the final set passes a pair once one primitive override is taken back, the same
 * counterfactual #153 runs for alias overrides. Taking it back means the step's repaired colour:
 * `to` for a step repair moved, else the engine's own.
 */
function revertChecker(
	rows: readonly RepairRow[],
	{ tokenSet, ramps }: FailureContext,
): (override: Extract<TokenOverride, { kind: 'primitive' }>, entry: ContrastEntry) => boolean {
	const reports = new Map<string, readonly ContrastEntry[] | null>();

	const reportWithout = (override: Extract<TokenOverride, { kind: 'primitive' }>) => {
		const key = overrideKey(override);

		if (!reports.has(key)) {
			// Repair reports one entry per moved step, the last move, so `to` is the colour it left.
			const moved = rows.find(
				(row) =>
					row.entry.scheme === override.scheme &&
					row.entry.ramp === override.ramp &&
					row.entry.step === override.step,
			);
			const before =
				moved?.entry.to ??
				stepForAlias(ramps[override.scheme], `${override.ramp}.${override.step}`);
			const reverted = before
				? applyOverrides(tokenSet, [{ ...override, l: before.l, c: before.c, h: before.h }])
				: null;

			reports.set(key, reverted?.ok ? checkContrast(reverted.tokenSet) : null);
		}

		return reports.get(key);
	};

	return (override, entry) =>
		reportWithout(override)?.some((candidate) => same(candidate, entry) && candidate.passes) ??
		false;
}

function causeOf(
	entry: ContrastEntry,
	unrepaired: readonly UnrepairedEntry[],
	rows: readonly RepairRow[],
	{ attributed, overrides, tokenSet }: FailureContext,
	passesWithout: ReturnType<typeof revertChecker>,
): string {
	for (const [key, entries] of Object.entries(attributed)) {
		const override = overrides[key];

		if (override?.kind !== 'alias' || !entries.some((candidate) => same(candidate, entry)))
			continue;

		return `Your override of ${override.token}`;
	}

	// Repair already couldn't clear this pair before any override, so no edit made it fail.
	const reason = unrepaired.find((candidate) => same(candidate, entry));

	if (reason) return UNREPAIRED_REASON_TEXT[reason.reason];

	// #153 attribution skips primitive overrides, declines included, so they get the same
	// counterfactual here. Sitting on an operand isn't enough: a second edit can keep the pair failing
	// after this one is reverted.
	const semantic = tokenSet.schemes[entry.scheme].semantic;
	const operands = [semantic[entry.foreground]?.alias, semantic[entry.background]?.alias];

	for (const override of Object.values(overrides)) {
		if (
			override.kind !== 'primitive' ||
			override.scheme !== entry.scheme ||
			!operands.includes(`${override.ramp}.${override.step}`) ||
			!passesWithout(override, entry)
		)
			continue;

		const declined = rows.find(
			(row) => row.status === 'declined' && row.key === overrideKey(override),
		);

		return declined
			? `Repair declined: ${declined.entry.scheme} ${declined.entry.ramp}.${declined.entry.step}`
			: `Your override of ${override.scheme} ${override.ramp}.${override.step}`;
	}

	return COMBINED_CAUSE;
}
