import { applyOverrides, overrideKey, type TokenOverride } from '../token-overrides';
import type { TokenSet } from '../token-set';
import { type ContrastEntry, checkContrast } from './check';

/**
 * The failing declared pairs each alias override is answerable for, keyed by `overrideKey`. A pair
 * counts against an override exactly when the same set with that one override taken back passes
 * it, so a Revert offered beside the verdict is guaranteed to clear it.
 *
 * Sharing a token with a failing pair doesn't count. A pair that already failed under a pin, or one
 * a second override broke, would otherwise show on every row that shares a token with it, and that
 * row's Revert would change nothing.
 *
 * `baseline` supplies the alias each semantic token held before anyone overrode it; only its
 * semantic aliases are read. `buildTokenSet`'s output serves, because contrast repair moves
 * primitive lightness and never an alias, so the repaired set the store paints carries the same
 * aliases.
 *
 * Primitive and value overrides are skipped. Taking a primitive override back needs the repaired
 * step it replaced, which only the store holds, and the verdict renders on semantic rows only. A
 * pair that needs two overrides taken back together is attributed to neither, since neither row's
 * Revert alone would fix it; the Accessibility tab still lists it.
 */
export function attributeContrastFailures(
	rendered: TokenSet,
	overrides: readonly TokenOverride[],
	baseline: TokenSet,
): Record<string, ContrastEntry[]> {
	const failing = checkContrast(rendered).filter((entry) => !entry.passes);
	const attributed: Record<string, ContrastEntry[]> = {};

	for (const override of overrides) {
		if (override.kind !== 'alias') continue;

		// A held override the current base refused never reached `rendered`, so there is nothing of
		// it to take back.
		if (rendered.schemes[override.scheme].semantic[override.token]?.alias !== override.alias)
			continue;

		const original = baseline.schemes[override.scheme].semantic[override.token]?.alias;
		if (original === undefined || original === override.alias) continue;

		const without = applyOverrides(rendered, [{ ...override, alias: original }]);
		if (!without.ok) continue;

		const passesWithout = new Set(
			checkContrast(without.tokenSet)
				.filter((entry) => entry.passes)
				.map(pairId),
		);

		attributed[overrideKey(override)] = failing.filter(
			(entry) => entry.scheme === override.scheme && passesWithout.has(pairId(entry)),
		);
	}

	return attributed;
}

function pairId(entry: ContrastEntry): string {
	return JSON.stringify([entry.scheme, entry.foreground, entry.background]);
}
