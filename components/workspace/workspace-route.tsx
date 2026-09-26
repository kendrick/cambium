'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';
import { isSchemaRejection, Outcome, RECORD_PARAM } from '@/components/stored-record';
import type { Shell as ShellComponent } from '@/components/workspace/shell';

/**
 * The landing route's read-back outcomes, for the same reasons: see `SavedRecord` in
 * `components/landing/landing-route.tsx` for why `unreadable` and `unavailable` stay apart. A
 * record with no versions is `found`, because the shell still has something true to show for it.
 *
 * `found` carries the shell component because it arrives by dynamic import alongside the store.
 */
type Loaded =
	| { kind: 'loading' }
	| { kind: 'found'; store: StoreApi<WorkspaceState>; Shell: typeof ShellComponent }
	| { kind: 'missing' }
	| { kind: 'unreadable' }
	| { kind: 'unavailable' };

const MESSAGES = {
	unnamed: <p className="text-sm">No record was named, so there is nothing to open here.</p>,
	missing: (
		<p className="text-sm">
			Nothing is stored under that id. Records live in this browser alone, so a link from another
			machine will not find one.
		</p>
	),
	unreadable: (
		<>
			<p className="text-sm">
				A record is stored under that id, but this version of Cambium could not read it. The usual
				cause is that a different version saved it.
			</p>
			<p className="text-muted-foreground text-sm">
				It is still in this browser. Clearing your browsing data is what would lose it.
			</p>
		</>
	),
	unavailable: (
		<>
			<p className="text-sm">
				Cambium could not look that record up, so this page cannot say whether it exists. Blocked
				site data, private browsing, and a dropped connection are the usual causes.
			</p>
			<p className="text-muted-foreground text-sm">Reloading is worth a try.</p>
		</>
	),
};

export function WorkspaceRoute() {
	const recordId = useSearchParams().get(RECORD_PARAM);
	const [loaded, setLoaded] = useState<{ id: string; result: Loaded } | null>(null);

	// Keyed on the id for the same reason the landing route keys its answer: a store built for the
	// record the address bar just left must never render as the current one.
	const current: Loaded = loaded?.id === recordId ? loaded.result : { kind: 'loading' };

	useEffect(() => {
		if (!recordId) return;

		let live = true;

		void (async () => {
			let result: Loaded;

			try {
				// All dynamic, and fetched together so none waits on another. Storage pulls in zod and the
				// engine pulls in culori, and neither belongs in first-load (ADR-0002). The store and the
				// shell are small, but base-ui's tabs and zustand's React binding are what put this page
				// over the first-load budget when they shipped with it.
				const [
					{ createIndexedDbRecordStore, closeIndexedDbRecordStore },
					{ createPerOperationRecordStore },
					{ createOklchScaleEngine },
					{ createWorkspaceStore },
					{ Shell },
				] = await Promise.all([
					import('../../app/storage/indexed-db-record-store'),
					import('../../app/storage/per-operation-record-store'),
					import('../../core/oklch-scale-engine'),
					import('../../app/state/workspace-store'),
					import('@/components/workspace/shell'),
				]);
				// A connection per call, closed as each one settles. The seed rail saves minutes or hours
				// after this read, and a connection held that long is what a later tab's upgrade would
				// hang behind: the landing route explains the missing `blocked` handler.
				const recordStore = createPerOperationRecordStore(
					createIndexedDbRecordStore,
					closeIndexedDbRecordStore,
				);

				try {
					const record = await recordStore.get(recordId);

					if (record) {
						const store = createWorkspaceStore({ recordStore, engine: createOklchScaleEngine() });
						store.getState().open(record);
						result = { kind: 'found', store, Shell };
					} else {
						result = { kind: 'missing' };
					}
				} catch (error) {
					result = isSchemaRejection(error) ? { kind: 'unreadable' } : { kind: 'unavailable' };
				}
			} catch {
				result = { kind: 'unavailable' };
			}

			if (live) setLoaded({ id: recordId, result });
		})();

		return () => {
			live = false;
		};
	}, [recordId]);

	if (!recordId) return <Terminal outcome="unnamed">{MESSAGES.unnamed}</Terminal>;

	if (current.kind === 'loading') {
		return <p className="text-muted-foreground p-8 text-sm">Opening that record…</p>;
	}

	if (current.kind === 'found') {
		const { Shell, store } = current;
		return <Shell store={store} />;
	}

	return <Terminal outcome={current.kind}>{MESSAGES[current.kind]}</Terminal>;
}

/**
 * The landing page's outcome, centred in a page of its own because no landing layout wraps it
 * here. `data-outcome` names which of the four terminal kinds rendered: a browser test has no
 * other way to tell them apart without reading copy, and the copy itself is free to change.
 */
function Terminal({
	outcome,
	children,
}: {
	outcome: keyof typeof MESSAGES;
	children: React.ReactNode;
}) {
	return (
		<main
			data-outcome={outcome}
			className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center p-8"
		>
			<Outcome action="Start a new brand">{children}</Outcome>
		</main>
	);
}
