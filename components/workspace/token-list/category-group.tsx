import type { ReactNode } from 'react';

/**
 * One category's rows, headed by its name. `data-source="system"` is the hook the browser suite
 * checks against all five system-constant categories at once, per `core/system-constants.ts`. It
 * names where the values came from, so an override never moves it. A derived category carries no
 * `data-source` at all.
 *
 * `hasOverride` decides the label instead. An edited system category is still system-sourced but
 * no longer untouched, so `data-untouched` and "Untouched default" hold only while no row in it is
 * overridden. Once one is, the label reads "Default, edited", which keeps the origin without
 * contradicting the overridden row beneath it.
 */
export function CategoryGroup({
	name,
	source,
	hasOverride,
	children,
}: {
	name: string;
	source?: 'derived' | 'system';
	hasOverride?: boolean;
	children: ReactNode;
}) {
	const untouched = source === 'system' && !hasOverride;

	return (
		<section
			data-category={name}
			data-source={source === 'system' ? 'system' : undefined}
			data-untouched={untouched ? '' : undefined}
		>
			<div className="flex items-center gap-2">
				<h3 className="text-sm font-semibold">{name}</h3>
				{source === 'system' ? (
					<span className="text-muted-foreground text-xs">
						{untouched ? 'Untouched default' : 'Default, edited'}
					</span>
				) : null}
			</div>
			<ul className="flex flex-col">{children}</ul>
		</section>
	);
}
