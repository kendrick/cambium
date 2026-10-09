'use client';

import { useMemo, useState, type ReactNode } from 'react';

import { OverrideRejectedError } from '../../app/state/workspace-store';
import type { ContrastEntry } from '../../core/contrast/check';
import { resolveScheme } from '../../core/resolve-scheme';
import type { ScaleEngineResult } from '../../core/scale-engine';
import type { TokenSet } from '../../core/token-set';
import {
	overrideKey,
	type OverrideIssue,
	type SchemeName,
	type TokenOverride,
	type ValueCategory,
	type ValuePath,
} from '../../core/token-overrides';
import { CategoryGroup } from './token-list/category-group';
import { matchesFilter } from './token-list/filter';
import { swatchOf } from './token-list/format';
import { RampStrip } from './token-list/ramp-strip';
import { SemanticRow } from './token-list/semantic-row';
import { ValueRow } from './token-list/value-row';
import { walkCategoryTokens } from './token-list/walk-category';

/**
 * `primitives`, `semantic` and `shadow` are the three categories `core/token-set.ts`'s
 * `SCHEME_SHAPE` holds once per scheme; every other category holds still across light and dark. So
 * the workspace's one scheme control serves the colour groups and shadow together, and the
 * remaining eight read the same values whichever scheme it shows.
 */
const NON_COLOUR_CATEGORIES: readonly (ValueCategory | 'shadow')[] = [
	'radius',
	'typography',
	'tracking',
	'shadow',
	'spacing',
	'opacity',
	'motion',
	'focusRing',
	'zIndex',
];

/**
 * Whether any leaf under `tokens` currently holds an override, by the same key `ValueRow` computes
 * for its own reset control. `CategoryGroup` needs this at the category level, one call before
 * `ValueRow` ever mounts a row, to decide whether the section still counts as untouched.
 */
function categoryHasOverride(
	category: ValueCategory | 'shadow',
	scheme: SchemeName,
	tokens: { path: ValuePath; leaves: { suffix: ValuePath; value: number }[] }[],
	overrides: Record<string, TokenOverride>,
): boolean {
	return tokens.some((token) =>
		token.leaves.some((leaf) => {
			const path = [...token.path, ...leaf.suffix];
			const override: TokenOverride =
				category === 'shadow'
					? { kind: 'value', category: 'shadow', scheme, path, value: leaf.value }
					: { kind: 'value', category, path, value: leaf.value };
			return Object.hasOwn(overrides, overrideKey(override));
		}),
	);
}

export type TokenListProps = {
	/** The id of the heading that names the Tokens region. `Shell` renders it, above the list. */
	headingId: string;
	tokenSet: TokenSet | null;
	/** `attributeContrastFailures`' output: the failing pairs each override alone is answerable for. */
	contrastByOverride: Record<string, ContrastEntry[]>;
	/**
	 * The engine result `tokenSet` was built from, kept only to tell the two null cases apart:
	 * no seed at all versus a seed the engine refused. `tokensFor` in `app/state/workspace-store.ts`
	 * collapses both to `tokenSet: null`, and #24's browser suite asserts the two render distinct
	 * markup: a plain paragraph for the first, and one naming the refusal's `kind` in a `<code>` for the
	 * second. `derived.ok` true is otherwise redundant with `tokenSet` being non-null: `tokensFor`
	 * only returns null tokens for an ok-but-seedless derivation, which cannot happen (`derive` never
	 * produces one), so the list below trusts `tokenSet` once it clears this branch.
	 */
	derived: ScaleEngineResult | null;
	overrides: Record<string, TokenOverride>;
	overrideIssues: Record<string, OverrideIssue[]>;
	setOverride: (override: TokenOverride) => void;
	clearOverride: (key: string) => void;
	/** Which scheme the list shows, and so which scheme an alias, primitive or shadow edit lands in. */
	scheme: SchemeName;
};

/**
 * Groups the derived set by category and renders every leaf with its provenance and rationale. Each
 * leaf's edit control opens from a per-token popover, shaped for what it targets: a ramp.step
 * `<select>` for a semantic alias, L/C/H inputs for a primitive step, a number input per leaf
 * everywhere else.
 */
