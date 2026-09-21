import { type Oklch, toSrgbHex } from '../oklch';
import { type TokenSet, TokenSetSchema } from '../token-set';
import {
	CAMBIUM_DTCG_NAMESPACE,
	DTCG_ALIAS_PATTERN,
	DTCG_GROUP,
	type DtcgType,
	fromDtcgAlias,
} from './dtcg-types';

/**
 * Two DTCG 2025.10 documents read back into the internal `TokenSet` they denote.
 *
 * The inverse of `serializeDtcg`, and inverse is a strong claim here: equivalence means deep
 * equality after `TokenSetSchema.parse` on both sides. Every choice the serializer made has to be
 * undone exactly, and four of them are decisions rather than copies. Each is argued where it is
 * made: the mirror in `schemeFrom`, the eight groups that live once and appear twice in
 * `checkDocumentsAgree`, the `hex` fallback in `checkHex`, and the transport namespace in
 * `trackingScale`.
 *
 * Pure, like its inverse: no DOM, no network, no storage, no module state, and both documents come
 * back untouched because every value is rebuilt rather than adopted.
 *
 * This module refuses a lot of documents, because the ones it reads may have been hand-edited or
 * written by a tool that read the spec differently. Every refusal names the token and says what
 * disagreed, since the consumer of a failure here is a person with a file open. Structural reading
 * is checked here; value shape is left to `TokenSetSchema`, whose issue paths already say where a
 * bad provenance payload or an out-of-range channel sits. Restating those rules would leave two
 * graders to keep in sync.
 */

/** A group or a token, before anything has established which. */
type Node = Record<string, unknown>;

/**
 * One document and the name to put in front of a path when something in it goes wrong. Threaded
 * rather than derived, because `radius.md is not a dimension token` leaves a reader holding two
 * files and no way to tell which one to open.
 */
type Doc = { root: Node; scheme: string };

/** The ten groups this project's documents hold, in the order `serialize.ts` writes them. */
const ROOT_GROUPS: readonly string[] = [
	DTCG_GROUP.color,
	DTCG_GROUP.radius,
	DTCG_GROUP.spacing,
	DTCG_GROUP.typography,
	DTCG_GROUP.tracking,
	DTCG_GROUP.shadow,
	DTCG_GROUP.motion,
	DTCG_GROUP.opacity,
	DTCG_GROUP.zIndex,
	DTCG_GROUP.focusRing,
];

/**
 * The groups the two documents must agree about, derived from the list above rather than written
 * out again, so a group added to one list cannot go unconsidered in the other.
 *
 * Colour is what a scheme is, so the two documents differ there by design. Shadow is the one
 * non-colour category `SchemeSchema` carries per scheme, because a shadow tuned for a white page is
 * invisible on a near-black one.
 */
const SHARED_GROUPS = ROOT_GROUPS.filter(
	(group) => group !== DTCG_GROUP.color && group !== DTCG_GROUP.shadow,
);

export function deserializeDtcg(lightDocument: unknown, darkDocument: unknown): TokenSet {
	const light = docFrom(lightDocument, 'light');
	const dark = docFrom(darkDocument, 'dark');

	checkDocumentsAgree(light, dark);

	const lightScheme = schemeFrom(light);

	// The top level is the light scheme a second time, which is what `checkMirroredLayers` requires.
	// Spreading one object into both slots states "identical" by identity, the way
	// `dtcg.fixture.ts` does, and the parse below clones them apart.
	const draft = {
		...lightScheme,
		schemes: { light: lightScheme, dark: schemeFrom(dark) },
		radius: { source: 'derived', values: dimensionScale(light, [DTCG_GROUP.radius]) },
		typography: { source: 'derived', values: typographyOf(light) },
		tracking: { source: 'derived', values: trackingScale(light) },
		spacing: { source: 'system', values: dimensionScale(light, [DTCG_GROUP.spacing]) },
		opacity: { source: 'system', values: numberScale(light, [DTCG_GROUP.opacity], 'number') },
		motion: { source: 'system', values: motionOf(light) },
		focusRing: { source: 'system', values: focusRingOf(light) },
		zIndex: { source: 'system', values: numberScale(light, [DTCG_GROUP.zIndex], 'number') },
	};

	// `source` never reaches a document and never needs to: each category's discriminator is a
	// literal on its own schema, so the `derived` and `system` values above are read off
	// `token-set.ts` rather than recovered. Parsing is what proves that reading right. A wrong
	// literal fails here instead of persisting as a false claim about where a category came from.
	return TokenSetSchema.parse(draft);
}

