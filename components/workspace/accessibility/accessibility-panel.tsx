'use client';

import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../../app/state/workspace-store';
import type { ContrastEntry } from '../../../core/contrast/check';
import { toOklchCss } from '../../../core/css/oklch-css';
import type { Oklch } from '../../../core/oklch';
import { resolveScheme } from '../../../core/resolve-scheme';
import type { TokenSet } from '../../../core/token-set';
import { SCHEME_NAMES } from '../../../core/scale-engine';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { failingRows, type RepairRow, type RepairStatus, repairRows, type Specimen } from './model';
import { pairTable } from './pairs';

const STATUS_TEXT: Record<RepairStatus, string> = {
	applied: 'Applied',
	declined: 'Declined',
	edited: 'Edited by you',
};

const SAMPLE_TEXT = 'Body text at 16px reads like this.';

const HEADING = 'text-foreground text-base font-semibold';

type Paint = { fg: Oklch; bg: Oklch; kind: Specimen['kind'] };

/**
 * The pair painted in its own colours at the size it ships at. Nothing else sits inside
 * this box, and its corners stay square, because `e2e/painted-contrast.ts` reads the whole box: the
 * majority byte as fill, the hardest-contrasting byte as ink. A label or a rounded corner showing the
 * page through would hand it a pixel that isn't either operand.
 */
function Swatch({ paint, data }: { paint: Paint; data: Record<`data-${string}`, string> }) {
	const background = toOklchCss(paint.bg);

	if (paint.kind === 'text') {
		return (
			<div
				{...data}
				className="p-3 text-base"
				style={{ color: toOklchCss(paint.fg), backgroundColor: background }}
			>
				{SAMPLE_TEXT}
			</div>
		);
	}

	// A ring pair is non-text contrast (SC 1.4.11), so it paints the way a focus ring does: a 2px
	// outline around a box, both on the background.
	return (
		<div {...data} className="p-3" style={{ backgroundColor: background }}>
			<div
				className="h-6 w-16 rounded-sm"
				style={{
					outlineWidth: '2px',
					outlineStyle: 'solid',
					outlineOffset: '2px',
					outlineColor: toOklchCss(paint.fg),
				}}
			/>
		</div>
	);
}

function RepairCard({
	row,
	onDecline,
	onRestore,
}: {
	row: RepairRow;
	onDecline: (row: RepairRow) => void;
	onRestore: (row: RepairRow) => void;
}) {
	// Keyed by `row.id` in the list, so a row that drops out takes its toggle state with it.
	const [showBefore, setShowBefore] = useState(false);
	const { entry } = row;
	const name = `${entry.scheme} ${entry.ramp}.${entry.step}`;

	return (
		<li data-repair={row.id} className="border-border flex flex-col gap-3 rounded-md border p-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="flex flex-col gap-0.5">
					<h4 className="text-foreground font-medium">{name}</h4>
					<p>
						Moved for {entry.foreground} on {entry.background}
					</p>
				</div>
				<Badge variant="outline">{STATUS_TEXT[row.status]}</Badge>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					aria-pressed={showBefore}
					aria-label={`Show ${name} before repair`}
					className="aria-pressed:bg-muted aria-pressed:text-foreground"
					onClick={() => setShowBefore((shown) => !shown)}
				>
					Before repair
				</Button>
				{row.status === 'applied' ? (
					<Button
						variant="outline"
						size="sm"
						aria-label={`Decline repair of ${name}`}
						onClick={() => onDecline(row)}
					>
						Decline
					</Button>
				) : row.status === 'declined' ? (
					<Button
						variant="outline"
						size="sm"
						aria-label={`Restore repair of ${name}`}
						onClick={() => onRestore(row)}
					>
						Restore
					</Button>
				) : (
					<p>You changed this step by hand. Revert it in the token list to get the repair back.</p>
				)}
			</div>
			<ul className="flex flex-col gap-3">
				{row.specimens.map((specimen) => {
					const pair = `${specimen.foreground} on ${specimen.background}`;
					const shown = showBefore ? specimen.before : specimen.after;

					return (
						<li key={pair} className="flex flex-col gap-1">
							<p className="text-foreground">{pair}</p>
							<Swatch
								paint={{ fg: shown.fg, bg: shown.bg, kind: specimen.kind }}
								data={{ 'data-specimen': pair }}
							/>
							<p>
								Before {specimen.before.ratio.toFixed(2)}:1 · After{' '}
								{specimen.after.ratio.toFixed(2)}:1
							</p>
						</li>
					);
				})}
			</ul>
		</li>
	);
}

/**
 * Reads `contrast.applied` rather than `contrast.repairs`, because a decline is the user override
 * `repairs` filters out, and a declined repair has to stay listed for Restore to reach it.
 */
