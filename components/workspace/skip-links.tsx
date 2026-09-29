export type SkipTarget = 'preview' | 'export';

const LINKS: readonly { target: SkipTarget; label: string }[] = [
	{ target: 'preview', label: 'Skip to preview' },
	{ target: 'export', label: 'Skip to export' },
];

/**
 * The first two Tab stops on the page, ahead of the seed rail and the token list, which together
 * held some 600 stops before #151 (WCAG 2.4.1). The nav is `fixed`, so it never takes a cell in
 * `Shell`'s grid, and each link stays `sr-only` until it has focus. The `href` has to stay: an
 * `<a>` without one has no link role and drops out of the Tab order. `onSkip` does the rest: it
 * has to select a tab, which a fragment can't.
 */
export function SkipLinks({ onSkip }: { onSkip: (target: SkipTarget) => void }) {
	return (
		<nav aria-label="Skip links" className="fixed top-2 left-2 z-50 flex gap-2">
			{LINKS.map(({ target, label }) => (
				<a
					key={target}
					href="#output"
					onClick={(event) => {
						event.preventDefault();
						onSkip(target);
					}}
					className="focus:bg-background sr-only focus:not-sr-only focus:rounded focus:border focus:px-3 focus:py-2 focus:text-sm"
				>
					{label}
				</a>
			))}
		</nav>
	);
}