function label(doc: Doc, path: readonly string[]): string {
	return [doc.scheme, ...path].join('.');
}

function docFrom(document: unknown, scheme: string): Doc {
	if (typeof document !== 'object' || document === null || Array.isArray(document)) {
		throw new Error(`the ${scheme} document is not a DTCG document`);
	}

	return { root: document as Node, scheme };
}

function asNode(value: unknown, doc: Doc, path: readonly string[]): Node {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label(doc, path)} is not a DTCG group or token`);
	}

	return value as Node;
}

/**
 * `Object.hasOwn` rather than a bare index, for the reason `declaredRamp` gives in
 * `core/token-set.ts`: a plain object walks its prototype chain, so a document naming a group
 * `constructor` hands back a truthy function that satisfies an existence check without any such
 * group being in the file.
 */
function childOf(parent: Node, name: string, doc: Doc, childPath: readonly string[]): unknown {
	if (!Object.hasOwn(parent, name)) {
		throw new Error(`${label(doc, childPath)} is missing from the document`);
	}

	return parent[name];
}

function nodeAt(doc: Doc, path: readonly string[]): unknown {
	let node: unknown = doc.root;

	for (const [index, segment] of path.entries()) {
		const parent = asNode(node, doc, path.slice(0, index));

		node = childOf(parent, segment, doc, path.slice(0, index + 1));
	}

	return node;
}

function groupAt(doc: Doc, path: readonly string[]): Node {
	const node = asNode(nodeAt(doc, path), doc, path);

	// A token is identified structurally by carrying `$type`, and a group name can never start with
	// `$`, so this is the whole of the distinction the format offers.
	if ('$type' in node) {
		throw new Error(`${label(doc, path)} is a token where a group was expected`);
	}

	return node;
}

/**
 * Whether a key is DTCG metadata about the node it sits on rather than a group or a token inside
 * it. Every walk over a node's entries skips these.
 *
 * The prefix decides it, because DTCG reserves `$` for itself: `tokenOrGroupName` is
 * `^[^${}.][^{}.]*$` (`core/dtcg/format.2025.10.json:61`), so a name beginning with `$` can never
 * be a group or a token. That is checked by prefix rather than against the names the schema lists
 * (`$schema`, `$type`, `$description`, `$extensions`, `$extends`, `$deprecated` and `$root` at the
 * root; all but `$schema` on a group) for two reasons. The schema closes that set itself with
 * `additionalProperties: false`, so a `$` name outside the list is already invalid and
 * `validateDtcg` is the thing that says so; copying the list here would put a second grader on a
 * rule the schema owns. And the list is the schema's to grow, so a hard-coded copy would refuse a
 * document that a refreshed `format.2025.10.json` accepts, which is the same failure as refusing
 * `$schema` today, one release later.
 *
 * What this costs is honest and small: metadata has nowhere to live on a `TokenSet`, so a root
 * `$description` an editor stamped is read past and does not come back on re-serialization. A
 * document Cambium wrote carries none of these keys, so its own round trip is exact.
 *
 * `$type` is the one reserved name that also does work elsewhere: `groupAt` uses it to tell a token
 * from a group, the same structural test `serialize.test.ts` makes. A group carrying a `$type` for
 * inheritance is therefore still read as a token, which the plan's decision 5 rules out emitting
 * and which this function does not change either way.
 */
function isReservedName(name: string): boolean {
	return name.startsWith('$');
}

/**
 * Rejects a group name this deserializer would otherwise walk past.
 *
 * Only applied where the shape is fixed—the root and the four groups with named children—since
 * everywhere else the entries are iterated and nothing can be missed. A group left unread reads
 * back as a token set that never held it, and no later comparison can tell that apart from a token
 * set that really did not.
 *
 * Reserved names are exempt, and the message below says why they have to be: a `$schema` pointer an
 * editor stamped on the root carries no tokens at all, so refusing it would be both wrong about the
 * document and wrong in its reason.
 */
function requireOnly(
	group: Node,
	expected: readonly string[],
	doc: Doc,
	path: readonly string[],
): void {
	const unmodelled = Object.keys(group).filter(
		(name) => !isReservedName(name) && !expected.includes(name),
	);

	if (unmodelled.length > 0) {
		throw new Error(
			`${label(doc, path)} holds ${unmodelled.join(', ')}, which nothing in the token set can carry; reading past it would drop those tokens`,
		);
	}
}

function tokenAt(value: unknown, type: DtcgType, doc: Doc, path: readonly string[]): Node {
	const token = asNode(value, doc, path);

	if (token.$type !== type) {
		throw new Error(
			`${label(doc, path)} is $type ${JSON.stringify(token.$type)} where ${type} was expected`,
		);
	}

	return token;
}

function valueOf(token: Node, doc: Doc, path: readonly string[]): unknown {
	return childOf(token, '$value', doc, [...path, '$value']);
}

/** Every child of a group that is a group or a token, which is every key `isReservedName` clears. */
function mapGroup<T>(
	group: Node,
	doc: Doc,
	path: readonly string[],
	read: (node: unknown, tokenPath: string[]) => T,
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(group)
			.filter(([name]) => !isReservedName(name))
			.map(([name, node]) => [name, read(node, [...path, name])]),
	);
}

/**
 * A token's `$extensions` split into the part that belongs on the internal token and the transport
 * namespace the serializer invented, which must never reach a `TokenSet`: a round trip that kept it
 * would hand back a token set carrying a namespace the original never had.
 *
 * Everything else, `com.cambium` and any foreign namespace alike, comes back untouched. DTCG 5.2.3
 * requires preserving extension data a tool does not understand, and `TokenExtensionsSchema` is the
 * one loose object in the internal model so that it can.
 */
function extensionsOf(
	token: Node,
	doc: Doc,
	path: readonly string[],
): { own: Node; transport: Node | undefined } {
	const extensions = asNode(childOf(token, '$extensions', doc, [...path, '$extensions']), doc, [
		...path,
		'$extensions',
	]);
	const { [CAMBIUM_DTCG_NAMESPACE]: transport, ...own } = extensions;

	if (transport === undefined) return { own, transport: undefined };

	return {
		own,
		transport: asNode(transport, doc, [...path, '$extensions', CAMBIUM_DTCG_NAMESPACE]),
	};
}

/**
 * The transport namespace exists for exactly one thing today—tracking's `em`, which DTCG's
 * `dimension` unit enum has no slot for. On any other token it is either a tool borrowing our
 * namespace or a family that grew a unit nobody told this file about, and stripping it quietly
 * would drop data with no record that there was any.
 */
function ownExtensions(token: Node, doc: Doc, path: readonly string[]): Node {
	const { own, transport } = extensionsOf(token, doc, path);

	if (transport !== undefined) {
		throw new Error(
			`${label(doc, path)} carries ${CAMBIUM_DTCG_NAMESPACE}, which only a tracking token has anywhere to put`,
		);
	}

	return own;
}

/**
 * `components` is authoritative and `hex` is DTCG's optional fallback for a tool that cannot
 * evaluate a colour space, so the value comes from the components. The hex is still checked rather
 * than discarded: a hex that disagrees means the document was hand-edited or written by a converter
 * that differs from ours, and some consumer downstream is painting a colour this token set does not
 * describe. Reading past it would hide that, and the round trip would come back looking clean.
 *
 * Absent is not a disagreement. DTCG makes the field optional, so a document that never wrote one
 * is a conforming document with nothing to check.
 */
function checkHex(hex: unknown, color: Oklch, doc: Doc, path: readonly string[]): void {
	if (hex === undefined) return;

	if (typeof hex !== 'string') {
		// The schema also allows a JSON Pointer reference object here. Resolving one would mean
		// following a pointer into a document this function has no handle on, so it is refused rather
		// than half-supported.
		throw new Error(`${label(doc, path)} holds a hex this deserializer cannot read as a string`);
	}

	const painted = toSrgbHex(color);

	// Case-insensitive, because the schema's pattern accepts both and `#F6F9FC` is the same three
	// bytes as `#f6f9fc`. Rejecting it would fail a document nothing did anything wrong to.
	if (hex.toLowerCase() !== painted) {
		throw new Error(
			`${label(doc, path)} carries hex ${hex}, but its components are the sRGB bytes ${painted}`,
		);
	}
}

