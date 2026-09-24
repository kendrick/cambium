import type { ReactNode } from 'react';

/**
 * One category's rows, headed by its name. `data-source="system"` is the hook the browser suite
 * checks against all five system-constant categories at once, per `core/system-constants.ts`; a
 * derived category carries no `data-source` at all rather than a `data-source="derived"` nobody
 * asked for.
 */
export function CategoryGroup({
	name,
	source,
	children,
}: {
	name: string;
	source?: 'derived' | 'system';
	children: ReactNode;
}) {
	return (
		<section data-category={name} data-source={source === 'system' ? 'system' : undefined}>
			<div className="flex items-center gap-2">
				<h3 className="text-sm font-semibold">{name}</h3>
				{source === 'system' ? (
					<span className="text-muted-foreground text-xs">Untouched default</span>
				) : null}
			</div>
			<ul className="flex flex-col">{children}</ul>
		</section>
	);
}