export function TokenList({
	headingId,
	tokenSet,
	contrastByOverride,
	derived,
	overrides,
	overrideIssues,
	setOverride,
	clearOverride,
	scheme,
}: TokenListProps) {
	// A number field keeps its own refused edits (`useFieldIssues`), since only the field knows when
	// its text has gone back to the shown value. An alias `<select>` is controlled and snaps back to
	// the committed alias the moment the store refuses, so its refusal is held here, by key, until a
	// later pick lands or the row resets. A held override the *current* base rejects is a different
	// thing again and lives in the store's `overrideIssues`.
	const [aliasAttempts, setAliasAttempts] = useState<Record<string, OverrideIssue[]>>({});
	const [query, setQuery] = useState('');

	const resolved = useMemo(
		() => (tokenSet ? resolveScheme(tokenSet.schemes[scheme]) : {}),
		[tokenSet, scheme],
	);

	if (derived === null) {
		return (
			<TokensRegion headingId={headingId}>
				<p className="text-muted-foreground text-sm">No seed yet, so there are no tokens.</p>
			</TokensRegion>
		);
	}

	if (!derived.ok) {
		return (
			<TokensRegion headingId={headingId}>
				<p className="text-sm">
					These tokens could not be derived: <code>{derived.error.kind}</code>
					{derived.error.kind === 'unreachable-floor'
						? ` (${derived.error.ramp} step ${derived.error.step})`
						: null}
					.
				</p>
			</TokensRegion>
		);
	}

	if (tokenSet === null) {
		// Unreachable given the store's own invariant (see the `derived` docblock above), kept as a
		// narrow guard so this component asserts nothing about a module it does not own.
		return null;
	}

	const colorScheme = tokenSet.schemes[scheme];
	const rampOptions = Object.entries(colorScheme.primitives).flatMap(([ramp, steps]) =>
		steps.map((step) => `${ramp}.${step.step}`),
	);

	/** Returns the store's issues when it refuses `override`, or null once it holds it. */
	function tryOverride(override: TokenOverride): OverrideIssue[] | null {
		try {
			setOverride(override);
			return null;
		} catch (error) {
			if (!(error instanceof OverrideRejectedError)) throw error;
			return error.issues;
		}
	}

	function holdAliasAttempt(key: string, issues: OverrideIssue[] | null) {
		setAliasAttempts((current) => {
			if (issues) return { ...current, [key]: issues };
			if (!(key in current)) return current;
			const next = { ...current };
			delete next[key];
			return next;
		});
	}

	// Both lists, never one in place of the other: a refused attempt says nothing about whether the
	// override already held under this key still fits the base, so hiding either would lose a fact.
	function issuesFor(key: string): OverrideIssue[] {
		return [...(aliasAttempts[key] ?? []), ...(overrideIssues[key] ?? [])];
	}

	const filtering = query.trim() !== '';
	const semantic = Object.entries(colorScheme.semantic).filter(([token]) =>
		matchesFilter(`semantic.${token}`, query),
	);
	const ramps = Object.entries(colorScheme.primitives)
		.map(
			([ramp, steps]) =>
				[
					ramp,
					steps.filter((step) => matchesFilter(`primitive.${ramp}.${step.step}`, query)),
				] as const,
		)
		.filter(([, steps]) => steps.length > 0);
	const valueCategories = NON_COLOUR_CATEGORIES.map((category) => {
		const topEntry = tokenSet[category];
		// The top-level `shadow` mirrors only the light scheme (`checkMirroredLayers`), so the
		// list has to reach into the scheme itself to show dark's own shadow values. `source`
		// is a schema-fixed literal on this category, so the top-level copy still answers that.
		const values = category === 'shadow' ? colorScheme.shadow.values : topEntry.values;
		const tokens = walkCategoryTokens(values);

		return {
			category,
			source: topEntry.source,
			// Across every token, filtered or not: a hidden edited row still means the category
			// isn't untouched.
			hasOverride: categoryHasOverride(category, scheme, tokens, overrides),
			shown: tokens.filter((token) => matchesFilter(`${category}.${token.path.join('.')}`, query)),
		};
	}).filter(({ shown }) => shown.length > 0);
	const nothingMatches =
		semantic.length === 0 && ramps.length === 0 && valueCategories.length === 0;

	return (
		<TokensRegion headingId={headingId}>
			{/* Sticky only while the region scrolls itself. Below md it would pin to the viewport
			    top, under the workspace tab bar. */}
			<label className="bg-background z-10 flex flex-col gap-1 pb-2 text-xs md:sticky md:top-0">
				Filter by name
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="rounded border px-2 py-1 text-sm"
				/>
			</label>

			<div className="flex flex-col gap-4">
				{semantic.length > 0 ? (
					// Keyed on `filtering` so starting or clearing a filter remounts every group at
					// its default. That's how a filter opens a collapsed category it matched.
					<CategoryGroup key={`semantic:${filtering}`} name="semantic" defaultOpen>
						<ul className="flex flex-col">
							{semantic.map(([token, entry]) => {
								const key = overrideKey({ kind: 'alias', scheme, token, alias: entry.alias });
								const overridden = Object.hasOwn(overrides, key);
								// An empty list still mounts the row's live region, which has to exist before
								// the first verdict for a screen reader to announce it.
								const contrastFailures = (contrastByOverride[key] ?? []).map((candidate) => ({
									label: `${candidate.foreground} on ${candidate.background}`,
									wcag: candidate.wcag,
									target: candidate.target,
								}));

								return (
									<SemanticRow
										key={token}
										token={token}
										entry={entry}
										swatch={swatchOf(resolved[token]!)}
										rampOptions={rampOptions}
										overridden={overridden}
										issues={issuesFor(key)}
										contrastFailures={contrastFailures}
										onAliasChange={(alias) =>
											holdAliasAttempt(key, tryOverride({ kind: 'alias', scheme, token, alias }))
										}
										onReset={
											overridden
												? () => {
														holdAliasAttempt(key, null);
														clearOverride(key);
													}
												: undefined
										}
									/>
								);
							})}
						</ul>
					</CategoryGroup>
				) : null}

				{ramps.length > 0 ? (
					// One disclosure for all seven ramps: `core/token-set.ts` treats primitives as one
					// category, and seven disclosures would cost seven Tab stops where this costs one.
					<CategoryGroup key={`primitives:${filtering}`} name="primitives" defaultOpen>
						<div className="flex flex-col gap-2">
							{ramps.map(([ramp, steps]) => (
								<div key={ramp} className="flex flex-col gap-1">
									<span className="font-mono text-xs">{ramp}</span>
									<RampStrip
										ramp={ramp}
										scheme={scheme}
										steps={steps}
										overrides={overrides}
										issuesFor={issuesFor}
										onOverride={tryOverride}
										onReset={clearOverride}
									/>
								</div>
							))}
						</div>
					</CategoryGroup>
				) : null}

				{/* Collapsed until asked for: the issue's Tab-stop bound makes no allowance for value
				    rows, so on load they mount nothing. */}
				{valueCategories.map(({ category, source, hasOverride, shown }) => (
					<CategoryGroup
						key={`${category}:${filtering}`}
						name={category}
						source={source}
						hasOverride={hasOverride}
						defaultOpen={filtering}
					>
						<ul className="flex flex-col">
							{shown.map((token) => (
								<ValueRow
									// Shadow is the one category here that differs by scheme; see `RampStrip`'s
									// chip key for why that has to remount on a toggle.
									key={`${category === 'shadow' ? scheme : ''}:${token.path.join('.')}`}
									category={category}
									scheme={scheme}
									token={token}
									overrides={overrides}
									issuesFor={issuesFor}
									onOverride={tryOverride}
									onReset={clearOverride}
								/>
							))}
						</ul>
					</CategoryGroup>
				))}

				{nothingMatches ? (
					<p className="text-muted-foreground text-sm">No token name contains “{query.trim()}”.</p>
				) : null}
			</div>
		</TokensRegion>
	);
}

// Scrolls on its own only from md up. Below md the page is the one scroller, because a nested one
// caught a thumb dragging through some 3,000px of list and held it there (#157). No `tabIndex`: every
// populated state holds a focusable descendant (the filter at least), and focusing one scrolls
// the region in every engine. That's also the condition axe's `scrollable-region-focusable`
// checks. The empty and error states hold one short paragraph and never overflow.
const SCROLLER = 'min-h-0 flex-1 rounded border p-2 md:overflow-y-auto';

function TokensRegion({ headingId, children }: { headingId: string; children: ReactNode }) {
	return (
		<section aria-labelledby={headingId} className={SCROLLER}>
			{children}
		</section>
	);
}
