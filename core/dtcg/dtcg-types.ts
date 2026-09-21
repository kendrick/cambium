import type { TokenExtensions } from '../token-set';

/**
 * Types only. `validateDtcg` (`core/dtcg/validate.ts`) is the runtime check against the vendored
 * schema, and it is the only place this repo grades a document for conformance — a second,
 * hand-rolled check here would be exactly the "grading against a hand-written idea of the schema"
 * the plan warns off. What lives in this file is the shape a reader needs to *construct* one of
 * these documents in TypeScript, plus the data `serialize.ts` and the downstream export adapters
 * (#12, #13) read instead of each restating the family-to-`$type` mapping by hand.
 *
 * No DOM, network, or storage import, and no mutable module state: this module sits under
 * `core/`, which `docs/agents/testing.md` treats as the pure core, and `core/purity.test.ts`
 * enforces it mechanically for whatever imports this file transitively.
 */

/**
 * The 13 `$type` values the vendored 2025.10 schema accepts
 * (`core/dtcg/format.2025.10.json`, `tokenType.json`). Cambium's own document only ever emits
 * seven of them — see `DTCG_FAMILY_TYPES` below — but a consumer validating or reading an
 * arbitrary DTCG document (the round trip's hand-authored fixture, for one) needs the full set,
 * not just the subset this project happens to produce.
 */
export const DTCG_TYPE_VALUES = [
	'border',
	'color',
	'cubicBezier',
	'dimension',
	'duration',
	'fontFamily',
	'fontWeight',
	'gradient',
	'number',
	'shadow',
	'strokeStyle',
	'transition',
	'typography',
] as const;

export type DtcgType = (typeof DTCG_TYPE_VALUES)[number];

/**
 * The group names this project's documents nest tokens under, one entry per name in the plan's
 * document-shape block. Each value equals its own key, the same self-naming convention
 * `docs/agents/triage-labels.md` uses for the five triage roles, so a consumer builds a path like
 * `color.primitive.brand.9` by joining named constants (`DTCG_GROUP.color`,
 * `DTCG_GROUP.primitive`, ...) instead of typing the whole string once, uninspectable, in the
 * middle of a function.
 *
 * `primitive` here is deliberately singular where the internal model's `TokenSet.primitives`
 * field (`core/token-set.ts:589`) is plural — the DTCG side names a *kind* of group, the internal
 * side names a *collection* it holds, and the two vocabularies are allowed to diverge because
 * nothing round-trips a group name back to a field name by string matching.
 */
export const DTCG_GROUP = {
	color: 'color',
	primitive: 'primitive',
	semantic: 'semantic',
	radius: 'radius',
	spacing: 'spacing',
	typography: 'typography',
	size: 'size',
	weight: 'weight',
	lineHeight: 'lineHeight',
	tracking: 'tracking',
	shadow: 'shadow',
	motion: 'motion',
	duration: 'duration',
	easing: 'easing',
	opacity: 'opacity',
	zIndex: 'zIndex',
	focusRing: 'focusRing',
} as const;

export type DtcgGroupName = (typeof DTCG_GROUP)[keyof typeof DTCG_GROUP];

/**
 * The transport namespace for `$extensions` data invented at serialization time rather than
 * copied from the internal model — today, only tracking's `em` unit, which DTCG's `dimension`
 * type has no slot for (`core/tracking-scale.ts:12-16`; the plan's decision 4).
 *
 * Distinct from `com.cambium` (`CAMBIUM_NAMESPACE`, `core/provenance.ts:18`), which is a closed
 * discriminated union with nowhere to hang a unit and which is *not* invented here — it is copied
 * over verbatim, foreign namespaces included. The serializer adds this namespace; the
 * deserializer strips it back off; a `TokenSet` never carries it, because nothing internal
 * produced it. A document that kept it through a round trip would hand back a `TokenSet`
 * carrying a namespace the original never had.
 */
export const CAMBIUM_DTCG_NAMESPACE = 'com.cambium.dtcg';

