'use client';

import { useMemo, useState } from 'react';

import { OverrideRejectedError } from '../../app/state/workspace-store';
import { toOklchCss } from '../../core/css/oklch-css';
import { CAMBIUM_NAMESPACE } from '../../core/provenance';
import { resolveScheme } from '../../core/resolve-scheme';
import type { ScaleEngineResult } from '../../core/scale-engine';
import { STEP_ROLES } from '../../core/step-roles';
import type { TokenSet } from '../../core/token-set';
import {
	overrideKey,
	type OverrideIssue,
	type SchemeName,
	type TokenOverride,
	type ValueCategory,
} from '../../core/token-overrides';
import { CategoryGroup } from './token-list/category-group';
import { PrimitiveRow } from './token-list/primitive-row';
import { TokenRow } from './token-list/token-row';
import { ValueRow } from './token-list/value-row';
import { walkCategoryTokens } from './token-list/walk-category';

/**
 * `primitives`, `semantic` and `shadow` are the three categories `core/token-set.ts`'s
 * `SCHEME_SHAPE` holds once per scheme; every other category holds still across light and dark. So
 * one scheme toggle serves the colour groups and shadow together, and the remaining eight read the
 * same values whichever side of the toggle is showing.
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

export type TokenListProps = {
	tokenSet: TokenSet | null;
	/**
	 * The engine result `tokenSet` was built from, kept only to tell the two null cases apart:
	 * no seed at all versus a seed the engine refused. `tokensFor` in `app/state/workspace-store.ts`
	 * collapses both to `tokenSet: null`, and #24's browser suite asserts the two render distinct
	 * markup — a plain paragraph for the first, one naming the refusal's `kind` in a `<code>` for the
	 * second. `derived.ok` true is otherwise redundant with `tokenSet` being non-null: `tokensFor`
	 * only returns null tokens for an ok-but-seedless derivation, which cannot happen (`derive` never
	 * produces one), so the list below trusts `tokenSet` once it clears this branch.
	 */
	derived: ScaleEngineResult | null;
	overrides: Record<string, TokenOverride>;
	overrideIssues: Record<string, OverrideIssue[]>;
	setOverride: (override: TokenOverride) => void;
	clearOverride: (key: string) => void;
};

/**
 * Groups the derived set by category and renders every leaf with its provenance, its rationale, and
 * an edit control shaped for what it targets: a ramp.step `<select>` for a semantic alias, L/C/H
 * inputs for a primitive step, a number input per leaf everywhere else.
 */
export function TokenList({
	tokenSet,
	derived,
	overrides,
	overrideIssues,
	setOverride,
	clearOverride,
}: TokenListProps) {
	const [scheme, setScheme] = useState<SchemeName>('light');
	// An override the base itself rejects on the spot (a bad edit that never committed) is transient:
	// the store already threw and kept nothing, so there is no store field for this to read back from.
	// A held override the *current* base rejects is different — that one does live in `overrideIssues`.
	const [attemptIssues, setAttemptIssues] = useState<Record<string, OverrideIssue[]>>({});

	const resolved = useMemo(
		() => (tokenSet ? resolveScheme(tokenSet.schemes[scheme]) : {}),
		[tokenSet, scheme],
	);

	if (derived === null) {
		return <p className="text-muted-foreground text-sm">No seed yet, so there are no tokens.</p>;
	}

	if (!derived.ok) {
		return (
			<p className="text-sm">
				These tokens could not be derived: <code>{derived.error.kind}</code>
				{derived.error.kind === 'unreachable-floor'
					? ` (${derived.error.ramp} step ${derived.error.step})`
					: null}
				.
			</p>
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

	function tryOverride(override: TokenOverride) {
		const key = overrideKey(override);

		try {
			setOverride(override);
			setAttemptIssues((issues) => {
				if (!(key in issues)) return issues;
				const next = { ...issues };
				delete next[key];
				return next;
			});
		} catch (error) {
			if (!(error instanceof OverrideRejectedError)) throw error;
			setAttemptIssues((issues) => ({ ...issues, [key]: error.issues }));
		}
	}

	function issuesFor(key: string): OverrideIssue[] | undefined {
		return attemptIssues[key] ?? overrideIssues[key];
	}

	return (
		<div className="flex flex-col gap-4">
			<fieldset className="m-0 flex gap-2 border-0 p-0">
				<legend className="sr-only">Colour scheme</legend>
				{(['light', 'dark'] as const).map((option) => (
					<button
						key={option}
						type="button"
						aria-pressed={scheme === option}
						onClick={() => setScheme(option)}
						className="aria-pressed:bg-muted aria-pressed:font-medium rounded border px-2 py-1 text-xs capitalize"
					>
						{option}
					</button>
				))}
			</fieldset>

			<CategoryGroup name="semantic">
				{Object.entries(colorScheme.semantic).map(([token, entry]) => {
					const key = overrideKey({ kind: 'alias', scheme, token, alias: entry.alias });
					const overridden = Object.hasOwn(overrides, key);
					const step = Number(entry.alias.slice(entry.alias.lastIndexOf('.') + 1));
					const role = STEP_ROLES.find((candidate) => candidate.step === step)?.role;

					return (
						<TokenRow
							key={token}
							id={`semantic.${token}`}
							provenance={entry.$extensions[CAMBIUM_NAMESPACE]}
							resolvesTo={entry.alias}
							stepRole={role}
							swatch={toOklchCss(resolved[token]!)}
							overridden={overridden}
							onReset={overridden ? () => clearOverride(key) : undefined}
							issues={issuesFor(key)}
						>
							<select
								aria-label={`${token} alias`}
								value={entry.alias}
								onChange={(event) =>
									tryOverride({ kind: 'alias', scheme, token, alias: event.target.value })
								}
							>
								{rampOptions.map((option) => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						</TokenRow>
					);
				})}
			</CategoryGroup>

			{Object.entries(colorScheme.primitives).map(([ramp, steps]) => (
				<CategoryGroup key={ramp} name={ramp}>
					{steps.map((step) => (
						<PrimitiveRow
							key={step.step}
							scheme={scheme}
							ramp={ramp}
							step={step}
							overrides={overrides}
							issuesFor={issuesFor}
							onOverride={tryOverride}
							onReset={clearOverride}
						/>
					))}
				</CategoryGroup>
			))}

			{NON_COLOUR_CATEGORIES.map((category) => {
				const topEntry = tokenSet[category];
				// The top-level `shadow` mirrors only the light scheme (`checkMirroredLayers`), so the
				// toggle has to reach into the scheme itself to show dark's own shadow values. `source`
				// is a schema-fixed literal on this category, so the top-level copy still answers that.
				const values = category === 'shadow' ? colorScheme.shadow.values : topEntry.values;
				const tokens = walkCategoryTokens(values);

				return (
					<CategoryGroup key={category} name={category} source={topEntry.source}>
						{tokens.map((token) => (
							<ValueRow
								key={token.path.join('.')}
								category={category}
								scheme={scheme}
								token={token}
								overrides={overrides}
								issuesFor={issuesFor}
								onOverride={tryOverride}
								onReset={clearOverride}
							/>
						))}
					</CategoryGroup>
				);
			})}
		</div>
	);
}
