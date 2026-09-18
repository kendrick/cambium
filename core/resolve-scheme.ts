import type { Oklch } from './oklch';
import { type ColorScheme, stepForAlias } from './token-set';

/**
 * Every semantic token, flattened to the colour it names.
 *
 * This is what an export adapter consumes: aliases are how the layer is authored and how it stays
 * honest when a ramp moves, but a stylesheet needs values. Returning the three OKLCH channels
 * rather than a formatted string keeps the choice of colour space at the adapter, which is where
 * #7 wants it.
 *
 * Throws instead of skipping. Only a hand-built scheme reaches the throw, because `SchemeSchema`
 * rejects a dangling alias and the map is a compile-time constant. The alternative is a token set
 * with a hole in it, and a hole reaches an adapter looking like a colour.
 *
 * Takes the colour half of a scheme rather than a whole `Scheme`, because `deriveNonColor` calls
 * this to tint the shadow that a full `Scheme` then requires.
 *
 * Its own module rather than a second export of `semantic-layer.ts`, for the same reason one step
 * further out: `buildTokenSet` calls `deriveNonColor`, and `deriveNonColor` calls this. Leaving it
 * beside `buildTokenSet` closes that into an import cycle, which resolves at runtime and quietly
 * costs the one-way split the shadow derivation depends on.
 */
export function resolveScheme(scheme: ColorScheme): Record<string, Oklch> {
	const resolved: Record<string, Oklch> = {};

	for (const [token, entry] of Object.entries(scheme.semantic)) {
		const step = stepForAlias(scheme.primitives, entry.alias);

		if (!step) {
			throw new Error(
				`semantic token "${token}" aliases ${entry.alias}, which resolves to nothing`,
			);
		}

		resolved[token] = { l: step.l, c: step.c, h: step.h };
	}

	return resolved;
}
