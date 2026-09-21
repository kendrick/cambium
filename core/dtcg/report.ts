import type { DtcgViolation } from './validate';

/**
 * One guess at one mistake, standing in for the diagnostics that appear to describe it.
 *
 * Every field is deliberately narrow about what it promises. `likelyCause` is the single most
 * specific thing the schema said at `pointer`; it is a guess, because a failed `oneOf` reports
 * every branch it rejected and nothing in the output says which branch the author meant.
 * `alternatives` holds the other readings of that same spot, so a reader who disagrees with the
 * guess can see what else was on offer. `collapsed` is how many of the original violations this
 * row stands in for, which is the only thing that tells one mistake apart from twenty.
 *
 * A summary is lossy by construction. It points at a likely cause, and a row count is not a
 * problem count. Anything that needs every diagnostic reads `violations` from `validateDtcg`,
 * which stays complete precisely so this can be approximate.
 */
export type DtcgViolationSummary = {
	pointer: string;
	likelyCause: string;
	alternatives: string[];
	collapsed: number;
};

/**
 * Ajv's wording for the `additionalProperties` keyword, matched exactly rather than loosely
 * because `validate.ts` joins the offending key onto that one diagnostic's pointer and no other.
 * The message is the only surviving trace of the keyword — `DtcgViolation` carries no `keyword`
 * field, and widening it to carry one would change what `validateDtcg` returns.
 *
 * If Ajv ever rewords the message, the fold below stops firing and `report.test.ts`'s bad-hue case
 * splits into two rows. Fix this constant rather than that test.
 */
const ADDITIONAL_PROPERTY_MESSAGE = 'must NOT have additional properties';

/**
 * Diagnostics about the shape of the attempt rather than about a value: a combinator reporting
 * that no branch matched, a conditional reporting which half it took, a branch demanding a
 * property the author never meant to write, a branch rejecting a key that is legal where it sits.
 * Each one says that something failed without saying what the value should have been.
 */
const BRANCH_SHAPE_MESSAGE =
	/^must (?:match exactly one schema in oneOf|match some schema in anyOf|match all schemas in allOf|match "(?:then|else)" schema|have required property|NOT have additional properties$)/;

/**
 * Diagnostics that place a value in the wrong branch without saying anything about the value. A
 * `const` failure belongs here because under `oneOf` it is a discriminator. "must be equal to
 * constant" says the value took a different branch and says nothing about whether the value is
 * wrong.
 */
const BRANCH_TYPE_MESSAGE =
	/^must be (?:string|number|integer|boolean|object|array|null|equal to constant)$/;

function specificity(message: string): number {
	if (BRANCH_SHAPE_MESSAGE.test(message)) return 2;
	if (BRANCH_TYPE_MESSAGE.test(message)) return 1;

	return 0;
}

/**
 * Depth is counted in RFC 6901 reference tokens, not in characters or slashes. A key containing a
 * slash arrives escaped as `~1`, so a raw string measure reads `/color/a~1b` as deeper than
 * `/color/a/b` when it is shallower. The deepest-wins rule below would then hand the summary the
 * wrong spot.
 */
function segmentsOf(pointer: string): string[] {
	return pointer === '' ? [] : pointer.slice(1).split('/');
}

/**
 * The inverse. No reference tokens is the empty pointer, which is what RFC 6901 evaluates to the
 * whole document; `/` is the property named by the empty string and a different place entirely.
 */
