import { useSyncExternalStore } from 'react';

// The complement of Tailwind v4's `md` query, `(width >= 48rem)`, and the same range its `max-md`
// variant compiles to, so the tab set this switches and every `md:` class flip at the same pixel.
// `e2e/workspace.spec.ts` checks both sides of the edge.
const NARROW = '(width < 48rem)';

function subscribe(onChange: () => void): () => void {
	const query = window.matchMedia(NARROW);
	query.addEventListener('change', onChange);
	return () => query.removeEventListener('change', onChange);
}

/**
 * `Shell` renders only on the client, after `WorkspaceRoute` has read the record, so the first
 * render already has the real width. React needs a server snapshot anyway, and that one never runs.
 */
export function useNarrowViewport(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(NARROW).matches,
		() => false,
	);
}