function colorOf(value: unknown, doc: Doc, path: readonly string[]): Oklch & { alpha?: number } {
	const color = asNode(value, doc, path);

	if (color.colorSpace !== 'oklch') {
		throw new Error(
			`${label(doc, path)} is in colour space ${JSON.stringify(color.colorSpace)}, and the internal model holds oklch and nothing else`,
		);
	}

	const components = color.components;

	if (
		!Array.isArray(components) ||
		components.length !== 3 ||
		components.some((channel) => typeof channel !== 'number')
	) {
		throw new Error(`${label(doc, path)} does not hold three numeric oklch components`);
	}

	const [l, c, h] = components as [number, number, number];

	checkHex(color.hex, { l, c, h }, doc, path);

	// Alpha rides through only when it is there. A ramp step has no slot for one and a shadow colour
	// requires one, and `TokenSetSchema` is the place that says which is which.
	return typeof color.alpha === 'number' ? { l, c, h, alpha: color.alpha } : { l, c, h };
}

/**
 * The `{ value, unit }` pair DTCG's `dimension` and `duration` both hold. One reader for both,
 * because the two shapes are identical and only the unit enum differs—and that enum is
 * `TokenSetSchema`'s to grade, not this function's to restate.
 */
function magnitudeOf(value: unknown, doc: Doc, path: readonly string[]) {
	const dimension = asNode(value, doc, path);

	if (typeof dimension.value !== 'number' || typeof dimension.unit !== 'string') {
		throw new Error(`${label(doc, path)} is not a magnitude and a unit`);
	}

	return { value: dimension.value, unit: dimension.unit };
}