function pointerOf(segments: readonly string[]): string {
	return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

/**
 * Where a diagnostic actually failed, which is not always where it is reported.
 *
 * `validate.ts` appends the offending key to an `additionalProperties` pointer so a UI can
 * highlight the field. That makes the pointer more useful and one segment deeper than the failure
 * Ajv found, which is at the parent object. Ranking on the reported depth would let a rejected
 * alias branch complaining about a legal `colorSpace` key outrank the real `exclusiveMaximum` on
 * the hue beneath it. Rank on the anchor, report the pointer.
 */
function anchorOf(violation: DtcgViolation): string[] {
	const segments = segmentsOf(violation.pointer);

	return violation.message === ADDITIONAL_PROPERTY_MESSAGE ? segments.slice(0, -1) : segments;
}

function isAncestorOrSelf(ancestor: readonly string[], descendant: readonly string[]): boolean {
	return (
		ancestor.length <= descendant.length &&
		ancestor.every((segment, index) => segment === descendant[index])
	);
}

/**
 * Groups a validation failure's diagnostics by where they happened and offers one likely cause per
 * group. Additive: `validateDtcg` still returns every diagnostic, and this function reads that
 * list without touching it.
 *
 * #52's review asked for the collapsing to happen inside `validateDtcg` and the repo declined,
 * because choosing which `oneOf` branch the author meant is a guess and a wrong guess drops a real
 * error elsewhere in the document. That reasoning has not changed; what changed is where the guess
 * lives. A guess made beside the raw list can be wrong without costing anything, because the raw
 * list is still there.
 *
 * The rule is deepest-wins along a chain. Diagnostics are anchored (see `anchorOf`), the distinct
 * anchors that no other anchor extends become the rows, and every diagnostic is counted against
 * the deepest row it is an ancestor of. One bad OKLCH hue anchors entirely on the chain
 * `/color` → `/color/brand` → `/color/brand/$value` → `.../components/2`, so nineteen diagnostics
 * become one row naming the hue.
 *
 * Two mistakes in two places branch instead of chaining, and stay two rows. The anchoring carries
 * more weight here than the ranking does. Merge two real mistakes into one row and the summary has
 * hidden a problem behind a plausible neighbour, which is what #52 declined to risk. A diagnostic
 * reported at a shared ancestor of both rows is counted against one of them rather than
 * duplicated, so `collapsed` across the rows adds up to the number of violations handed in.
 */
export function summarizeViolations(violations: readonly DtcgViolation[]): DtcgViolationSummary[] {
	const anchored = violations.map((violation) => ({ violation, anchor: anchorOf(violation) }));
	const anchors = anchored.map(({ anchor }) => anchor);

	const seen = new Set<string>();
	const rows = anchors
		.filter((anchor) => {
			const key = anchor.join('/');

			if (seen.has(key)) return false;
			seen.add(key);

			return true;
		})
		.filter(
			(anchor) =>
				!anchors.some((other) => other.length > anchor.length && isAncestorOrSelf(anchor, other)),
		)
		.map((anchor) => ({ anchor, members: [] as typeof anchored }));

	for (const item of anchored) {
		// Every anchor either is a row or is a proper ancestor of a deeper anchor, and following that
		// chain down always ends on a row, so `home` is never undefined. The optional call is what
		// TypeScript charges for an invariant it cannot see.
		const home = rows.reduce<(typeof rows)[number] | undefined>(
			(deepest, row) =>
				isAncestorOrSelf(item.anchor, row.anchor) &&
				(deepest === undefined || row.anchor.length > deepest.anchor.length)
					? row
					: deepest,
			undefined,
		);

		home?.members.push(item);
	}

	return rows.map(({ anchor, members }) => {
		// Decorated with the input index rather than leaning on sort stability, so the output is the
		// same list on every engine. Determinism is an acceptance criterion here, not a nicety.
		const ranked = members
			.filter((member) => member.anchor.length === anchor.length)
			.map((member, index) => ({
				message: member.violation.message,
				pointer: member.violation.pointer,
				index,
			}))
			// `map` already returned a fresh array, so this sort mutates nothing the caller can see.
			// `toSorted` would satisfy the rule directly, but it is ES2023 and tsconfig targets ES2022,
			// the same trade core/family-variants.ts makes.
			// oxlint-disable-next-line unicorn/no-array-sort
			.sort((a, b) => specificity(a.message) - specificity(b.message) || a.index - b.index);

		// A row is built from an anchor some diagnostic reported, so `ranked` always has a first
		// element. The fallbacks below are what TypeScript charges for an invariant it cannot see.
		const [best, ...rest] = ranked;
		const alternatives = new Set(rest.map(({ message }) => message));

		// A branch rejected twice says nothing the second time, and `collapsed` already carries the
		// volume. Deduplicating here keeps `alternatives` a list of distinct readings.
		alternatives.delete(best?.message ?? '');

		return {
			pointer: best?.pointer ?? pointerOf(anchor),
			likelyCause: best?.message ?? '',
			alternatives: [...alternatives],
			collapsed: members.length,
		};
	});
}