/**
 * The one documented `com.cambium.dtcg` payload: tracking's unit, recorded beside the plain
 * number DTCG's `number` type holds so the deserializer knows to rebuild an `em` dimension rather
 * than guess at the unit the number came from.
 */
export type DtcgTransportExtension = { unit: 'em' };

/**
 * Every token's `$extensions`, built by extending the internal shape rather than restating it.
 * `TokenExtensionsSchema` (`core/token-set.ts:102-104`) is the one loose object in the internal
 * model, kept loose because DTCG 5.2.3 requires preserving extension data a tool doesn't
 * understand — that looseness is exactly what lets a foreign namespace survive serialization
 * untouched, so reusing the type (not the schema; this file adds no Zod) carries the same
 * guarantee forward into the document.
 */
export type DtcgExtensions = TokenExtensions &
	Partial<Record<typeof CAMBIUM_DTCG_NAMESPACE, DtcgTransportExtension>>;

/**
 * A single name segment, legal wherever a group or token name appears. Copied from the vendored
 * schema's `tokenOrGroupName` pattern (`core/dtcg/format.2025.10.json:61`) rather than
 * approximated, because a segment this project builds and one Ajv accepts have to agree on
 * exactly the same string.
 */
export const DTCG_SEGMENT_PATTERN = /^[^${}.][^{}.]*$/;

/**
 * A full curly-brace reference. Copied from the vendored schema's `curlyBraceReference` pattern
 * (`core/dtcg/format.2025.10.json:67`) for the same reason `DTCG_SEGMENT_PATTERN` is: the
 * serializer's idea of a legal alias and the schema's idea of one must be the same regex, not two
 * regexes someone has to remember to keep in sync.
 */
export const DTCG_ALIAS_PATTERN = /^\{[^${}.][^{}.]*(\.[^${}.][^{}.]*)*\}$/;

/**
 * A DTCG alias value: the curly-brace string a semantic color token's `$value` holds in place of
 * a literal (the plan's decision 6 — semantic tokens stay aliases, never flattened). `${string}`
 * is as far as a template literal type can narrow this; `DTCG_ALIAS_PATTERN` is the actual
 * contract, enforced by `toDtcgAlias` on the way in.
 */
export type DtcgAlias = `{${string}}`;

/**
 * Builds a curly-brace alias from path segments, validating each one against the same pattern
 * the schema will grade it with — a segment this function accepts and the schema rejects would
 * mean the two patterns above have drifted apart, and failing here is cheaper than failing as one
 * of nineteen Ajv diagnostics downstream.
 */
export function toDtcgAlias(path: readonly [string, ...string[]]): DtcgAlias {
	for (const segment of path) {
		if (!DTCG_SEGMENT_PATTERN.test(segment)) {
			throw new Error(`"${segment}" is not a legal DTCG name (segment of ${path.join('.')})`);
		}
	}

	return `{${path.join('.')}}` as DtcgAlias;
}

/**
 * The inverse of `toDtcgAlias`: an alias string back to the path segments it names. Validates
 * against the whole-reference pattern rather than trusting the braces, because a caller passing
 * an arbitrary string here is exactly the deserializer reading a hand-authored or hand-edited
 * document, not a value this module produced.
 */
export function fromDtcgAlias(alias: string): string[] {
	if (!DTCG_ALIAS_PATTERN.test(alias)) {
		throw new Error(`"${alias}" is not a DTCG curly-brace reference`);
	}

	return alias.slice(1, -1).split('.');
}

/**
 * DTCG's `color` value shape. `colorSpace` is fixed to `oklch` rather than the schema's full
 * fourteen-space enum because that is the only space anything in the internal model produces
 * (`OklchChannelsSchema`, `core/token-set.ts:127-135`) — widening this type would let a producer
 * claim a space nothing here can compute.
 *
 * `hex` is optional in the type because the schema treats it as an optional fallback, even though
 * the plan's decision 3 has Cambium emit it on every color token unconditionally: the type
 * describes what a legal DTCG color value may hold, not this project's stricter habit of always
 * filling the optional field in.
 */
