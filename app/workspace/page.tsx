import type { Metadata } from 'next';
import { Suspense } from 'react';

import { WorkspaceRoute } from '@/components/workspace/workspace-route';

/**
 * What the tab reads before a record loads, and on every terminal outcome. `WorkspaceRoute` puts the
 * record's own label in once it's found (#174), since static export has no record to name at build.
 */
export const metadata: Metadata = { title: 'Workspace · Cambium' };

/**
 * A Server Component for the same reason `app/page.tsx` is one: the client boundary starts at
 * `WorkspaceRoute`. The Suspense boundary is what lets `useSearchParams` build under static export.
 */
const LOADING = <p className="text-muted-foreground p-8 text-sm">Loading…</p>;

export default function Workspace() {
	return (
		<Suspense fallback={LOADING}>
			<WorkspaceRoute />
		</Suspense>
	);
}
