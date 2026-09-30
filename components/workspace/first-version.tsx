'use client';

import { lazy, Suspense } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';

// Lazy for the landing route's reason: only a record with no versions needs it, so no other
// workspace open should pay for the cost estimate and key dialog behind it. The build gives each
// route's lazy import its own copy of the panel and its dynamic dependencies, so this keeps the
// panel off first-load and off every open that has versions, while total JS pays for it twice.
const GeneratePanel = lazy(() =>
	import('@/components/landing/generate/generate-panel').then((module) => ({
		default: module.GeneratePanel,
	})),
);

// The workspace shows no key indicator, so there's nothing here to keep in step with the session.
function ignoreKeyStored() {}

/**
 * Whether `FirstVersion` renders for this record. Exported so the shell can name its rail landmark
 * after what the rail actually holds.
 */
export function showsFirstVersion(
	record: WorkspaceState['record'],
): record is NonNullable<WorkspaceState['record']> {
	return record !== null && record.versions.length === 0 && record.images.length > 0;
}

/**
 * The empty workspace's way to a first version (#158). Renders nothing once the record has a
 * version, because a second version from here is out of scope, and nothing for a record with no
 * images, which has nothing to send.
 */
export function FirstVersion({
	store,
	onBusyChange,
}: {
	store: StoreApi<WorkspaceState>;
	onBusyChange?: (busy: boolean) => void;
}) {
	const record = useStore(store, (state) => state.record);
	const open = useStore(store, (state) => state.open);

	if (!showsFirstVersion(record)) return null;

	// From md up the rail is exactly one window tall, so this section shares what the seed leaves
	// with the token region and scrolls inside that share. Left at its content height, it squeezed
	// the seed region to 12px at 768×400 and the seed's text painted over it (#179's review). The
	// 4px padding, pulled back by the margin, keeps the focus outline (2px at 2px offset) unclipped.
	return (
		<section
			aria-labelledby="first-version-heading"
			className="flex flex-col gap-2 md:-m-1 md:min-h-0 md:flex-1 md:overflow-y-auto md:p-1"
		>
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
					onBusyChange={onBusyChange}
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
