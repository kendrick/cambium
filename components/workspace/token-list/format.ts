import type { ValuePath } from '../../../core/token-overrides';

/** DTCG's cubic-bezier tuple is `[x1, y1, x2, y2]`; nothing else in the set carries a numeric tuple. */
const EASING_PARAM_LABELS = ['x1', 'y1', 'x2', 'y2'];

/**
 * A leaf's path relative to its token, turned into a short label beside its input. Most tokens
 * carry one leaf named `value`, where the label is just that; a shadow or an easing curve carries
 * several, and the label is what tells their inputs apart without repeating the token's own name.
 */
export function leafLabel(suffix: ValuePath): string {
	if (suffix.length === 1 && suffix[0] === 'value') return 'value';

	const last = suffix.at(-1);

	if (typeof last === 'number' && suffix.at(-2) === 'value') {
		return EASING_PARAM_LABELS[last] ?? `value[${last}]`;
	}

	// A trailing `value` reads as noise once the segment before it already names the field, e.g.
	// `offsetX.value` becomes `offsetX`.
	return suffix
		.filter((segment, index) => !(segment === 'value' && index === suffix.length - 1))
		.join('.');
}