export type DtcgColorValue = {
	colorSpace: 'oklch';
	components: readonly [number, number, number];
	alpha?: number;
	hex?: string;
};

/**
 * DTCG's `dimension` value, `px` and `rem` only. `em` is the internal model's third unit
 * (`core/token-set.ts:299`) and never reaches this type: tracking's `em` value serializes as a
 * plain `number` with the unit carried in `DtcgTransportExtension` instead (the plan's decision
 * 4), so a value typed `DtcgDimensionValue` is, by construction, never an `em` one.
 */
export type DtcgDimensionValue = { value: number; unit: 'px' | 'rem' };

/** DTCG's `duration` value. `ms` is the only unit `DurationValueSchema` produces (`core/token-set.ts:342`). */
export type DtcgDurationValue = { value: number; unit: 'ms' };

/** DTCG's `cubicBezier` value: four numbers, the two x-coordinates bound to `[0, 1]` by `CubicBezierValueSchema`. */
export type DtcgCubicBezierValue = readonly [number, number, number, number];

/**
 * DTCG's `shadow` value. Every geometry field reuses `DtcgDimensionValue` rather than a
 * shadow-specific shape, because `core/shadow-scale.ts:201-202` emits every one of them in `px`
 * — the sign that distinguishes an offset or spread from blur lives in the internal
 * `SignedDimensionValueSchema` (`core/token-set.ts:331-334`), not in a different DTCG shape.
 */
export type DtcgShadowValue = {
	color: DtcgColorValue;
	offsetX: DtcgDimensionValue;
	offsetY: DtcgDimensionValue;
	blur: DtcgDimensionValue;
	spread: DtcgDimensionValue;
};

/**
 * One token per `$type` this project actually emits — seven of the thirteen legal values, one
 * union member per distinct `$value` shape in the plan's document-shape block. `$type` and
 * `$value` are yoked per member (a `dimension` token cannot hold a `cubicBezier` value) so a
 * producer that pairs them wrong fails at the call site instead of downstream in Ajv output.
 *
 * `DtcgColorToken` is the one member whose `$value` is a union: a primitive ramp step is a
 * literal `DtcgColorValue`, a semantic token is a `DtcgAlias` — decision 6 again, that the two
 * color families diverge only here.
 */
export type DtcgColorToken = {
	$type: 'color';
	$value: DtcgColorValue | DtcgAlias;
	$extensions: DtcgExtensions;
};
export type DtcgDimensionToken = {
	$type: 'dimension';
	$value: DtcgDimensionValue;
	$extensions: DtcgExtensions;
};
export type DtcgFontWeightToken = {
	$type: 'fontWeight';
	$value: number;
	$extensions: DtcgExtensions;
};
export type DtcgNumberToken = { $type: 'number'; $value: number; $extensions: DtcgExtensions };
export type DtcgDurationToken = {
	$type: 'duration';
	$value: DtcgDurationValue;
	$extensions: DtcgExtensions;
};
export type DtcgCubicBezierToken = {
	$type: 'cubicBezier';
	$value: DtcgCubicBezierValue;
	$extensions: DtcgExtensions;
};
export type DtcgShadowToken = {
	$type: 'shadow';
	$value: DtcgShadowValue;
	$extensions: DtcgExtensions;
};

export type DtcgToken =
	| DtcgColorToken
	| DtcgDimensionToken
	| DtcgFontWeightToken
	| DtcgNumberToken
	| DtcgDurationToken
	| DtcgCubicBezierToken
	| DtcgShadowToken;

/**
 * A nesting level. Every legal key is either another group or a token — never both, since a token
 * is identified structurally by carrying `$type`/`$value`/`$extensions` and a group name can
 * never start with `$` (`DTCG_SEGMENT_PATTERN`). Recursive rather than depth-limited: the plan's
 * shape block nests two and three levels deep in different branches (`color.primitive.<ramp>
 * .<step>` against `radius.<name>`), and fixing a depth here would make the type lie about
 * whichever branch it didn't anticipate.
 */
