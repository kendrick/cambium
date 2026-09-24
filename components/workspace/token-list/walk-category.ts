import type { ValuePath } from '../../../core/token-overrides';
import type { TokenExtensions } from '../../../core/token-set';

/** A leaf's path under its own token's object: `['value']`, or `['offsetY', 'value']`. */
export type CategoryLeaf = {
	suffix: ValuePath;
	value: number;
	unit?: string;
};

export type CategoryToken = {
	/** The path from the category's `values` root to the object carrying `$extensions`. */
	path: ValuePath;
	extensions: TokenExtensions;
	leaves: CategoryLeaf[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A category's `values` nests differently everywhere: a bare dimension, a record of dimensions, a
 * shadow with five parts sharing one `$extensions`, a cubic bezier tuple. Nothing exports a leaf
 * lister for any of them, so this walks to whichever object carries `$extensions` — that object is
 * one token's provenance, however deep it sits — and takes everything numeric beneath it as that
 * token's leaves. A shadow's four geometry fields and its colour's four channels come back as eight
 * leaves under one `$extensions`, because that is the one payload describing all of them.
 */
export function walkCategoryTokens(values: unknown, path: ValuePath = []): CategoryToken[] {
	if (Array.isArray(values)) {
		return values.flatMap((entry, index) => walkCategoryTokens(entry, [...path, index]));
	}

	if (!isPlainObject(values)) return [];

	if (Object.hasOwn(values, '$extensions')) {
		return [
			{
				path,
				extensions: values.$extensions as TokenExtensions,
				leaves: collectLeaves(values),
			},
		];
	}

	return Object.entries(values).flatMap(([key, child]) =>
		walkCategoryTokens(child, [...path, key]),
	);
}

/**
 * Every numeric value under a token's own object, paired with the unit its immediate parent
 * declares. A dimension's `unit` sits beside its own `value`; a shadow's colour channels have none,
 * so only the leaf actually named `value` in that object picks one up.
 */
function collectLeaves(node: unknown, suffix: ValuePath = []): CategoryLeaf[] {
	// A cubic bezier's tuple recurses straight into numbers with no object wrapping each one, unlike
	// every other shape here, where a number only ever turns up as a named field one level up. Without
	// this, `collectLeaves` would recurse into each tuple entry and find nothing to collect.
	if (typeof node === 'number') {
		return [{ suffix, value: node }];
	}

	if (Array.isArray(node)) {
		return node.flatMap((entry, index) => collectLeaves(entry, [...suffix, index]));
	}

	if (!isPlainObject(node)) return [];

	const unit = typeof node.unit === 'string' ? node.unit : undefined;

	return Object.entries(node)
		.filter(([key]) => key !== '$extensions' && key !== 'unit')
		.flatMap(([key, child]) => {
			if (typeof child === 'number') {
				return [
					{ suffix: [...suffix, key], value: child, unit: key === 'value' ? unit : undefined },
				];
			}
			return collectLeaves(child, [...suffix, key]);
		});
}