export function AccessibilityPanel({
	store,
	attributed,
	aliasBaseline,
}: {
	store: StoreApi<WorkspaceState>;
	/** The shell's #153 attribution, shared with the token list rather than derived twice. */
	attributed: Record<string, ContrastEntry[]>;
	/** The set before user overrides, whose aliases decide which pairs a repair card shows. */
	aliasBaseline: TokenSet | null;
}) {
	const contrast = useStore(store, (state) => state.contrast);
	const tokenSet = useStore(store, (state) => state.tokenSet);
	const derived = useStore(store, (state) => state.derived);
	const overrides = useStore(store, (state) => state.overrides);
	const setOverride = useStore(store, (state) => state.setOverride);
	const clearOverride = useStore(store, (state) => state.clearOverride);

	const rows = useMemo(
		() =>
			contrast && tokenSet
				? repairRows(contrast.applied, tokenSet, overrides, aliasBaseline ?? tokenSet)
				: [],
		[contrast, tokenSet, overrides, aliasBaseline],
	);
	const failing = useMemo(
		() =>
			contrast && tokenSet && derived?.ok
				? failingRows(contrast, rows, { attributed, overrides, tokenSet, ramps: derived.schemes })
				: [],
		[contrast, rows, attributed, overrides, tokenSet, derived],
	);
	const resolved = useMemo(
		() =>
			tokenSet
				? {
						light: resolveScheme(tokenSet.schemes.light),
						dark: resolveScheme(tokenSet.schemes.dark),
					}
				: null,
		[tokenSet],
	);

	// `null` only means no tokens yet (see `ContrastState`), so a non-null report with nothing
	// failing is a distinct, and much more common, state worth its own message.
	if (contrast === null) {
		return (
			<p>There are no tokens to check yet. They show up here once the seed produces a token set.</p>
		);
	}

	const anyApplied = rows.some((row) => row.status === 'applied');
	const anyDeclined = rows.some((row) => row.status === 'declined');

	// The bulk buttons call these once per step, and each call recomputes from the cached derivation.
	// There are a handful of repairs at most, so a batch store action would save nothing. Both bulk
	// buttons skip edited steps, which belong to the user.
	const decline = (row: RepairRow) => setOverride(row.decline);
	const restore = (row: RepairRow) => clearOverride(row.key);

	return (
		<div className="flex flex-col gap-6">
			<p>
				{failing.length === 0
					? 'Every declared pair passes AA in both schemes.'
					: `${failing.length} declared ${failing.length === 1 ? 'pair fails' : 'pairs fail'} AA.`}
			</p>

			<div className="flex flex-col gap-3">
				<h3 className={HEADING}>Repairs</h3>
				{rows.length === 0 ? (
					<p>The repair pass moved no steps.</p>
				) : (
					<>
						<div className="flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={!anyApplied}
								onClick={() => {
									for (const row of rows) if (row.status === 'applied') decline(row);
								}}
							>
								Decline all repairs
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={!anyDeclined}
								onClick={() => {
									for (const row of rows) if (row.status === 'declined') restore(row);
								}}
							>
								Restore all repairs
							</Button>
						</div>
						<ul className="flex flex-col gap-4">
							{rows.map((row) => (
								<RepairCard key={row.id} row={row} onDecline={decline} onRestore={restore} />
							))}
						</ul>
					</>
				)}
			</div>

			{failing.length > 0 ? (
				<div className="flex flex-col gap-3">
					<h3 className={HEADING}>Failing pairs</h3>
					<ul className="flex flex-col gap-4">
						{failing.map(({ entry, line, cause }) => {
							const fg = resolved?.[entry.scheme][entry.foreground];
							const bg = resolved?.[entry.scheme][entry.background];

							return (
								<li
									key={`${entry.scheme}-${entry.foreground}-${entry.background}`}
									className="flex flex-col gap-1"
								>
									{/* `e2e/token-list.spec.ts` finds this line by substring, so its text stays
									    fixed. */}
									<p className="text-foreground">{line}</p>
									<p>{cause}</p>
									{fg && bg ? (
										<Swatch
											paint={{ fg, bg, kind: entry.target === 3 ? 'non-text' : 'text' }}
											data={{
												'data-failing-specimen': `${entry.scheme}: ${entry.foreground} on ${entry.background}`,
											}}
										/>
									) : null}
								</li>
							);
						})}
					</ul>
				</div>
			) : null}

			<div className="flex flex-col gap-3">
				<h3 className={HEADING}>All pairs</h3>
				<p>
					APCA is advisory. The AA verdict reads the WCAG 2 ratio alone, so an APCA figure never
					changes it. Cambium measures each ratio on its own 8-bit sRGB conversion, which can land
					one byte off the browser’s. A pair right at its target can then paint just under it (issue
					#190).
				</p>
				{SCHEME_NAMES.map((scheme) => (
					<Table key={scheme} className="caption-top">
						<TableCaption className="mt-0 mb-2 text-left">
							Every declared pair, {scheme}
						</TableCaption>
						<TableHeader>
							<TableRow>
								<TableHead>Pair</TableHead>
								<TableHead>Ratio</TableHead>
								<TableHead>Target</TableHead>
								<TableHead>AA</TableHead>
								<TableHead>APCA Lc (advisory)</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pairTable(contrast.report, scheme).map((row) => (
								<TableRow key={row.pair}>
									<TableCell>{row.pair}</TableCell>
									<TableCell>{row.ratio}</TableCell>
									<TableCell>{row.target}</TableCell>
									<TableCell>{row.verdict}</TableCell>
									<TableCell>{row.apca}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				))}
			</div>
		</div>
	);
}
