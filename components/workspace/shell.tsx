'use client';

import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';
import { attributeContrastFailures } from '../../core/contrast/attribute';
import { buildTokenSet } from '../../core/semantic-layer';
import { RawResponse } from '@/components/workspace/raw-response';
import { SeedRail } from '@/components/workspace/seed-rail';
import { SkipLinks, type SkipTarget } from '@/components/workspace/skip-links';
import { TokenList } from '@/components/workspace/token-list';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';

// Its own chunk, apart from the shell's. The gallery brings base-ui's popover and the stylesheet
// export's checks, and none of that should hold up the token list, which renders without it.
const Preview = lazy(() =>
	import('@/components/workspace/preview/preview').then((module) => ({ default: module.Preview })),
);

// Also its own chunk. Preview already pulls in `globals-css`, `scheme-declarations` and
// `oklch-css`, and the store already carries `TokenSetSchema`, so the weight #29 actually adds is
// `toStylesheet`'s composition functions and the DTCG builders, not either adapter whole; nobody
// pays even that until opening this tab.
const ExportPanel = lazy(() =>
	import('@/components/workspace/export-panel').then((module) => ({ default: module.ExportPanel })),
);

const PREVIEW_LOADING = <p className="text-muted-foreground text-sm">Loading the preview…</p>;
const EXPORT_LOADING = <p className="text-muted-foreground text-sm">Loading the export panel…</p>;

type OutputTab = 'preview' | 'accessibility' | 'export';

/**
 * Loaded by `WorkspaceRoute` through a dynamic import, never statically. base-ui's tabs and
 * zustand's React binding put /workspace over the 200 kB first-load budget when they shipped with
 * the page, and nothing here can render before the record resolves anyway.
 */
export function Shell({ store }: { store: StoreApi<WorkspaceState> }) {
	const record = useStore(store, (state) => state.record);
	const activeOrdinal = useStore(store, (state) => state.activeOrdinal);
	const derived = useStore(store, (state) => state.derived);
	const tokenSet = useStore(store, (state) => state.tokenSet);
	const overrides = useStore(store, (state) => state.overrides);
	const overrideIssues = useStore(store, (state) => state.overrideIssues);
	const setOverride = useStore(store, (state) => state.setOverride);
	const clearOverride = useStore(store, (state) => state.clearOverride);
	const contrast = useStore(store, (state) => state.contrast);
	const draftSeed = useStore(store, (state) => state.draftSeed);

	const [tab, setTab] = useState<OutputTab>('preview');
	const panels = useRef<Partial<Record<OutputTab, HTMLDivElement | null>>>({});

	// `flushSync` so the panel is mounted and no longer `hidden` before `focus()` runs: base-ui
	// mounts an opening panel during the same render, and a plain `setTab` would leave the
	// focus call aiming at the previous commit.
	function skipTo(target: SkipTarget) {
		flushSync(() => setTab(target));
		panels.current[target]?.focus();
	}

	const active =
		record && activeOrdinal !== null ? (record.versions[activeOrdinal - 1] ?? null) : null;

	// `null` only means no tokens yet (see `ContrastState`), so a non-null report with nothing
	// failing is a distinct, and much more common, state worth its own message.
	const failingContrast = contrast?.report.filter((entry) => !entry.passes) ?? [];

	// The store keeps its repaired, pre-override base to itself, so the aliases an override replaced
	// are rebuilt here from the same ramps and seed. Only aliases are read off it, and repair never
	// moves one, so skipping the repair pass costs nothing in accuracy.
	const contrastByOverride = useMemo(() => {
		if (!tokenSet || !derived?.ok || !draftSeed) return {};
		// Only alias overrides get a verdict, and rebuilding the baseline is a second full derivation,
		// so skip it on the common keystroke where no alias is overridden.
		if (!Object.values(overrides).some((override) => override.kind === 'alias')) return {};
		return attributeContrastFailures(
			tokenSet,
			Object.values(overrides),
			buildTokenSet(derived.schemes, draftSeed),
		);
	}, [tokenSet, derived, draftSeed, overrides]);

	return (
		<main className="grid min-h-dvh grid-cols-1 gap-6 p-4 md:h-dvh md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto] md:p-6">
			<SkipLinks onSkip={skipTo} />
			{/* The issue keeps the rail to two sections, seed over tokens. The seed's field list scrolls
			    inside half the rail at most, so a fully stated seed can't push the token list off the
			    bottom of a short window. */}
			<aside aria-label="Seed and tokens" className="flex min-h-0 flex-col gap-4">
				<h1 className="text-2xl font-semibold tracking-tight">Cambium</h1>
				<div className="flex min-h-0 flex-col md:max-h-[50%]">
					<SeedRail store={store} />
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-2">
					<h2 id="tokens-heading" className="text-lg font-semibold">
						Tokens
					</h2>
					<TokenList
						headingId="tokens-heading"
						tokenSet={tokenSet}
						derived={derived}
						overrides={overrides}
						overrideIssues={overrideIssues}
						setOverride={setOverride}
						clearOverride={clearOverride}
						contrastByOverride={contrastByOverride}
					/>
				</div>
			</aside>

			<section id="output" aria-labelledby="output-heading" className="flex min-h-0 flex-col gap-2">
				<h2 id="output-heading" className="text-lg font-semibold">
					Output
				</h2>
				<Tabs
					value={tab}
					onValueChange={(value) => setTab(value as OutputTab)}
					className="min-h-0 flex-1"
				>
					{/* An accessible name is an accessibility contract, not copy: without one, a screen reader
					    announces "tab list" with nothing to say it's this page's Output tabs. */}
					<TabsList aria-label="Output">
						<TabsTab value="preview">Preview</TabsTab>
						<TabsTab value="accessibility">Accessibility</TabsTab>
						<TabsTab value="export">Export</TabsTab>
					</TabsList>
					<TabsPanel
						value="preview"
						ref={(node) => {
							panels.current.preview = node;
						}}
						className="flex min-h-0 flex-col p-2"
					>
						{tokenSet ? (
							<Suspense fallback={PREVIEW_LOADING}>
								<Preview tokenSet={tokenSet} />
							</Suspense>
						) : (
							<p className="text-muted-foreground text-sm">
								There are no tokens to preview yet. They show up here once the seed produces a token
								set.
							</p>
						)}
					</TabsPanel>
					<TabsPanel
						value="accessibility"
						ref={(node) => {
							panels.current.accessibility = node;
						}}
						className="text-muted-foreground p-2 text-sm"
					>
						{contrast === null ? (
							<p>
								There are no tokens to check yet. They show up here once the seed produces a token
								set.
							</p>
						) : failingContrast.length === 0 ? (
							<p>Every declared pair passes AA in both schemes.</p>
						) : (
							<ul className="list-none space-y-1">
								{failingContrast.map((entry) => (
									<li key={`${entry.scheme}-${entry.foreground}-${entry.background}`}>
										{`${entry.scheme}: ${entry.foreground} on ${entry.background}: ${entry.wcag.toFixed(2)}:1, needs ${entry.target}`}
									</li>
								))}
							</ul>
						)}
					</TabsPanel>
					<TabsPanel
						value="export"
						ref={(node) => {
							panels.current.export = node;
						}}
						className="flex min-h-0 flex-col p-2"
					>
						{tokenSet ? (
							<Suspense fallback={EXPORT_LOADING}>
								<ExportPanel store={store} />
							</Suspense>
						) : (
							<p className="text-muted-foreground text-sm">
								There are no tokens to export yet. They show up here once the seed produces a token
								set.
							</p>
						)}
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
