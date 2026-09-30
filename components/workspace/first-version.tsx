'use client';

import { lazy, Suspense } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';

// Lazy for the landing route's reason: only a record with no versions needs it, so no other
// workspace open should pay for the cost estimate and key dialog behind it. Both routes import the
// same module, so the build emits one chunk they share.
const GeneratePanel = lazy(() =>
	import('@/components/landing/generate/generate-panel').then((module) => ({
		default: module.GeneratePanel,
	})),
);

// The workspace shows no key indicator, so there's nothing here to keep in step with the session.
function ignoreKeyStored() {}

/**
 * The empty workspace's way to a first version (#158). Renders nothing once the record has a
 * version, because a second version from here is out of scope, and nothing for a record with no
 * images, which has nothing to send.
 */
export function FirstVersion({ store }: { store: StoreApi<WorkspaceState> }) {
	const record = useStore(store, (state) => state.record);
	const open = useStore(store, (state) => state.open);

	if (!record || record.versions.length > 0 || record.images.length === 0) return null;

	return (
		<section aria-labelledby="first-version-heading" className="flex flex-col gap-2">
			<h2 id="first-version-heading" className="text-lg font-semibold">
				First version
			</h2>
			<p className="text-muted-foreground text-sm">
				Nothing has been generated from these images yet. Generating sends them to Anthropic with
				your own API key and saves what comes back as this brand&apos;s first version.
			</p>
			<Suspense fallback={null}>
				<GeneratePanel
					images={record.images}
					onKeyStored={ignoreKeyStored}
					// `open` takes the committed record the way `WorkspaceRoute` takes a loaded one: last
					// version active, draft reset, tokens rederived. Every rail subscriber rerenders off it.
					onGenerated={open}
					recordId={record.id}
				/>
			</Suspense>
		</section>
	);
}
