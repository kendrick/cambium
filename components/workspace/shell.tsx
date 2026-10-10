'use client';

import { cn } from 'cn';
import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';
import { attributeContrastFailures } from '../../core/contrast/attribute';
import { buildTokenSet } from '../../core/semantic-layer';
import type { SchemeName } from '../../core/token-overrides';
import { AccessibilityPanel } from '@/components/workspace/accessibility/accessibility-panel';
import { FirstVersion, showsFirstVersion } from '@/components/workspace/first-version';
import { RawResponse } from '@/components/workspace/raw-response';
import { SchemeControl } from '@/components/workspace/scheme-control';
import { SEED_HEADING_ID, SeedRail } from '@/components/workspace/seed-rail';
import { SkipLinks, type SkipTarget } from '@/components/workspace/skip-links';
import { TokenList } from '@/components/workspace/token-list';
import { useNarrowViewport } from '@/components/workspace/use-narrow-viewport';
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

/** Below md the whole workspace is one tab set, so Seed and Tokens join the Output tabs. */
type WorkspaceTab = 'seed' | 'tokens' | OutputTab;

function isOutputTab(tab: WorkspaceTab): tab is OutputTab {
	return tab !== 'seed' && tab !== 'tokens';
}

type FocusColumn = 'seed' | 'tokens' | 'output';

/**
 * Where keyboard focus sat when `Shell` swapped layouts, in terms both layouts render alike (#174).
 * The element can't carry over, since crossing 48rem remounts everything, and ids are no help:
 * base-ui's come from `useId`, which differs between two trees that nest a component at different
 * depths. The row hooks below come from the same components in both layouts, so a control's index
 * inside its row carries over. When nothing matches, `column` picks the fallback: the Seed or Tokens
 * heading, or for Output the selected Output tab's panel (Preview's when no Output tab is selected).
 */
type FocusKey = { column: FocusColumn } & (
	| { kind: 'row'; row: string; index: number }
	| { kind: 'named'; tag: string; name: string }
	| { kind: 'column' }
);

/** Innermost first: a token row sits inside a category group. */
const ROW_HOOKS = ['data-seed-field', 'data-token', 'data-ramp', 'data-category'] as const;

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/** The accessible name, close enough to find a control's twin in the other layout. */
function nameOf(node: Element): string {
	const label = node.getAttribute('aria-label');
	if (label) return label;
	const labels =
		node instanceof HTMLInputElement || node instanceof HTMLSelectElement ? node.labels : null;
	return ((labels?.[0] ?? node).textContent ?? '').trim();
}

function columnOf(node: Element, tab: WorkspaceTab): FocusColumn {
	if (
		node.closest(
			`[aria-labelledby="${SEED_HEADING_ID}"], [aria-labelledby="first-version-heading"]`,
		)
	) {
		return 'seed';
	}
	if (node.id === 'tokens-heading' || node.closest('[aria-labelledby="tokens-heading"]')) {
		return 'tokens';
	}
	// A phone bar tab stands for the panel it had selected.
	if (node.closest('[data-workspace-bar]') && !isOutputTab(tab)) return tab;
	return 'output';
}

function focusKey(active: Element | null, tab: WorkspaceTab): FocusKey | null {
	if (!(active instanceof HTMLElement) || active === document.body) return null;

	if (!active.closest('main')) {
		// A popover renders outside `<main>` and unmounts with its trigger, so the trigger stands in.
		const trigger = active.closest('[role="dialog"]')
			? document.querySelector('main [data-popup-open]')
			: null;
		return trigger ? focusKey(trigger, tab) : null;
	}

	const column = columnOf(active, tab);
	for (const hook of ROW_HOOKS) {
		const row = active.closest(`[${hook}]`);
		const index = row ? [...row.querySelectorAll(FOCUSABLE)].indexOf(active) : -1;
		if (row && index >= 0) {
			return {
				column,
				kind: 'row',
				row: `[${hook}="${CSS.escape(row.getAttribute(hook) ?? '')}"]`,
				index,
			};
		}
	}
	return { column, kind: 'named', tag: active.tagName, name: nameOf(active) };
}

function findFocusTarget(key: FocusKey, main: HTMLElement): HTMLElement | null {
	if (key.kind === 'column') return null;
	if (key.kind === 'row') {
		return main.querySelector(key.row)?.querySelectorAll<HTMLElement>(FOCUSABLE)[key.index] ?? null;
	}
	if (key.name === '') return null;
	return (
		[...main.querySelectorAll<HTMLElement>(key.tag)].find((node) => nameOf(node) === key.name) ??
		null
	);
}

