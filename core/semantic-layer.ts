import { contrastFromOklch, type Oklch } from './oklch';
import type { RampSet, SchemeName } from './scale-engine';
import { type ContrastingPair, type SemanticAlias, SEMANTIC_MAP } from './semantic-map';
import type { Ramp, RampStep, Scheme, TokenSet } from './token-set';

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
 * every shadcn theme: `:root` holds light and `.dark` overrides it.
 */
export function buildTokenSet(schemes: Record<SchemeName, RampSet>): TokenSet {
	const light = { primitives: schemes.light, semantic: semanticFor(schemes.light) };
	const dark = { primitives: schemes.dark, semantic: semanticFor(schemes.dark) };

	return {
		primitives: light.primitives,
		semantic: light.semantic,
		schemes: { light, dark },
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

/**
 * Split on the last dot rather than re-running the alias pattern `token-set.ts` keeps private.
 * Form is that schema's job, and it has already run by the time a `Scheme` exists. The only
 * question left here is whether the target is present.
 *
 * `primitives` is a plain object, so a bare index walks the prototype chain and an alias of
 * `constructor.1` hands back a function that reads as a ramp. `checkAliasesResolve` in
 * `token-set.ts` guards the same trap the same way. The two stay separate copies because
 * `token-set.ts` is #7's file and cannot be edited here, so it cannot be pointed at a shared parser
 * either. Fold them together when #7 lands.
 */
function stepForAlias(primitives: Record<string, Ramp>, alias: string): RampStep | undefined {
	const dot = alias.lastIndexOf('.');

	if (dot < 0) return undefined;

	const rampName = alias.slice(0, dot);

	if (!Object.hasOwn(primitives, rampName)) return undefined;

	return primitives[rampName]?.[Number(alias.slice(dot + 1)) - 1];
}

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
 */
export function resolveScheme(scheme: Scheme): Record<string, Oklch> {
	const resolved: Record<string, Oklch> = {};

	for (const [token, alias] of Object.entries(scheme.semantic)) {
		const step = stepForAlias(scheme.primitives, alias);

		if (!step) {
			throw new Error(`semantic token "${token}" aliases ${alias}, which resolves to nothing`);
		}

		resolved[token] = { l: step.l, c: step.c, h: step.h };
	}

	return resolved;
}
