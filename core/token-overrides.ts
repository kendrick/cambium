import { type TokenSet, TokenSetSchema } from './token-set';

export type SchemeName = 'light' | 'dark';

/** The eight non-colour categories that live at the top level only, so a leaf there has no scheme. */
export type ValueCategory =
	| 'radius'
	| 'typography'
	| 'tracking'
	| 'spacing'
	| 'opacity'
	| 'motion'
	| 'focusRing'
	| 'zIndex';

/**
 * Keys under a category's `values`, down to one numeric leaf: `['lg', 'value']` for a radius,
 * `['md', 'offsetY', 'value']` for a shadow, `['easing', 'standard', 'value', 1]` for one slot of a
 * cubic bezier. An array rather than a dotted string because token names are any non-empty string
 * and may hold a dot themselves.
 */
export type ValuePath = readonly (string | number)[];

/**
 * One user edit to a derived set, shaped so that applying it still yields a valid `TokenSet`.
 *
 * Each kind replaces values and never `$extensions`. Provenance says what the pipeline derived, and
 * an override is a statement about the user rather than the brand, so the list marks overridden
 * tokens from the override map instead of rewriting the payload that explains the derivation.
 *
 * Shadow is the one non-colour category a scheme carries, so a shadow leaf needs a `scheme` where
 * the other categories' leaves have exactly one home.
 */
export type TokenOverride =
	| { kind: 'alias'; scheme: SchemeName; token: string; alias: string }
	| {
			kind: 'primitive';
			scheme: SchemeName;
			ramp: string;
			step: number;
			l: number;
			c: number;
			h: number;
	  }
	| { kind: 'value'; category: ValueCategory; path: ValuePath; value: number }
	| { kind: 'value'; category: 'shadow'; scheme: SchemeName; path: ValuePath; value: number };

export type OverrideIssue = { path: (string | number)[]; message: string };

export type ApplyOverridesResult =
	| { ok: true; tokenSet: TokenSet }
	| { ok: false; key: string; issues: OverrideIssue[] };

/**
 * Names the leaf an override targets, not what it writes there, so a second edit to the same token
 * replaces the first in a map keyed by this.
 *
 * JSON over a joined string because names may contain any separator we'd pick: `['a.b', 'value']`
 * and `['a', 'b.value']` would collide on a dot join.
 */
export function overrideKey(override: TokenOverride): string {
	switch (override.kind) {
		case 'alias':
			return JSON.stringify(['alias', override.scheme, override.token]);
		case 'primitive':
			return JSON.stringify(['primitive', override.scheme, override.ramp, override.step]);
		case 'value':
			return JSON.stringify(
				override.category === 'shadow'
					? ['value', 'shadow', override.scheme, ...override.path]
					: ['value', override.category, ...override.path],
			);
	}
}

type Draft = Record<string, unknown> & { schemes: Record<SchemeName, Record<string, unknown>> };

/**
 * The top level mirrors the light scheme and `checkMirroredLayers` rejects any disagreement, so a
 * light edit lands in both copies. A dark edit lands in one: the mirror holds light's values, and
 * writing dark's there is exactly the wrong-theme bug that check exists to catch.
 */
function copiesOf(draft: Draft, scheme: SchemeName, layer: string): unknown[] {
	const copies = [draft.schemes[scheme][layer]];

	if (scheme === 'light') copies.push(draft[layer]);

	return copies;
}

function isContainer(value: unknown): value is Record<string | number, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Walks to the parent of a numeric leaf and returns it with the final key, or an issue.
 *
 * `Object.hasOwn` at each step because `values` is a plain record: a path of `['constructor']`
 * would otherwise walk into the prototype, the same trap `declaredRamp` guards against. And the
 * walk refuses `$extensions` so a value override can't reach the provenance payload.
 */
function leafParent(
	root: unknown,
	path: ValuePath,
): { parent: Record<string | number, unknown>; key: string | number } | { message: string } {
	if (path.length === 0) return { message: 'path is empty' };

	let node = root;

	for (const [index, segment] of path.entries()) {
		if (segment === '$extensions') return { message: 'an override cannot rewrite $extensions' };
		if (!isContainer(node) || !Object.hasOwn(node, segment)) {
			return { message: `nothing at ${path.slice(0, index + 1).join('.')}` };
		}
		if (index === path.length - 1) {
			return typeof node[segment] === 'number'
				? { parent: node, key: segment }
				: { message: `${path.join('.')} is not a numeric leaf` };
		}
		node = node[segment];
	}

	return { message: 'path is empty' };
}

/** Writes the override into `draft` in place, or returns why it has no target. */
function write(draft: Draft, override: TokenOverride): OverrideIssue | null {
	switch (override.kind) {
		case 'alias': {
			const path = ['schemes', override.scheme, 'semantic', override.token];

			for (const semantic of copiesOf(draft, override.scheme, 'semantic')) {
				if (!isContainer(semantic) || !Object.hasOwn(semantic, override.token)) {
					return { path, message: `no semantic token "${override.token}" to override` };
				}
				(semantic[override.token] as { alias: string }).alias = override.alias;
			}
			return null;
		}
		case 'primitive': {
			const path = ['schemes', override.scheme, 'primitives', override.ramp, override.step];

			for (const primitives of copiesOf(draft, override.scheme, 'primitives')) {
				const ramp =
					isContainer(primitives) && Object.hasOwn(primitives, override.ramp)
						? primitives[override.ramp]
						: undefined;
				const step = Array.isArray(ramp)
					? ramp.find((entry: { step: number }) => entry.step === override.step)
					: undefined;

				if (!step) {
					return { path, message: `no step ${override.ramp}.${override.step} to override` };
				}
				Object.assign(step, { l: override.l, c: override.c, h: override.h });
			}
			return null;
		}
		case 'value': {
			const roots =
				override.category === 'shadow'
					? copiesOf(draft, override.scheme, 'shadow')
					: [draft[override.category]];
			const prefix =
				override.category === 'shadow'
					? ['schemes', override.scheme, 'shadow', 'values']
					: [override.category, 'values'];

			for (const root of roots) {
				const found = leafParent(isContainer(root) ? root.values : undefined, override.path);

				if ('message' in found)
					return { path: [...prefix, ...override.path], message: found.message };
				found.parent[found.key] = override.value;
			}
			return null;
		}
	}
}

function issuesOf(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }) {
	return error.issues.map((issue) => ({
		path: issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
		message: issue.message,
	}));
}

/**
 * Applies each override to a copy of `tokenSet` and validates the result with `TokenSetSchema`.
 *
 * Validates after every override rather than once at the end, so a failure is pinned to the
 * override that caused it and the UI can mark that one control. Overrides in the store are few, and
 * a parse per edit is cheap next to the derivation that produced the set.
 *
 * The base set is checked first. An invalid base is a caller bug, and letting it through would
 * blame whichever override happened to run first.
 */
export function applyOverrides(
	tokenSet: TokenSet,
	overrides: readonly TokenOverride[],
): ApplyOverridesResult {
	const base = TokenSetSchema.safeParse(tokenSet);

	if (!base.success) {
		throw new Error(`applyOverrides was given an invalid token set: ${base.error.message}`);
	}

	let current = base.data;

	for (const override of overrides) {
		const key = overrideKey(override);
		const draft = structuredClone(current) as unknown as Draft;
		const missing = write(draft, override);

		if (missing) return { ok: false, key, issues: [missing] };

		const parsed = TokenSetSchema.safeParse(draft);

		if (!parsed.success) return { ok: false, key, issues: issuesOf(parsed.error) };

		current = parsed.data;
	}

	return { ok: true, tokenSet: current };
}
