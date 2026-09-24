'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';
import { RawResponse } from '@/components/workspace/raw-response';
import { SeedRail } from '@/components/workspace/seed-rail';
import { TokenList } from '@/components/workspace/token-list';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';

/**
 * Loaded by `WorkspaceRoute` through a dynamic import, never statically. base-ui's tabs and
 * zustand's React binding put /workspace over the 200 kB first-load budget when they shipped with
 * the page, and nothing here can render before the record resolves anyway.
 */
export function Shell({ store }: { store: StoreApi<WorkspaceState> }) {
	const record = useStore(store, (state) => state.record);
	const activeOrdinal = useStore(store, (state) => state.activeOrdinal);
	const draftSeed = useStore(store, (state) => state.draftSeed);
	const preset = useStore(store, (state) => state.preset);
	const derived = useStore(store, (state) => state.derived);
	const selectPreset = useStore(store, (state) => state.selectPreset);

	const active =
		record && activeOrdinal !== null ? (record.versions[activeOrdinal - 1] ?? null) : null;

	return (
		<main className="grid min-h-dvh grid-cols-1 gap-6 p-4 md:h-dvh md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto] md:p-6">
			{/* The issue keeps the rail to two sections, seed over tokens, so the rail's own height goes
			    to the token scroller and nothing else. */}
			<aside aria-label="Seed and tokens" className="flex min-h-0 flex-col gap-4">
				<h1 className="text-2xl font-semibold tracking-tight">Cambium</h1>
				<div className="shrink-0">
					<SeedRail seed={draftSeed} preset={preset} onSelectPreset={selectPreset} />
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
					{/* An accessible name is an accessibility contract, not copy: without one, a screen reader
					    announces "tab list" with nothing to say it's this page's Output tabs. */}
					<TabsList aria-label="Output">
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

			{/* Its own grid row under both columns, sized to its content, so opening it takes height from
			    the row above and the token list keeps scrolling inside what's left. */}
			{active ? (
				<div className="md:col-span-2">
					<RawResponse rawResponse={active.rawResponse} />
				</div>
			) : null}
		</main>
	);
}
