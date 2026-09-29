import { useId, useState, type ReactNode } from 'react';

/**
 * One category behind a disclosure. The caller brings the `<ul>`, since a ramp's strip of chips
 * isn't a list of rows.
 *
 * `data-source="system"` is the hook the browser suite checks against all five system-constant
 * categories at once, per `core/system-constants.ts`. It names where the values came from, so an
 * override never moves it. A derived category carries no `data-source` at all.
 *
 * `hasOverride` decides the label instead. An edited system category is still system-sourced but
 * no longer untouched, so `data-untouched` and "Untouched default" hold only while no row in it is
 * overridden. Once one is, the label reads "Default, edited", which keeps the origin without
 * contradicting the overridden row beneath it. The label sits outside the body, so a collapsed
 * category still says it.
 *
 * A button with `aria-expanded` rather than `<details>`, for the same `page.locator('details')`
 * reason `token-editor.tsx` gives. `defaultOpen` is read once: `TokenList` remounts the group
 * whenever a filter starts or stops, which is how a filter opens every category it matched.
 */
export function CategoryGroup({
	name,
	source,
	hasOverride,
	defaultOpen,
	children,
}: {
	name: string;
	source?: 'derived' | 'system';
	hasOverride?: boolean;
	defaultOpen: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const bodyId = useId();
	const untouched = source === 'system' && !hasOverride;

	return (
		<section
			data-category={name}
			data-source={source === 'system' ? 'system' : undefined}
			data-untouched={untouched ? '' : undefined}
		>
			<div className="flex items-center gap-2">
				<h3 className="text-sm font-semibold">
					<button
						type="button"
						aria-expanded={open}
						aria-controls={open ? bodyId : undefined}
						onClick={() => setOpen((value) => !value)}
					>
						{name}
					</button>
				</h3>
				{source === 'system' ? (
					<span className="text-muted-foreground text-xs">
						{untouched ? 'Untouched default' : 'Default, edited'}
					</span>
				) : null}
			</div>
			{open ? <div id={bodyId}>{children}</div> : null}
		</section>
	);
}
