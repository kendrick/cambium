import { useState, type ReactNode } from 'react';

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
 * The expand control is a button with `aria-expanded`, not a native `<details>`, on purpose: a list
 * can hold hundreds of these, and `raw-response.tsx`'s own `<details>` is the one #24's browser
 * suite locates with a bare `page.locator('details')`. A `<details>` here would leave that locator
 * matching one element among many wherever a real seed is loaded, which is a false collision this
 * component can dodge whether or not the tag would otherwise have suited it fine.
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
	children: ReactNode;
}) {
	const [expanded, setExpanded] = useState(false);

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

			<div className="flex flex-wrap items-center gap-2">
				{children}
				{onReset ? (
					<button type="button" onClick={onReset} className="text-xs underline">
						Reset
					</button>
				) : null}
			</div>

			{issues && issues.length > 0 ? (
				<ul data-issues className="text-destructive text-xs">
					{issues.map((issue) => (
						<li key={`${issue.path.join('.')}:${issue.message}`}>{issue.message}</li>
					))}
				</ul>
			) : null}
		</li>
	);
}