export type DtcgGroup = {
	readonly [name: string]: DtcgGroup | DtcgToken;
};

/**
 * One complete document — what `serializeDtcg` returns one of, for `light` and one for `dark`.
 * Left equal to `DtcgGroup` rather than adding a top-level `$schema` field: the vendored schema's
 * own comment calls `$schema` "not part of the official DTCG specification"
 * (`core/dtcg/format.2025.10.json:13`), and nothing in the plan's decisions has the serializer
 * emit one, so typing it in would assert a field this project has no reason to produce.
 */
export type DtcgDocument = DtcgGroup;

/**
 * One row per line in the plan's document-shape block: the group path a family of tokens nests
 * under, built from `DTCG_GROUP` rather than typed loose, and the `$type` every token in that
 * family carries. `family` is the lookup key — a consumer wanting `DTCG_FAMILY_TYPES` as a
 * `Record` can `Object.fromEntries(DTCG_FAMILY_TYPES.map((row) => [row.family, row]))` — kept as
 * an array here rather than pre-built as one so this file states the mapping once, as data, and
 * lets whichever shape a consumer wants derive from it instead of restating it.
 *
 * This table is deliberately family-to-`$type` and nothing more: no unit, no value shape. Those
 * live beside each family's actual construction in `serialize.ts`, because two families can share
 * a `$type` while emitting different units (`radius` and `focusRing` are both `dimension`; one is
 * `rem`, the other `px`), so a unit column here would either be wrong for one of them or force a
 * per-token override that defeats the point of a shared table.
 */
export type DtcgFamilyName =
	| 'color.primitive'
	| 'color.semantic'
	| 'radius'
	| 'spacing'
	| 'typography.size'
	| 'typography.weight'
	| 'typography.lineHeight'
	| 'tracking'
	| 'shadow'
	| 'motion.duration'
	| 'motion.easing'
	| 'opacity'
	| 'zIndex'
	| 'focusRing';

export type DtcgFamilyMapping = {
	readonly family: DtcgFamilyName;
	readonly group: readonly string[];
	readonly type: DtcgType;
};

export const DTCG_FAMILY_TYPES: readonly DtcgFamilyMapping[] = [
	{ family: 'color.primitive', group: [DTCG_GROUP.color, DTCG_GROUP.primitive], type: 'color' },
	{ family: 'color.semantic', group: [DTCG_GROUP.color, DTCG_GROUP.semantic], type: 'color' },
	{ family: 'radius', group: [DTCG_GROUP.radius], type: 'dimension' },
	{ family: 'spacing', group: [DTCG_GROUP.spacing], type: 'dimension' },
	{
		family: 'typography.size',
		group: [DTCG_GROUP.typography, DTCG_GROUP.size],
		type: 'dimension',
	},
	{
		family: 'typography.weight',
		group: [DTCG_GROUP.typography, DTCG_GROUP.weight],
		type: 'fontWeight',
	},
	{
		family: 'typography.lineHeight',
		group: [DTCG_GROUP.typography, DTCG_GROUP.lineHeight],
		type: 'number',
	},
	{ family: 'tracking', group: [DTCG_GROUP.tracking], type: 'number' },
	{ family: 'shadow', group: [DTCG_GROUP.shadow], type: 'shadow' },
	{
		family: 'motion.duration',
		group: [DTCG_GROUP.motion, DTCG_GROUP.duration],
		type: 'duration',
	},
	{ family: 'motion.easing', group: [DTCG_GROUP.motion, DTCG_GROUP.easing], type: 'cubicBezier' },
	{ family: 'opacity', group: [DTCG_GROUP.opacity], type: 'number' },
	{ family: 'zIndex', group: [DTCG_GROUP.zIndex], type: 'number' },
	{ family: 'focusRing', group: [DTCG_GROUP.focusRing], type: 'dimension' },
] as const;
