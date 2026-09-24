import { Suspense } from 'react';

import { WorkspaceRoute } from '@/components/workspace/workspace-route';

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
