import type { SeedField, TokenExtensions } from './token-set';

/**
 * The schema and the types live in `token-set.ts`, beside the tokens that carry them, and are
 * re-exported here so a producing module has one import rather than two. The builders are what
 * belongs in this file: they are the only place a payload is spelled out by hand.
 */
export type { SeedField, TokenProvenance } from './token-set';

/**
 * The `$extensions` namespace every Cambium token files its provenance under.
 *
 * DTCG reserves `$extensions` for vendor data keyed by a namespace, and a tool walking the set
 * reads exactly one key. Seven modules attach payloads, so the string is spelled here and nowhere
 * else: a typo in any one of them ships a set that parses everywhere except at the key the whole
 * feature is read through.
 */
export const CAMBIUM_NAMESPACE = 'com.cambium';

/**
 * A value placed directly out of the seed: the brand key colour at step 9 is the colour the image
 * actually held. Reserved for that, rather than for anything the seed influenced, because a
 * consumer reading `observed` is being told it can point at the reference image.
 */
export function observed(seedField: SeedField, rationale: string): TokenExtensions {
	return { [CAMBIUM_NAMESPACE]: { provenance: 'observed', rationale, seedField } };
}

/** A value computed from a seed field that was stated — the curve applied to a colour the brand supplied. */
export function derived(seedField: SeedField, rationale: string): TokenExtensions {
	return { [CAMBIUM_NAMESPACE]: { provenance: 'derived', rationale, seedField } };
}

/**
 * A value the pipeline supplied because nothing in the seed spoke to it, so there is no field to
 * name and `seedField` is null rather than a plausible guess. Ten of the eleven seed fields come
 * back null from a keyless read, so this is the common case rather than the edge one.
 */
export function invented(rationale: string): TokenExtensions {
	return { [CAMBIUM_NAMESPACE]: { provenance: 'invented', rationale, seedField: null } };
}
