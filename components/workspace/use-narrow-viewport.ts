import { useSyncExternalStore } from 'react';

// Tailwind v4's `max-md` range, spelled the way its `md` variant compiles, so the tab set this
// switches and every `md:` class in the workspace flip at the same pixel. `e2e/workspace.spec.ts`
// checks both sides of the edge.
const NARROW = '(width < 48rem)';

function subscribe(onChange: () => void): () => void {
	const query = window.matchMedia(NARROW);
	query.addEventListener('change', onChange);
	return () => query.removeEventListener('change', onChange);
}

/**
 * `Shell` renders only on the client, after `WorkspaceRoute` has read the record, so the first
 * render already has the real width. React needs a server snapshot anyway; it never runs.
 */
export function useNarrowViewport(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(NARROW).matches,
		() => false,
	);
}