function numberOf(value: unknown, doc: Doc, path: readonly string[]): number {
	if (typeof value !== 'number') {
		throw new Error(`${label(doc, path)} is not a number`);
	}

	return value;
}

function cubicBezierOf(value: unknown, doc: Doc, path: readonly string[]): number[] {
	if (
		!Array.isArray(value) ||
		value.length !== 4 ||
		value.some((coordinate) => typeof coordinate !== 'number')
	) {
		throw new Error(`${label(doc, path)} is not four cubic-bezier coordinates`);
	}

	return value as number[];
}

function dimensionScale(doc: Doc, path: readonly string[]) {
	return mapGroup(groupAt(doc, path), doc, path, (node, tokenPath) => {
		const token = tokenAt(node, 'dimension', doc, tokenPath);

		return {
			...magnitudeOf(valueOf(token, doc, tokenPath), doc, [...tokenPath, '$value']),
			$extensions: ownExtensions(token, doc, tokenPath),
		};
	});
}

/**
 * `fontWeight` and `number` differ only in the `$type` they announce: both hold a bare number, and
 * `scalarToken` wraps it under `value` on the way in so it has somewhere to hang `$extensions`.
 */
function numberScale(doc: Doc, path: readonly string[], type: 'fontWeight' | 'number') {
	return mapGroup(groupAt(doc, path), doc, path, (node, tokenPath) => {
		const token = tokenAt(node, type, doc, tokenPath);

		return {
			value: numberOf(valueOf(token, doc, tokenPath), doc, [...tokenPath, '$value']),
			$extensions: ownExtensions(token, doc, tokenPath),
		};
	});
}

/**
 * Tracking is the one family whose unit cannot be written down in DTCG, so the magnitude arrives as
 * a plain `number` and the unit rides in the transport namespace.
 *
 * A tracking token without it fails rather than defaulting. Nothing else in the document says what
 * the number measures, so a default would be inventing the unit: a scale written in rem and read
 * back as em is a wrong number wearing the right shape, which is the failure that survives a round
 * trip looking correct. `serialize.ts` refuses the same value from the other side for the same
 * reason.
 */
function trackingScale(doc: Doc) {
	const path = [DTCG_GROUP.tracking];

	return mapGroup(groupAt(doc, path), doc, path, (node, tokenPath) => {
		const token = tokenAt(node, 'number', doc, tokenPath);
		const { own, transport } = extensionsOf(token, doc, tokenPath);

		if (transport?.unit !== 'em') {
			throw new Error(
				`${label(doc, tokenPath)} carries no ${CAMBIUM_DTCG_NAMESPACE} em unit, so nothing says what its number measures`,
			);
		}

		return {
			value: numberOf(valueOf(token, doc, tokenPath), doc, [...tokenPath, '$value']),
			unit: 'em',
			$extensions: own,
		};
	});
}

