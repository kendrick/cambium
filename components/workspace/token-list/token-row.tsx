import { useRef, useState, type ReactNode } from 'react';

import type { OverrideIssue } from '../../../core/token-overrides';
import type { TokenProvenance } from '../../../core/token-set';

/**
 * One token's row: its value (via `children`, which differs by kind), provenance, a one-line
 * rationale truncated by CSS, and an expand control that reveals the untruncated rationale plus
 * everything `provenance` and `stepRole` know. `data-overridden` and the reset control only appear
 * when the override map actually holds this token, whether or not the current base still accepts
 * it. A held-but-now-invalid override is still the user's edit, and `issues` is how it says why it
 * is not taking effect.
 *
 * `swatch` prints as text beside the chip as well. A semantic row's only control is its alias
 * `<select>`, so without the text that row would show no colour value a reader could copy.
 *
 * The expand control is a button with `aria-expanded`, not a native `<details>`. #24's browser
 * suite finds `raw-response.tsx`'s own `<details>` with a bare `page.locator('details')`, and a
 * `<details>` per row would add a match for each of the hundreds of rows a real seed loads.
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
	swatch?: string;
	overridden: boolean;
	onReset?: () => void;
	issues?: OverrideIssue[];
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
	const [expanded, setExpanded] = useState(false);
	const controls = useRef<HTMLDivElement>(null);
	const revertable = Boolean(contrastFailures && contrastFailures.length > 0 && onReset);
	// A light-scheme edit is checked against the scheme and the top-level copy that mirrors it, so
	// the store refuses it once per copy, under paths that differ only by a leading
	// `['schemes', 'light']`. Keying on the path with that prefix stripped folds the two copies into
	// one item. Keying on the message alone would also fold two different refused fields that happen
	// to share a message, and the row would stop saying the second one is refused.
	const listed = new Map<string, string>();
	for (const issue of issues ?? []) {
		const path = issue.path[0] === 'schemes' ? issue.path.slice(2) : issue.path;
		listed.set(JSON.stringify([path, issue.message]), issue.message);
	}

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
						style={{ backgroundColor: swatch }}
					/>
				) : null}
				{swatch ? (
					<span data-swatch-value className="font-mono text-xs">
						{swatch}
					</span>
				) : null}
				<span className="font-mono text-xs">{id}</span>
				<span className="text-muted-foreground text-xs">{provenance.provenance}</span>
				{resolvesTo ? (
					<span data-resolves-to={resolvesTo} className="text-muted-foreground text-xs">
						resolves to {resolvesTo}
					</span>
				) : null}
				{overridden ? <span className="text-xs font-medium">overridden</span> : null}
			</div>

			<p className="text-muted-foreground truncate text-xs">{provenance.rationale}</p>

			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setExpanded((value) => !value)}
				className="self-start text-xs underline"
			>
				{expanded ? 'Less' : 'More'}
			</button>
			{expanded ? (
				<div data-rationale-expanded className="flex flex-col gap-1 pl-2 text-xs">
					<p>{provenance.rationale}</p>
					<p className="text-muted-foreground">
						{provenance.seedField
							? `From the seed's ${provenance.seedField}`
							: 'Not traced to a seed field'}
					</p>
					{stepRole ? <p className="text-muted-foreground">{stepRole}</p> : null}
				</div>
			) : null}

			<div ref={controls} className="flex flex-wrap items-center gap-2">
				{children}
				{/* Revert and Reset both clear the override, so a row shows only one of them. */}
				{onReset && !revertable ? (
					<button type="button" onClick={onReset} className="text-xs underline">
						Reset
					</button>
				) : null}
			</div>

			{contrastFailures ? (
				<output aria-live="polite" className="text-destructive block text-xs">
					{contrastFailures.length > 0 ? (
						<ul data-contrast-verdict>
							{contrastFailures.map((failure) => (
								<li key={failure.label}>
									{failure.label}: {failure.wcag.toFixed(2)}:1, needs {failure.target}
								</li>
							))}
						</ul>
					) : null}
				</output>
			) : null}
			{revertable ? (
				<button
					type="button"
					onClick={() => {
						onReset?.();
						// The button unmounts with the verdict it sat beside, which would drop focus to
						// `<body>`; the alias control is where the person was working.
						controls.current?.querySelector<HTMLElement>('select, input')?.focus();
					}}
					className="text-destructive self-start text-xs underline"
				>
					Revert{revertLabel ? <span className="sr-only"> {revertLabel}</span> : null}
				</button>
			) : null}

			{listed.size > 0 ? (
				<ul data-issues className="text-destructive text-xs">
					{[...listed].map(([key, message]) => (
						<li key={key}>{message}</li>
					))}
				</ul>
			) : null}
		</li>
	);
}
