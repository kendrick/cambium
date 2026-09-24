'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import { createWorkspaceStore, type WorkspaceState } from '../../app/state/workspace-store';
import { RawResponse } from '@/components/workspace/raw-response';
import { SeedRail } from '@/components/workspace/seed-rail';
import { TokenList } from '@/components/workspace/token-list';
import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';

/** The same parameter the landing route writes after a save, so its link lands here intact. */
const RECORD_PARAM = 'record';

/**
 * The landing route's read-back outcomes, for the same reasons: see `SavedRecord` in
 * `components/landing/landing-route.tsx` for why `unreadable` and `unavailable` stay apart. A
 * record with no versions is `found`, because the shell still has something true to show for it.
 */
type Loaded =
	| { kind: 'loading' }
	| { kind: 'found'; store: StoreApi<WorkspaceState> }
	| { kind: 'missing' }
	| { kind: 'unreadable' }
	| { kind: 'unavailable' };

/**
 * A copy of `isSchemaRejection` in `components/landing/landing-route.tsx`, which doesn't export it.
 * Its docblock carries the reasoning, including why this can't be a zod `instanceof`.
 */
function isSchemaRejection(error: unknown): boolean {
	return Array.isArray((error as { issues?: unknown } | null | undefined)?.issues);
}

function Outcome({ children }: { children: React.ReactNode }) {
	return (
		<main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-4 p-8">
			{children}
			<Link className={buttonVariants({ variant: 'outline' })} href="/">
				Start a new brand
			</Link>
		</main>
	);
}

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
				// Both dynamic. Storage pulls in zod and the engine pulls in culori, and neither belongs
				// in first-load (ADR-0002). The store module itself is only zustand and a constant.
				const [
					{ createIndexedDbRecordStore, closeIndexedDbRecordStore },
					{ createOklchScaleEngine },
				] = await Promise.all([
					import('../../app/storage/indexed-db-record-store'),
					import('../../core/oklch-scale-engine'),
				]);
				const recordStore = await createIndexedDbRecordStore();

				try {
					const record = await recordStore.get(recordId);

					if (record) {
						// The workspace gets a record store whose connection `finally` is about to close.
						// Nothing in this shell commits, and a commit on a closed connection rejects rather
						// than writing anywhere, so this is safe until #25 adds one. That ticket has to
						// decide how long the connection lives; the landing route explains why holding
						// one open for the tab's lifetime risks a `blocked` hang.
						const store = createWorkspaceStore({ recordStore, engine: createOklchScaleEngine() });
						store.getState().open(record);
						result = { kind: 'found', store };
					} else {
						result = { kind: 'missing' };
					}
				} catch (error) {
					result = isSchemaRejection(error) ? { kind: 'unreadable' } : { kind: 'unavailable' };
				} finally {
					closeIndexedDbRecordStore(recordStore);
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

	if (!recordId) {
		return (
			<Outcome>
				<p className="text-sm">No record was named, so there is nothing to open here.</p>
			</Outcome>
		);
	}

	if (current.kind === 'loading') {
		return <p className="text-muted-foreground p-8 text-sm">Opening that record…</p>;
	}

	if (current.kind === 'missing') {
		return (
			<Outcome>
				<p className="text-sm">
					Nothing is stored under that id. Records live in this browser alone, so a link from
					another machine will not find one.
				</p>
			</Outcome>
		);
	}

	if (current.kind === 'unreadable') {
		return (
			<Outcome>
				<p className="text-sm">
					A record is stored under that id, but this version of Cambium could not read it. The usual
					cause is that a different version saved it.
				</p>
				<p className="text-muted-foreground text-sm">
					It is still in this browser. Clearing your browsing data is what would lose it.
				</p>
			</Outcome>
		);
	}

	if (current.kind === 'unavailable') {
		return (
			<Outcome>
				<p className="text-sm">
					Cambium could not look that record up, so this page cannot say whether it exists. Blocked
					site data, private browsing, and a dropped connection are the usual causes.
				</p>
				<p className="text-muted-foreground text-sm">Reloading is worth a try.</p>
			</Outcome>
		);
	}

	return <Shell store={current.store} />;
}

function Shell({ store }: { store: StoreApi<WorkspaceState> }) {
	const record = useStore(store, (state) => state.record);
	const activeOrdinal = useStore(store, (state) => state.activeOrdinal);
	const draftSeed = useStore(store, (state) => state.draftSeed);
	const preset = useStore(store, (state) => state.preset);
	const derived = useStore(store, (state) => state.derived);
	const selectPreset = useStore(store, (state) => state.selectPreset);

	const active =
		record && activeOrdinal !== null ? (record.versions[activeOrdinal - 1] ?? null) : null;

	return (
		<main className="grid min-h-dvh grid-cols-1 gap-6 p-4 md:h-dvh md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] md:p-6">
			<aside aria-label="Seed and tokens" className="flex min-h-0 flex-col gap-4">
				<h1 className="text-2xl font-semibold tracking-tight">Cambium</h1>
				<div className="flex shrink-0 flex-col gap-3">
					<SeedRail seed={draftSeed} preset={preset} onSelectPreset={selectPreset} />
					{active ? <RawResponse rawResponse={active.rawResponse} /> : null}
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-2">
					<h2 id="tokens-heading" className="text-lg font-semibold">
						Tokens
					</h2>
					{/* Focusable because it scrolls on its own. Chromium and Firefox let a keyboard reach a
					    scroller without this, Safari doesn't, and the rule below can't see the overflow. */}
					<section
						// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
						tabIndex={0}
						aria-labelledby="tokens-heading"
						className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto rounded border p-2 md:max-h-none"
					>
						<TokenList derived={derived} />
					</section>
				</div>
			</aside>

			<section aria-label="Output" className="flex min-h-0 flex-col">
				<Tabs defaultValue="preview" className="min-h-0 flex-1">
					<TabsList>
						<TabsTab value="preview">Preview</TabsTab>
						<TabsTab value="accessibility">Accessibility</TabsTab>
						<TabsTab value="export">Export</TabsTab>
					</TabsList>
					{/* Empty until #28, #27 and #29 fill them. */}
					<TabsPanel value="preview" className="text-muted-foreground p-2 text-sm">
						The preview is not built yet.
					</TabsPanel>
					<TabsPanel value="accessibility" className="text-muted-foreground p-2 text-sm">
						The accessibility report is not built yet.
					</TabsPanel>
					<TabsPanel value="export" className="text-muted-foreground p-2 text-sm">
						Export is not built yet.
					</TabsPanel>
				</Tabs>
			</section>
		</main>
	);
}