function typographyOf(doc: Doc) {
	const path = [DTCG_GROUP.typography];
	const sub = [DTCG_GROUP.size, DTCG_GROUP.weight, DTCG_GROUP.lineHeight];

	requireOnly(groupAt(doc, path), sub, doc, path);

	return {
		size: dimensionScale(doc, [...path, DTCG_GROUP.size]),
		weight: numberScale(doc, [...path, DTCG_GROUP.weight], 'fontWeight'),
		lineHeight: numberScale(doc, [...path, DTCG_GROUP.lineHeight], 'number'),
	};
}

function motionOf(doc: Doc) {
	const path = [DTCG_GROUP.motion];
	const durationPath = [...path, DTCG_GROUP.duration];
	const easingPath = [...path, DTCG_GROUP.easing];

	requireOnly(groupAt(doc, path), [DTCG_GROUP.duration, DTCG_GROUP.easing], doc, path);

	return {
		duration: mapGroup(groupAt(doc, durationPath), doc, durationPath, (node, tokenPath) => {
			const token = tokenAt(node, 'duration', doc, tokenPath);

			return {
				...magnitudeOf(valueOf(token, doc, tokenPath), doc, [...tokenPath, '$value']),
				$extensions: ownExtensions(token, doc, tokenPath),
			};
		}),
		easing: mapGroup(groupAt(doc, easingPath), doc, easingPath, (node, tokenPath) => {
			const token = tokenAt(node, 'cubicBezier', doc, tokenPath);

			return {
				value: cubicBezierOf(valueOf(token, doc, tokenPath), doc, [...tokenPath, '$value']),
				$extensions: ownExtensions(token, doc, tokenPath),
			};
		}),
	};
}

function focusRingOf(doc: Doc) {
	const path = [DTCG_GROUP.focusRing];

	requireOnly(groupAt(doc, path), ['width', 'offset'], doc, path);

	const dimensions = dimensionScale(doc, path);

	return { width: dimensions.width, offset: dimensions.offset };
}

/**
 * One ramp, rebuilt from the group of steps that named it.
 *
 * The steps are sorted rather than trusted. `"1"` through `"12"` are integer-like keys and every JS
 * engine hands those back ascending, so a document this project wrote arrives in order for free. A
 * hand-edited one may not, and `RampSchema` wants 1 through 12 each exactly once in order.
 * Sorting accepts a shuffled document while a genuinely incomplete one still fails. Order is
 * spelling; a missing step is a missing colour.
 */
function rampStepOf(node: unknown, step: number, doc: Doc, path: readonly string[]) {
	const token = tokenAt(node, 'color', doc, path);
	const value = valueOf(token, doc, path);

	if (typeof value === 'string') {
		throw new Error(
			`${label(doc, path)} is an alias, and a primitive ramp step is the literal an alias points at`,
		);
	}

	return {
		step,
		...colorOf(value, doc, [...path, '$value']),
		$extensions: ownExtensions(token, doc, path),
	};
}

function rampOf(node: unknown, doc: Doc, path: readonly string[]) {
	const group = asNode(node, doc, path);

	if ('$type' in group) {
		throw new Error(`${label(doc, path)} is a token where a ramp of twelve steps was expected`);
	}

	const steps = Object.entries(group)
		.filter(([name]) => !isReservedName(name))
		.map(([name, stepNode]) => {
			const stepPath = [...path, name];
			const step = Number(name);

			if (!Number.isInteger(step)) {
				throw new Error(`${label(doc, stepPath)} is not named for a ramp step number`);
			}

			return rampStepOf(stepNode, step, doc, stepPath);
		});

	// `map` already returned a fresh array, so this sort mutates nothing the caller can see.
	// `toSorted` would say it directly and is ES2023 against an ES2022 target.
	// oxlint-disable-next-line unicorn/no-array-sort
	return steps.sort((a, b) => a.step - b.step);
}

/**
 * Cambium's alias is `ramp.step` and DTCG's is `{color.primitive.ramp.step}`, so this is a
 * translation rather than a copy—the mirror image of `aliasToken` in `serialize.ts`.
 *
 * The pattern is tested here and again inside `fromDtcgAlias`, which is one check more than the
 * work needs. It buys a message that names the token: `fromDtcgAlias` reports only the offending
 * string, and a person holding two documents needs to know where that string sat.
 */
