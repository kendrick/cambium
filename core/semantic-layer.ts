import type { BrandSeed } from './brand-seed';
import { deriveNonColor } from './derive-non-color';
import { contrastFromOklch } from './oklch';
import type { RampSet, SchemeName } from './scale-engine';
import { type ContrastingPair, type SemanticAlias, SEMANTIC_MAP } from './semantic-map';
import { type ColorScheme, stepForAlias, type TokenSet } from './token-set';

/**
 * One map, both schemes, resolved down to one alias per token per scheme.
 *
 * Dark is generated independently against the same step roles rather than inverted from light, so
 * the two schemes disagree about what colour step 6 of the neutral ramp is and agree about which
 * token takes it. Holding a separate hand-written map per scheme would let them drift apart, and a
 * dark theme missing the token its light half declares is a theme that loses a colour the moment
 * someone flips the switch. `core/semantic-layer.test.ts` asserts the two key sets match, because
 * `TokenSetSchema` checks each scheme's aliases against that scheme alone and cannot see the gap.
 *
 * A `ContrastingPair` is the one assignment that may land on different steps in the two schemes.
 * It resolves here rather than at export time because every consumer would otherwise repeat the
 * measurement, and because a scheme's semantic layer has to hold plain aliases for
 * `SemanticLayerSchema` to accept it.
 *
 * The top level carries light rather than a scheme of its own, matching `app/globals.css` and
 * every shadcn theme: `:root` holds light and `.dark` overrides it. The shadow scale follows that
 * rule too; `token-set.ts` records why it is the one non-colour category a scheme carries.
 *
 * The seed comes in alongside the ramps because #7's nine non-colour categories derive from it and
 * the schema requires them, so what this returned before is no longer a `TokenSet`. The colour
 * halves are built first, because `deriveNonColor` resolves `background` out of each of them.
 */
export function buildTokenSet(schemes: Record<SchemeName, RampSet>, seed: BrandSeed): TokenSet {
	const light: ColorScheme = { primitives: schemes.light, semantic: semanticFor(schemes.light) };
	const dark: ColorScheme = { primitives: schemes.dark, semantic: semanticFor(schemes.dark) };
	const { shadow, ...categories } = deriveNonColor(seed, { light, dark });

	return {
		primitives: light.primitives,
		semantic: light.semantic,
		shadow: shadow.light,
		schemes: {
			light: { ...light, shadow: shadow.light },
			dark: { ...dark, shadow: shadow.dark },
		},
		...categories,
	};
}

/**
 * Step 9 carries the seed's own colour in both schemes, so a foreground sitting on it cannot take a
 * fixed step: step 1 runs near-white in light and near-black in dark, and a navy seed ends up at
 * 1.01:1 in the dark scheme. Both ends of the ramp are declared, and the one further from the fill
 * wins.
 *
 * Choosing between two steps the ramp already holds is aliasing rather than contrast repair, which
 * #6 lists as a non-goal. Nothing here moves a colour, and it cannot rescue a brand at mid
 * lightness, whose ramp holds no step that clears AA against its own step 9.
 */
function semanticFor(ramps: RampSet): Record<string, string> {
	const semantic: Record<string, string> = {};

	for (const [token, assignment] of Object.entries(SEMANTIC_MAP)) {
		semantic[token] =
			typeof assignment === 'string' ? assignment : higherContrast(ramps, assignment);
	}

	return semantic;
}

function higherContrast(ramps: RampSet, pair: ContrastingPair): SemanticAlias {
	const fill = stepForAlias(ramps, pair.on);

	if (!fill)
		throw new Error(`contrasting pair measures against ${pair.on}, which resolves to nothing`);

	const [first, second] = pair.candidates;
	const scored = [first, second].map((alias) => {
		const step = stepForAlias(ramps, alias);

		if (!step) throw new Error(`contrasting pair offers ${alias}, which resolves to nothing`);

		return { alias, contrast: contrastFromOklch(step, fill) };
	});

	// Ties keep the first candidate, so the same ramps always produce the same token set.
	return scored[1]!.contrast > scored[0]!.contrast ? scored[1]!.alias : scored[0]!.alias;
}
