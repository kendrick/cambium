import type { BrandSeed } from './brand-seed';
import { deriveNonColor } from './derive-non-color';
import { contrastFromOklch } from './oklch';
import { CAMBIUM_NAMESPACE, inheritedFrom } from './provenance';
import type { RampSet, SchemeName } from './scale-engine';
import { type ContrastingPair, type SemanticAlias, SEMANTIC_MAP } from './semantic-map';
import { STEP_ROLES } from './step-roles';
import {
	type ColorScheme,
	type RampStep,
	type SemanticEntry,
	stepForAlias,
	type TokenExtensions,
	type TokenSet,
} from './token-set';

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
function semanticFor(ramps: RampSet): Record<string, SemanticEntry> {
	const semantic: Record<string, SemanticEntry> = {};

	for (const [token, assignment] of Object.entries(SEMANTIC_MAP)) {
		semantic[token] =
			typeof assignment === 'string' ? fixedEntry(ramps, assignment) : pairEntry(ramps, assignment);
	}

	return semantic;
}

/**
 * A semantic token inherits the provenance of the step it resolves to, because the value a
 * stylesheet reads through `--primary` *is* that step's value.
 *
 * Tagging the whole layer `derived` would be cheaper and wrong twice over. It would claim a seed
 * field for `destructive`, whose danger ramp is invented outright under a keyless read, and it
 * would report `primary` as computed when step 9 is the brand colour placed straight out of the
 * seed. `SEMANTIC_MAP` is a constant no seed informs, so the step is the only place left to read
 * an answer from.
 *
 * This writes its own rationale rather than copying the step's. The step's records how the curve
 * reached that colour, and the only thing the alias assignment adds is why this token reached for
 * that step.
 */
function inherit(step: RampStep, rationale: string): TokenExtensions {
	return inheritedFrom(step.$extensions[CAMBIUM_NAMESPACE], rationale);
}

function fixedEntry(ramps: RampSet, alias: SemanticAlias): SemanticEntry {
	const step = resolve(ramps, alias, `semantic layer aliases ${alias}`);

	return { alias, $extensions: inherit(step, `Takes ${describe(alias, step)}`) };
}

/**
 * The rationale names the losing candidate and the fill because nothing else records them. The two
 * schemes resolve one declaration to different steps, so a reader holding the dark layer alone sees
 * a plain alias with no sign that anything was measured.
 */
function pairEntry(ramps: RampSet, pair: ContrastingPair): SemanticEntry {
	const { alias, step, beat } = higherContrast(ramps, pair);

	return {
		alias,
		$extensions: inherit(
			step,
			`Takes ${describe(alias, step)}, which out-contrasts ${beat} on the ${pair.on} fill`,
		),
	};
}

/**
 * `brand.9, the brand ramp's solid fill`—where the colour came from and what the step is for.
 *
 * Step 9's role reads `solid fill, the brand colour itself`, which is two clauses. Pasted whole it
 * gives the sentence a second appositive and the reader two commas to untangle, so only the part
 * before the comma is used. What the step 9 aside would have said is already on the payload beside
 * it: provenance `observed` against `keyColors`.
 */
function describe(alias: SemanticAlias, step: RampStep): string {
	const ramp = alias.slice(0, alias.lastIndexOf('.'));

	// Searched rather than indexed. `RampSchema` pins a ramp to steps 1 through 12 in order, and
	// nothing pins `STEP_ROLES` to the same order; the `!` holds because the table declares all
	// twelve steps a `RampStep` can carry.
	const role = STEP_ROLES.find((entry) => entry.step === step.step)!.role;

	return `${alias}, the ${ramp} ramp's ${role.split(',')[0]}`;
}

function higherContrast(
	ramps: RampSet,
	pair: ContrastingPair,
): { alias: SemanticAlias; step: RampStep; beat: SemanticAlias } {
	const fill = resolve(ramps, pair.on, `contrasting pair measures against ${pair.on}`);

	const [first, second] = pair.candidates;
	const scored = [first, second].map((alias) => {
		const step = resolve(ramps, alias, `contrasting pair offers ${alias}`);

		return { alias, step, contrast: contrastFromOklch(step, fill) };
	});

	// Ties keep the first candidate, so the same ramps always produce the same token set.
	const won = scored[1]!.contrast > scored[0]!.contrast ? 1 : 0;

	return { ...scored[won]!, beat: scored[1 - won]!.alias };
}

/** `subject` names who asked, so a dangling alias reports which declaration reached for it. */
function resolve(ramps: RampSet, alias: string, subject: string): RampStep {
	const step = stepForAlias(ramps, alias);

	if (!step) throw new Error(`${subject}, which resolves to nothing`);

	return step;
}