function internalAlias(value: unknown, doc: Doc, path: readonly string[]): string {
	if (typeof value !== 'string' || !DTCG_ALIAS_PATTERN.test(value)) {
		throw new Error(
			`${label(doc, path)} holds ${JSON.stringify(value)} where a curly-brace alias belongs; a semantic colour flattened to a literal is one the token set cannot point at`,
		);
	}

	const [group, kind, ...target] = fromDtcgAlias(value);

	if (group !== DTCG_GROUP.color || kind !== DTCG_GROUP.primitive || target.length !== 2) {
		throw new Error(
			`${label(doc, path)} points at ${value}, and a semantic colour has to name a step of a primitive ramp`,
		);
	}

	return target.join('.');
}

/**
 * One scheme: the two colour layers plus the shadow scale `SchemeSchema` carries per scheme.
 *
 * Called for light and for dark, and the light result is used twice—once under `schemes.light`
 * and once unprefixed, which is the mirror `checkMirroredLayers` requires.
 *
 * The mirror is the one place this function falls short of a perfect inverse. `serialize.ts` unions
 * the two copies' foreign `$extensions` namespaces, following the ruling in `core/token-set.ts`
 * that both copies are one token written twice and the union is the honest reading. A union cannot
 * be undone. The emitted token does not record which copy an annotation came from, so a token set
 * whose two copies carried different foreign annotations comes back with both annotations on both
 * copies.
 *
 * That widens the token set rather than losing anything from it. Nothing is dropped,
 * `checkMirroredLayers` exempts foreign namespaces so it still parses, and the round trip is
 * equivalent in every way the mirror check measures. It is still not deep-equal, which is why it is
 * written down here. Nothing produces a divergent mirror today: `buildTokenSet` writes both copies
 * from one object, and the carve-out exists for a future annotator. Picking one copy was the
 * alternative, and it drops data DTCG 5.2.3 requires a tool to preserve.
 */
function schemeFrom(doc: Doc) {
	const colorPath = [DTCG_GROUP.color];
	const primitivePath = [...colorPath, DTCG_GROUP.primitive];
	const semanticPath = [...colorPath, DTCG_GROUP.semantic];

	requireOnly(groupAt(doc, colorPath), [DTCG_GROUP.primitive, DTCG_GROUP.semantic], doc, colorPath);

	return {
		primitives: mapGroup(groupAt(doc, primitivePath), doc, primitivePath, (node, rampPath) =>
			rampOf(node, doc, rampPath),
		),
		semantic: mapGroup(groupAt(doc, semanticPath), doc, semanticPath, (node, tokenPath) => {
			const token = tokenAt(node, 'color', doc, tokenPath);

			return {
				alias: internalAlias(valueOf(token, doc, tokenPath), doc, tokenPath),
				$extensions: ownExtensions(token, doc, tokenPath),
			};
		}),
		shadow: { source: 'derived', values: shadowValues(doc) },
	};
}

function shadowValues(doc: Doc) {
	const path = [DTCG_GROUP.shadow];

	return mapGroup(groupAt(doc, path), doc, path, (node, tokenPath) => {
		const token = tokenAt(node, 'shadow', doc, tokenPath);
		const valuePath = [...tokenPath, '$value'];
		const value = asNode(valueOf(token, doc, tokenPath), doc, valuePath);
		const geometry = (name: string) =>
			magnitudeOf(childOf(value, name, doc, [...valuePath, name]), doc, [...valuePath, name]);

		return {
			color: colorOf(childOf(value, 'color', doc, [...valuePath, 'color']), doc, [
				...valuePath,
				'color',
			]),
			offsetX: geometry('offsetX'),
			offsetY: geometry('offsetY'),
			blur: geometry('blur'),
			spread: geometry('spread'),
			$extensions: ownExtensions(token, doc, tokenPath),
		};
	});
}

/**
 * The eight groups that live once on the `TokenSet` and are written into both documents.
 *
 * They are read from light and checked against dark, and a disagreement is an error rather than a
 * preference: the token set has one slot, so two spellings of one token is a question this function
 * has no standing to answer.
 *
 * That is harsher than the mirror's foreign-namespace carve-out one layer up, and the two cases
 * really do differ. The mirror's two copies are one scheme duplicated inside one file, so a union
 * reads both as annotations on the same token. These are two documents a consumer may load
 * independently, so a merged answer would be a third value neither document states.
 *
 * The comparison runs over raw document subtrees, before anything is interpreted, so a difference
 * is reported at the JSON that differs rather than at whichever internal field it landed in.
 */