// The Output tabs, once for both layouts, so the phone list can't drift from the desktop one.
function outputTabs(className?: string) {
	return (
		<>
			<TabsTab value="preview" className={className}>
				Preview
			</TabsTab>
			<TabsTab value="accessibility" className={className}>
				Accessibility
			</TabsTab>
			<TabsTab value="export" className={className}>
				Export
			</TabsTab>
		</>
	);
}

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
	const draftSeed = useStore(store, (state) => state.draftSeed);

	const viewportNarrow = useNarrowViewport();
	// Swapping layouts unmounts FirstVersion and its panel. Mid-generate, the panel would drop the
	// reply, so the paid version would land in IndexedDB but never reach the store, and Generate would
	// come back on a record that already has one. After a failure, the remount would drop the notice
	// before anyone read it, along with its Retry, its paid answer, its billing warning or its
	// reopened key dialog. So the layout holds still while the panel reports busy, which is a generate
	// in flight, the key dialog open, or any failure notice showing, then catches up with the viewport.
	// It's state set during render, not an effect, so the catch-up never paints a stale frame.
	const [generating, setGenerating] = useState(false);
	const [narrow, setNarrow] = useState(viewportNarrow);
	// A phone opens on Seed, the first tab and where the stacked page used to start. Desktop keeps
	// opening Output on Preview.
	const [tab, setTab] = useState<WorkspaceTab>(() => (narrow ? 'seed' : 'preview'));
	const [pendingFocus, setPendingFocus] = useState<FocusKey | null>(null);
	// Whether the swap now pending was held back, which changes what a swap from `<body>` means.
	const [held, setHeld] = useState(false);
	const behind = narrow !== viewportNarrow;
	if (behind && generating && !held) setHeld(true);
	if (!behind && held) setHeld(false);
	if (behind && !generating) {
		// Read in the render that swaps layouts, the last moment the focused control is still in the
		// DOM (#174). Not at the media query change: a hold can put the swap long after it. What ends a
		// hold can also unmount the focused control first: an updated key clears the dialog and the
		// notice in one commit, and the release comes after (#186). Focus is on `<body>` by then, so a
		// held swap falls back to the seed heading, next to the panel that held it.
		setPendingFocus(
			focusKey(document.activeElement, tab) ?? (held ? { column: 'seed', kind: 'column' } : null),
		);
		setHeld(false);
		setNarrow(viewportNarrow);
	}
	const mainRoot = useRef<HTMLElement | null>(null);
	// Here rather than in the store: nothing outside Shell's own subtree reads it, and it isn't saved.
	const [scheme, setScheme] = useState<SchemeName>('light');
	const panels = useRef<Partial<Record<WorkspaceTab, HTMLDivElement | null>>>({});
	const phoneTabs = useRef<HTMLDivElement | null>(null);
	const bar = useRef<HTMLDivElement | null>(null);

	// `flushSync` so the panel is mounted and no longer `hidden` before `focus()` runs: base-ui
	// mounts an opening panel during the same render, and a plain `setTab` would leave the
	// focus call aiming at the previous commit.
	function skipTo(target: SkipTarget) {
		flushSync(() => setTab(target));
		panels.current[target]?.focus();
	}

	function selectPhoneTab(next: WorkspaceTab) {
		setTab(next);
		const root = phoneTabs.current;
		if (!root) return;
		// Once the bar has stuck, the page sits deep in the old panel. Snap back to where the bar
		// docks, so the new panel opens at its own top rather than wherever the old one left off.
		const docked = root.getBoundingClientRect().top + window.scrollY;
		if (window.scrollY > docked) window.scrollTo({ top: docked });
	}

	// The swap unmounted the focused control, so focus sits on `<body>` (#174). Give it to the same
	// control in the new layout, or else its column's fallback (the Seed or Tokens heading, or the
	// selected Output panel, Preview's by default), or else the page `h1`. Below md, a control in an
	// unselected Seed or Tokens panel is `hidden` and can't take focus, so select that tab first and
	// finish after the commit. Focus somebody already moved elsewhere stays where it is.
	useLayoutEffect(() => {
		if (!pendingFocus) return;
		const main = mainRoot.current;
		const active = document.activeElement;
		if (!main || (active !== null && active !== document.body)) {
			setPendingFocus(null);
			return;
		}

		const heading =
			pendingFocus.column === 'seed'
				? document.getElementById(SEED_HEADING_ID)
				: pendingFocus.column === 'tokens'
					? document.getElementById('tokens-heading')
					: (panels.current[isOutputTab(tab) ? tab : 'preview'] ?? null);
		const target =
			findFocusTarget(pendingFocus, main) ?? heading ?? main.querySelector<HTMLElement>('h1');
		if (!target) {
			setPendingFocus(null);
			return;
		}

		if (narrow) {
			const home = (['seed', 'tokens'] as const).find((value) =>
				panels.current[value]?.contains(target),
			);
			if (home && home !== tab) {
				setTab(home);
				return;
			}
		}

		target.focus();
		setPendingFocus(null);
	}, [pendingFocus, narrow, tab]);

	// A first version generated on the landing page ends in a route change that unmounts the status
	// line holding focus, so focus arrives here on `<body>` (#186). The seed heading takes it, the
	// same destination a first version generated in the workspace gets. A cold load also starts on
	// `<body>`, but nothing dropped there, and taking focus would put the first Tab past the skip
	// links. The document's own load URL tells the two apart: only a client-side route change has
	// moved the address on since.
	useLayoutEffect(() => {
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		const [load] = performance.getEntriesByType('navigation');
		if (!load || load.name === window.location.href) return;
		document.getElementById(SEED_HEADING_ID)?.focus();
	}, []);

	// Below md the bar is sticky and opaque, so a control the browser scrolls to the top edge, as
	// Shift+Tab does, would land under it (WCAG 2.4.11, #174). The page is the only scroller here, so
	// its scroll padding is what focus scrolling stops short of. Measured, since the tabs wrap on a
	// narrow screen and the scheme row comes and goes with the token set, and set on `<html>` directly
	// so this branch mounting stays the one below-md condition.
	useLayoutEffect(() => {
		const node = bar.current;
		if (!narrow || !node) return;

		const page = document.documentElement;
		const reserve = () => {
			page.style.scrollPaddingTop = `${Math.ceil(node.getBoundingClientRect().height)}px`;
		};
		reserve();
		const observer = new ResizeObserver(reserve);
		observer.observe(node);
		return () => {
			observer.disconnect();
			page.style.removeProperty('scroll-padding-top');
		};
	}, [narrow]);

	const active =
		record && activeOrdinal !== null ? (record.versions[activeOrdinal - 1] ?? null) : null;

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

	// Built once and placed by whichever layout is mounted. Only one layout mounts at a time, so
	// each panel, id, ref, lazy chunk and scheme control exists once in the DOM at any width. It
	// also means crossing 768px, on a rotated tablet or a resized window, remounts everything, so
	// the token filter and open categories don't survive it. Focus does: the render that swaps
	// records where it was, and the layout effect above focuses the same control in the new layout.
	// The swap waits while a first-version generate is in flight, its key dialog is open, or any
	// failure notice shows, and catches up once that clears.
	const seedColumn = (
		<>
			{/* The seed's field list scrolls inside half the rail at most from md up, so a fully stated
			    seed can't push the token list off the bottom of a short window. A record with no
			    versions also gets a First version section after it, outside that cap (#158), and its
			    busy reports are what hold the layout above. */}
			<div className="flex min-h-0 flex-col md:max-h-[50%]">
				<SeedRail store={store} />
			</div>
			<FirstVersion onBusyChange={setGenerating} store={store} />
		</>
	);

	const tokensColumn = (
		<div className="flex min-h-0 flex-1 flex-col gap-2">
			<h2 id="tokens-heading" tabIndex={-1} className="text-lg font-semibold">
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
				scheme={scheme}
			/>
		</div>
	);

	const rawResponse = active ? <RawResponse rawResponse={active.rawResponse} /> : null;

	const schemeControl = tokenSet ? (
		<SchemeControl scheme={scheme} onSchemeChange={setScheme} />
	) : null;

	// `heading` is for the phone layout, where no Output h2 sits above the panels. Without one there,
	// Preview jumps from the page h1 straight to the gallery's h3s and axe flags heading-order.
	function outputPanels(padding: string, heading = false) {
		return (
			<>
				<TabsPanel
					value="preview"
					ref={(node) => {
						panels.current.preview = node;
					}}
					className={cn('flex min-h-0 flex-col', padding)}
				>
					{heading ? <h2 className="sr-only">Preview</h2> : null}
					{tokenSet ? (
						<Suspense fallback={PREVIEW_LOADING}>
							<Preview tokenSet={tokenSet} scheme={scheme} />
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
					className={cn('text-muted-foreground text-sm', padding)}
				>
					{heading ? <h2 className="sr-only">Accessibility</h2> : null}
					<AccessibilityPanel store={store} attributed={contrastByOverride} />
				</TabsPanel>
				<TabsPanel
					value="export"
					ref={(node) => {
						panels.current.export = node;
					}}
					className={cn('flex min-h-0 flex-col', padding)}
				>
					{heading ? <h2 className="sr-only">Export</h2> : null}
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
			</>
		);
	}

	if (!narrow) {
		return (
			<main
				ref={mainRoot}
				className="grid min-h-dvh grid-cols-1 gap-6 p-4 md:h-dvh md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto] md:p-6"
			>
				<SkipLinks onSkip={skipTo} />
				{/* Seed over tokens, with #158's First version section between them for a record with
				    no versions. */}
				<aside
					aria-label={
						showsFirstVersion(record) ? 'Seed, first version and tokens' : 'Seed and tokens'
					}
					className="flex min-h-0 flex-col gap-4"
				>
					<h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight">
						Cambium
					</h1>
					{seedColumn}
					{tokensColumn}
				</aside>

				<section
					id="output"
					aria-labelledby="output-heading"
					className="flex min-h-0 flex-col gap-2"
				>
					<div data-output-header className="flex flex-wrap items-center justify-between gap-2">
						<h2 id="output-heading" className="text-lg font-semibold">
							Output
						</h2>
						{schemeControl}
					</div>
					<Tabs
						value={isOutputTab(tab) ? tab : 'preview'}
						onValueChange={(value) => setTab(value as OutputTab)}
						className="min-h-0 flex-1"
					>
						{/* An accessible name is an accessibility contract, not copy: without one, a screen reader
						    announces "tab list" with nothing to say it's this page's Output tabs. */}
						<TabsList aria-label="Output">{outputTabs()}</TabsList>
						{outputPanels('p-2')}
					</Tabs>
				</section>

				{/* Its own grid row under both columns, sized to its content, so opening it takes height from
				    the row above and the token list keeps scrolling inside what's left. */}
				{rawResponse ? <div className="md:col-span-2">{rawResponse}</div> : null}
			</main>
		);
	}

	// Below md: one tab set, and the page is the only scroller (#157). The stacked layout put the
	// preview some 1,500px down, behind a token list that caught every thumb dragging through it.
	return (
		<main ref={mainRoot} className="flex min-h-dvh flex-col gap-4 pb-4">
			<SkipLinks onSkip={skipTo} />
			<h1 tabIndex={-1} className="px-4 pt-4 text-2xl font-semibold tracking-tight">
				Cambium
			</h1>
			{/* The skip links' `href="#output"` names this element, as it names the desktop section.
			    `onSkip` does the navigating, but the link shouldn't point at nothing. Only one layout
			    is mounted, so the id never duplicates. */}
			<Tabs
				ref={phoneTabs}
				id="output"
				value={tab}
				onValueChange={(value) => selectPhoneTab(value as WorkspaceTab)}
				className="gap-0"
			>
				{/* The tab list is the bar's first row, so a stuck bar puts it at viewport top 0. The
				    scheme control trails it on a row of its own and stays in reach on every tab. It's
				    pushed right by its own `ml-auto`, not `justify-end` on the bar: that would spill an
				    overflowing tab list off the left edge, where no one can scroll to it and
				    `scrollWidth` never sees it. */}
				<div
					ref={bar}
					data-workspace-bar
					className="bg-background sticky top-0 z-20 flex flex-wrap items-center"
				>
					<TabsList aria-label="Workspace" className="flex w-full flex-wrap rounded-none">
						<TabsTab value="seed" className="flex-auto">
							Seed
						</TabsTab>
						<TabsTab value="tokens" className="flex-auto">
							Tokens
						</TabsTab>
						{outputTabs('flex-auto')}
					</TabsList>
					{schemeControl ? <div className="ml-auto px-4 py-1">{schemeControl}</div> : null}
				</div>
				{/* Kept mounted so a tab switch doesn't wipe the token filter, reopen categories or drop
				    a generate in flight. All three were mounted all along on desktop. */}
				<TabsPanel
					value="seed"
					keepMounted
					ref={(node) => {
						panels.current.seed = node;
					}}
					className="flex flex-col gap-4 p-4"
				>
					{seedColumn}
					{rawResponse}
				</TabsPanel>
				<TabsPanel
					value="tokens"
					keepMounted
					ref={(node) => {
						panels.current.tokens = node;
					}}
					className="flex flex-col p-4"
				>
					{tokensColumn}
				</TabsPanel>
				{outputPanels('p-4', true)}
			</Tabs>
		</main>
	);
}
