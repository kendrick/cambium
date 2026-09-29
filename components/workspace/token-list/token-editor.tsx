import { useState, type ComponentProps, type ReactNode } from 'react';

import type { OverrideIssue } from '../../../core/token-overrides';
import type { TokenProvenance } from '../../../core/token-set';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';

/** What the caller styles and wires on the trigger. The accessible name is the editor's to set. */
export type EditorTriggerProps = Omit<ComponentProps<typeof PopoverTrigger>, 'aria-label'> & {
	[attribute: `data-${string}`]: string | undefined;
};

export type TokenEditorProps = {
	/** The token's list id, e.g. `semantic.primary`, `primitive.brand.9`, `radius.md`. */
	id: string;
	provenance: TokenProvenance;
	stepRole?: string;
	overridden: boolean;
	onReset?: () => void;
	issues: OverrideIssue[];
	trigger: EditorTriggerProps;
	/** The token's edit controls. Mounted only while the popover is open. */
	children: ReactNode;
};

/**
 * One token's edit popover. Everything that costs a Tab stop (the controls, the rationale
 * disclosure, Reset) lives in here, so a row costs one stop for editing however much it edits.
 * A semantic row whose override breaks a pair still adds a second stop of its own, #153's Revert,
 * which stays on `TokenRow` rather than in here (see its docblock). Before #151 every control in
 * the list was its own stop. base-ui unmounts a closed popup, which is what keeps an alias
 * `<select>` holding every ramp step per semantic row out of the DOM until someone asks.
 */
export function TokenEditor({
	id,
	provenance,
	stepRole,
	overridden,
	onReset,
	issues,
	trigger,
	children,
}: TokenEditorProps) {
	const listed = listIssues(issues);

	return (
		<Popover>
			<PopoverTrigger
				{...trigger}
				// The issue list is inside the popup, so the name carries the fact that there is one. A
				// held override the current base rejects would otherwise go unannounced until opened.
				aria-label={listed.size > 0 ? `Edit ${id} (has issues)` : `Edit ${id}`}
			/>
			<PopoverContent align="start" className="w-80 gap-2" data-editor={id}>
				<div className="flex items-center gap-2">
					<PopoverTitle className="font-mono text-xs">{id}</PopoverTitle>
					{overridden ? <span className="text-xs font-medium">overridden</span> : null}
				</div>
				<span data-provenance className="text-muted-foreground text-xs">
					{provenance.provenance}
				</span>
				<p data-rationale className="text-muted-foreground truncate text-xs">
					{provenance.rationale}
				</p>
				<RationaleDisclosure id={id} provenance={provenance} stepRole={stepRole} />
				<div className="flex flex-wrap items-center gap-2">{children}</div>
				{onReset ? (
					<button
						type="button"
						aria-label={`Reset ${id}`}
						onClick={onReset}
						className="self-start text-xs underline"
					>
						Reset
					</button>
				) : null}
				{listed.size > 0 ? (
					<ul data-issues className="text-destructive text-xs">
						{[...listed].map(([key, message]) => (
							<li key={key}>{message}</li>
						))}
					</ul>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

/**
 * Named after its token rather than a bare "Why": a closed popover unmounts, so at most one of
 * these is ever in the DOM, but its name still has to stand alone for whatever found it without
 * the row's visual context: a screen reader's button list, "find", anything that skips straight
 * to the control. A button with `aria-expanded`, not `<details>`: #24's browser suite finds
 * `raw-response.tsx`'s `<details>` with a bare `page.locator('details')`.
 */
function RationaleDisclosure({
	id,
	provenance,
	stepRole,
}: {
	id: string;
	provenance: TokenProvenance;
	stepRole?: string;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<>
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setExpanded((value) => !value)}
				className="self-start text-xs underline"
			>
				Why {id}
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
		</>
	);
}

/**
 * A light-scheme edit is checked against the scheme and the top-level copy that mirrors it, so the
 * store refuses it once per copy, under paths that differ only by a leading `['schemes', 'light']`.
 * Keying on the path with that prefix stripped folds the two copies into one item. Keying on the
 * message alone would also fold two different refused fields that happen to share a message, and
 * the editor would stop saying the second one is refused.
 */
function listIssues(issues: OverrideIssue[]): Map<string, string> {
	const listed = new Map<string, string>();
	for (const issue of issues) {
		const path = issue.path[0] === 'schemes' ? issue.path.slice(2) : issue.path;
		listed.set(JSON.stringify([path, issue.message]), issue.message);
	}
	return listed;
}