function checkDocumentsAgree(light: Doc, dark: Doc): void {
	for (const doc of [light, dark]) requireOnly(doc.root, ROOT_GROUPS, doc, []);

	for (const group of SHARED_GROUPS) {
		// `groupAt` returns a DTCG group node, which is the one place the walk starts knowing where it
		// is. Everything below is worked out from there rather than guessed at from the node's shape.
		const difference = firstDifference(
			groupAt(light, [group]),
			groupAt(dark, [group]),
			[group],
			true,
		);

		if (difference !== undefined) {
			throw new Error(
				`${difference} differs between the light and dark documents, and the token set holds it once`,
			);
		}
	}
}

/**
 * Where two subtrees first disagree, as a dotted path, or `undefined` when they do not.
 *
 * A path rather than a boolean because the consumer is a person with two files open, and "the
 * typography groups differ" sends them to read a hundred tokens. Key order is ignored, since a
 * round trip through any JSON tool reorders keys without changing a token.
 *
 * A group's reserved names are skipped, the same way the walks skip them, because this comparison
 * exists to protect a value the token set holds once and group metadata is held no times at all.
 * Two documents that differ only in a `$description` disagree about no token, and reporting that as
 * "differs ... and the token set holds it once" would name a thing the token set does not hold. So
 * a one-sided `$description` is read past, exactly like a two-sided one. It cannot be preserved
 * instead: a `TokenSet` has nowhere to put a group's metadata, so there is no copy to keep and
 * nothing is lost by not comparing it.
 *
 * `atGroupNode` is what confines that skip to a real DTCG group, and it is a parameter rather than
 * a test on the node because no test on the node can answer it. A group is recognisable only by
 * where it sits: an `$extensions` payload, a vendor's object inside one, and a group all look
 * alike, so asking "does this carry `$type`?" answers "group" about a payload and skips a
 * vendor's `$`-prefixed key. That read one document's payload and discarded the other's in silence,
 * in the one function whose job is to refuse exactly that. The position is tracked instead: the
 * caller starts the walk at a group, a named child of a group is another group only if it carries
 * no `$type`, and once the walk steps into a token nothing below it is ever skipped again.
 *
 * The path would have served as well and was the other candidate. It loses because reading position
 * off a dotted path means writing down which depths hold tokens under which family, and that is the
 * document's shape stated a second time, free to drift from the tree the walk is actually standing
 * in. `atGroupNode` is computed from that tree on the way down and cannot disagree with it.
 *
 * So a token's own keys stay compared, `$extensions` above all: the `com.cambium` payload is data
 * the token set keeps in a slot it keeps once, and two documents claiming different provenance for
 * one token is a real disagreement with no honest answer. Everything inside that payload, to any
 * depth and through any array, is compared with it.
 */
function firstDifference(
	light: unknown,
	dark: unknown,
	path: readonly string[],
	atGroupNode: boolean,
): string | undefined {
	if (light === dark) return undefined;

	if (typeof light !== 'object' || typeof dark !== 'object' || light === null || dark === null) {
		return path.join('.');
	}

	if (Array.isArray(light) !== Array.isArray(dark)) return path.join('.');

	const left = light as Node;
	const right = dark as Node;

	for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
		if (atGroupNode && isReservedName(key)) continue;

		if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return [...path, key].join('.');

		// Both sides have to be groups for the child to count as one. A `$type` on one document and
		// not the other means one is a token where the other is a group, and that is a disagreement to
		// report rather than a difference to skip.
		const childAtGroupNode = atGroupNode && isGroupChild(left[key]) && isGroupChild(right[key]);

		const difference = firstDifference(left[key], right[key], [...path, key], childAtGroupNode);

		if (difference !== undefined) return difference;
	}

	return undefined;
}

/**
 * Whether a named child of a group is itself a group rather than a token, by the same `$type` test
 * `groupAt` makes.
 *
 * Only ever asked of a node whose parent is already known to be a group, and that precondition is
 * what keeps the `$type` test honest: DTCG gives a group nothing but groups and tokens under its
 * named keys, so the absence of `$type` settles which. Asked of an arbitrary nested object the same
 * test answers "group" about something that is not one, which is the defect this replaced.
 */
function isGroupChild(node: unknown): boolean {
	return typeof node === 'object' && node !== null && !Array.isArray(node) && !('$type' in node);
}
