import { useRef, type ReactNode } from 'react';

import type { TokenProvenance } from '../../../core/token-set';
import type { Swatch } from './format';
import { type ListedIssue, TokenEditor } from './token-editor';

/**
 * One semantic or non-colour token as a list row: what it is and what it resolves to, readable at
 * a glance, with the "Edit" trigger as its one stop. A semantic row whose override breaks a
 * pair gets a second, #153's Revert below. The controls in `children`, the full rationale, Reset
 * and any issues all live in that trigger's `TokenEditor`. `data-overridden` marks the row
 * whenever the override map holds this token, whether or not the current base still accepts it.
 *
 * `swatch` prints as text beside the chip as well, so a row shows a colour value a reader can copy
 * without opening anything. It prints `swatch.text`, rounded for reading, while the chip paints
 * `swatch.paint`.
 *
 * A semantic row's AA verdict (#153) and its Revert stay here rather than in the popover: the
 * verdict has to show without opening anything, and its live region has to be mounted before the
 * first verdict for a screen reader to announce it. The popover unmounts on close.
 */
export function TokenRow({
	id,
	provenance,
	resolvesTo,
	stepRole,
	swatch,
	overridden,
	onReset,
	issues,
	contrastFailures,
	revertLabel,
	children,
}: {
	id: string;
	provenance: TokenProvenance;
	resolvesTo?: string;
	stepRole?: string;
	swatch?: Swatch;
	overridden: boolean;
	onReset?: () => void;
	issues: ListedIssue[];
	/**
	 * Only a semantic row passes this, as an empty list until its override breaks a pair. The live
	 * region renders whenever this is defined, because screen readers skip a live region that mounts
	 * with its content already inside.
	 */
	contrastFailures?: { label: string; wcag: number; target: number }[];
	/** Finishes the Revert button's accessible name, "Revert background override", for screen readers. */
	revertLabel?: string;
	children: ReactNode;
}) {
	const editTrigger = useRef<HTMLButtonElement>(null);
	const revertable = Boolean(contrastFailures && contrastFailures.length > 0 && onReset);

	return (
		<li
			data-token={id}
			data-overridden={overridden ? '' : undefined}
			className="flex flex-col gap-1 border-b py-2 last:border-b-0"
		>
			<div className="flex flex-wrap items-center gap-2">
				{swatch ? (
					<span
						aria-hidden
						data-swatch
						className="size-4 shrink-0 rounded border"
						style={{ backgroundColor: swatch.paint }}
					/>
				) : null}
				<span className="font-mono text-xs">{id}</span>
				{resolvesTo ? (
					<span data-resolves-to={resolvesTo} className="text-muted-foreground text-xs">
						resolves to {resolvesTo}
					</span>
				) : null}
				{overridden ? <span className="text-xs font-medium">overridden</span> : null}
				<TokenEditor
					id={id}
					provenance={provenance}
					stepRole={stepRole}
					overridden={overridden}
					onReset={onReset}
					issues={issues}
					trigger={{ ref: editTrigger, className: 'ml-auto text-xs underline', children: 'Edit' }}
				>
					{children}
				</TokenEditor>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{swatch ? (
					<span data-swatch-value className="font-mono text-xs">
						{swatch.text}
					</span>
				) : null}
				<span className="text-muted-foreground text-xs">{provenance.provenance}</span>
			</div>
			<p className="text-muted-foreground truncate text-xs">{provenance.rationale}</p>

			{contrastFailures ? (
				// <output> is the live region (its implicit role is status), and it admits only phrasing
				// content, so each failing pair is a block-level span rather than a list item.
				<output aria-live="polite" className="text-destructive block text-xs">
					{contrastFailures.length > 0 ? (
						<span data-contrast-verdict className="block">
							{contrastFailures.map((failure) => (
								<span key={failure.label} data-contrast-line className="block">
									{failure.label}: {failure.wcag.toFixed(2)}:1, needs {failure.target}
								</span>
							))}
						</span>
					) : null}
				</output>
			) : null}
			{/* Reset lives in the popover, so the row itself never shows both. */}
			{revertable ? (
				<button
					type="button"
					onClick={() => {
						onReset?.();
						// The button unmounts with the verdict it sat beside, which would drop focus to
						// `<body>`. The alias select only exists while the popover is open, so the Edit
						// trigger that opens it is the nearest place the person was working.
						editTrigger.current?.focus();
					}}
					className="text-destructive self-start text-xs underline"
				>
					Revert{revertLabel ? <span className="sr-only"> {revertLabel}</span> : null}
				</button>
			) : null}
		</li>
	);
}
