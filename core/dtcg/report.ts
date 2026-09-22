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
 * The property the DTCG alias branch demands. A token is an alias or a value and never both, so a
 * `required` asking for `$ref` of something written as a value is a complaint from a branch the
 * author did not take. Every failing document draws one, at every failing node, which makes it the
 * single most frequent artifact the schema produces and the one thing a summary must never lead
 * with.
 */
const ALIAS_PROPERTY = '$ref';

/**
 * Keywords that report the shape of the attempt rather than anything about a value. A combinator
 * saying no branch matched, a conditional saying which half it took, a negation: each says that
 * something failed without saying what the value should have been.
 */
const BRANCH_SHAPE_KEYWORDS = new Set(['oneOf', 'anyOf', 'allOf', 'if', 'not']);

/**
 * Keywords that place a value in the wrong branch, or report a key against one branch's idea of
 * what is allowed. `const` belongs here because under `oneOf` it is a discriminator: failing it
 * says the value took a different branch, never that the value is wrong. `additionalProperties`
 * belongs here for the reason `validate.ts` gives: under a failed `oneOf` it is a claim about one
 * rejected branch, even where `anchorOf` can prove otherwise.
 */
const BRANCH_LOCAL_KEYWORDS = new Set([
	'type',
	'const',
	'additionalProperties',
	'additionalItems',
	'unevaluatedProperties',
]);

/**
 * How far a diagnostic sits from the value it is about. Zero is a claim the document itself
 * settles: a bound, a pattern, an enum, or a property that is genuinely absent. Two is a claim
 * about branch shape that never reaches a value.
 *
 * The scale runs this way round so that sorting ascending puts the most useful message first, and
 * the name says which end is which because the number alone reads backwards to anyone expecting a
 * score. It reads Ajv's `keyword` rather than matching on message text: a message is a rendering,
 * and two keywords that need different treatment can render alike.
 */
function vagueness(violation: DtcgViolation): number {
	if (violation.keyword === 'required') {
		return violation.params.missingProperty === ALIAS_PROPERTY ? 2 : 0;
	}

	if (BRANCH_SHAPE_KEYWORDS.has(violation.keyword)) return 2;
	if (BRANCH_LOCAL_KEYWORDS.has(violation.keyword)) return 1;

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
 * What the whole list says, read once so `anchorOf` can ask questions about one diagnostic that
 * only the other diagnostics can answer.
 *
 * `failingSites` holds the pointers some diagnostic reports on its own account, meaning anything
 * but a key-joined `additionalProperties`. `rejectionsPerKey` counts how many branches forbade
 * each named key, and `wholesaleFloor` is the smallest of those counts. `unresolved` holds the
 * nodes whose `if` diagnostics came from more than one `allOf` branch.
 */
type FoldContext = {
	failingSites: ReadonlySet<string>;
	rejectionsPerKey: ReadonlyMap<string, number>;
	wholesaleFloor: number;
	unresolved: readonly (readonly string[])[];
};

function foldContextFor(violations: readonly DtcgViolation[]): FoldContext {
	const failingSites = new Set<string>();
	const rejectionsPerKey = new Map<string, number>();
	const branchesPerNode = new Map<string, Set<string>>();

	for (const violation of violations) {
		if (violation.keyword === 'additionalProperties') {
			rejectionsPerKey.set(violation.pointer, (rejectionsPerKey.get(violation.pointer) ?? 0) + 1);
		} else {
			failingSites.add(violation.pointer);
		}

		if (violation.keyword === 'if') {
			const branches = branchesPerNode.get(violation.pointer) ?? new Set<string>();

			branches.add(violation.schemaPath);
			branchesPerNode.set(violation.pointer, branches);
		}
	}

	return {
		failingSites,
		rejectionsPerKey,
		wholesaleFloor: Math.min(...rejectionsPerKey.values(), Number.POSITIVE_INFINITY),
		unresolved: [...branchesPerNode]
			.filter(([, branches]) => branches.size > 1)
			.map(([pointer]) => segmentsOf(pointer)),
	};
}

function isAncestorOrSelf(ancestor: readonly string[], descendant: readonly string[]): boolean {
	return (
		ancestor.length <= descendant.length &&
		ancestor.every((segment, index) => segment === descendant[index])
	);
}

function isStrictAncestor(ancestor: readonly string[], descendant: readonly string[]): boolean {
	return ancestor.length < descendant.length && isAncestorOrSelf(ancestor, descendant);
}

/**
 * Where a diagnostic belongs, and whether it can be quoted once it gets there.
 *
 * Two things move a diagnostic away from where Ajv reported it, and they pull in opposite
 * directions.
 *
 * **A joined key moves up.** `validate.ts` appends the offending key to an `additionalProperties`
 * pointer so a UI can highlight the field, which makes the pointer more useful and one segment
 * deeper than the failure. Ranking on the reported depth would let a rejected alias branch
 * complaining about a legal `colorSpace` key outrank the real `exclusiveMaximum` on the hue
 * beneath it, so most of the time the anchor is the parent and the pointer stays as reported.
 *
 * Two questions keep a genuinely illegal key out of that fold, because folding one loses a true
 * violation outright. Did the parent fail on its own account? A
 * stray key at the root folds to the empty pointer, an ancestor of every diagnostic in the
 * document, which no diagnostic reports; folding there invents a failure site. And was the key
 * rejected more often than the quietest key in the document? Ajv reports `additionalProperties`
 * once per branch that forbids the key, and a branch permitting only `$ref` forbids every key of
 * an object equally, setting a floor every key clears. A key above that floor was rejected by a
 * branch that accepted its siblings—the branch the author was plausibly writing—so it is illegal
 * wherever it sits.
 *
 * That count is the one rule here still inferred rather than read. `params.additionalProperty`
 * names the key outright, but the standalone validator flattens every `additionalProperties`
 * `schemaPath` to `#/additionalProperties`, so the branch that rejected it is not recoverable and
 * repetition is the only signal left. The floor is taken across the document rather than per
 * parent, because per parent a lone illegal key is its own floor and folds away. Reading it wider
 * costs a spurious row if some object is rejected wholesale by two branches instead of one, and
 * #52 already ruled which way that trade goes.
 *
 * **An unresolved branch moves down-stream diagnostics up, and marks them.** The schema keys one
 * `if`/`then` pair per colour space on `colorSpace`. Omit the key and every pair applies at once,
 * each complaining about the components against its own space's range, so a legal component draws
 * `must be <= 1` eight times over. A node whose `if` diagnostics span more than one `#/allOf/N/if`
 * has no branch selected, and nothing reported beneath it is decidable until it does. Those
 * diagnostics anchor at the node and come back `echoed`, which counts them without letting them be
 * quoted: reporting a bound on a value that is fine is worse than saying nothing about it, because
 * a caller who acts on it edits something that was already correct.
 *
 * A key the fold proved illegal is exempt from that, because a key no branch permits is forbidden
 * whichever branch was meant.
 */
function anchorOf(
	violation: DtcgViolation,
	fold: FoldContext,
): { anchor: string[]; echoed: boolean } {
	const segments = segmentsOf(violation.pointer);

	if (violation.keyword === 'additionalProperties') {
		const parent = pointerOf(segments.slice(0, -1));
		const forbiddenByEveryBranch =
			(fold.rejectionsPerKey.get(violation.pointer) ?? 0) > fold.wholesaleFloor;

		if (!fold.failingSites.has(parent) || forbiddenByEveryBranch) {
			return { anchor: segments, echoed: false };
		}

		return { anchor: segments.slice(0, -1), echoed: false };
	}

	const host = fold.unresolved.reduce<readonly string[] | undefined>(
		(deepest, node) =>
			isStrictAncestor(node, segments) && (deepest === undefined || node.length > deepest.length)
				? node
				: deepest,
		undefined,
	);

	return host === undefined
		? { anchor: segments, echoed: false }
		: { anchor: [...host], echoed: true };
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
 * No caller consumes this yet. #11's note asked for the collapsing rule to be decided against a
 * real interface, and the validation UI that would be it is #23 and #24. The rule landed ahead of
 * its consumer so the serializer's failures have something to read; whether `alternatives` earns
 * its place is the first real caller's to say.
 *
 * The rule is deepest-wins along a chain. Diagnostics are anchored (see `anchorOf`), the anchors
 * that no other anchor extends become the rows, and every diagnostic is counted against the
 * deepest row it is an ancestor of. One bad OKLCH hue anchors entirely on the chain
 * `/color` → `/color/brand` → `/color/brand/$value` → `.../components/2`, so nineteen diagnostics
 * become one row naming the hue. A node that failed on its own account is a row as well, deeper
 * anchors or not, which is how a missing property survives an illegal key sitting beneath it.
 *
 * Every rule here is a statement about Ajv's `keyword`, `params` and `schemaPath` rather than an
 * inference from pointer shape or message text, with one exception that `anchorOf` names and
 * explains. A message is a rendering, and two keywords that need opposite treatment can render
 * alike.
 *
 * Two mistakes in two places branch instead of chaining, and stay two rows. The anchoring carries
 * more weight here than the ranking does, and `anchorOf` is where the hard part of it lives: a
 * mistake wrongly anchored onto another mistake's chain stops branching and disappears. Merge two
 * real mistakes into one row and the summary has hidden a problem behind a plausible neighbour,
 * which is what #52 declined to risk. A diagnostic reported at a shared ancestor of both rows is
 * counted against one of them rather than duplicated, so `collapsed` across the rows adds up to
 * the number of violations handed in.
 */
export function summarizeViolations(violations: readonly DtcgViolation[]): DtcgViolationSummary[] {
	const fold = foldContextFor(violations);
	const anchored = violations.map((violation) => ({ violation, ...anchorOf(violation, fold) }));
	const anchors = anchored.map(({ anchor }) => anchor);

	const seen = new Set<string>();
	const rows = anchors
		.filter((anchor) => {
			const key = anchor.join('/');

			if (seen.has(key)) return false;
			seen.add(key);

			return true;
		})
		.filter((anchor) => {
			const deepest = !anchors.some((other) => isStrictAncestor(anchor, other));

			// A node that failed on its own account is a row even when a deeper one exists. Without
			// this, a value missing `colorSpace` and carrying an illegal key would report only the
			// key, because the deeper anchor absorbs the shallower one and the missing property
			// vanishes, which is the loss #52 refused.
			const ownContent = anchored.some(
				(member) =>
					!member.echoed &&
					member.anchor.length === anchor.length &&
					isAncestorOrSelf(anchor, member.anchor) &&
					vagueness(member.violation) === 0,
			);

			return deepest || ownContent;
		})
		.map((anchor) => ({ anchor, members: [] as typeof anchored }));

	for (const item of anchored) {
		// A diagnostic belongs to its own node when that node is a row, and otherwise to the deepest
		// row below it. Taking the deepest match unconditionally would push a node's own failure down
		// into a descendant's row and leave the node's row empty.
		const exact = rows.find(
			(row) =>
				row.anchor.length === item.anchor.length && isAncestorOrSelf(item.anchor, row.anchor),
		);
		const home =
			exact ??
			rows.reduce<(typeof rows)[number] | undefined>(
				(deepest, row) =>
					isStrictAncestor(item.anchor, row.anchor) &&
					(deepest === undefined || row.anchor.length > deepest.anchor.length)
						? row
						: deepest,
				undefined,
			);

		// Every anchor either is a row or is a proper ancestor of a deeper anchor, and following that
		// chain down always ends on a row, so `home` is never undefined. The optional call is what
		// TypeScript charges for an invariant it cannot see.
		home?.members.push(item);
	}

	return rows.map(({ anchor, members }) => {
		// Decorated with the input index rather than leaning on sort stability, so the output is the
		// same list on every engine. Determinism is one of #11's acceptance criteria.
		const leastVagueFirst = members
			.filter((member) => !member.echoed && member.anchor.length === anchor.length)
			.map((member, index) => ({ violation: member.violation, index }))
			// `map` already returned a fresh array, so this sort mutates nothing the caller can see.
			// `toSorted` would satisfy the rule directly, but it is ES2023 and tsconfig targets ES2022,
			// the same trade core/family-variants.ts makes.
			// oxlint-disable-next-line unicorn/no-array-sort
			.sort((a, b) => vagueness(a.violation) - vagueness(b.violation) || a.index - b.index);

		// A row is either the deepest anchor on its chain or a node with a content diagnostic of its
		// own, and both put at least one unechoed diagnostic here. The fallbacks below are what
		// TypeScript charges for an invariant it cannot see.
		const [best, ...rest] = leastVagueFirst;
		const alternatives = new Set(rest.map(({ violation }) => violation.message));

		// A branch rejected twice says nothing the second time, and `collapsed` already carries the
		// volume. Deduplicating here keeps `alternatives` a list of distinct readings.
		alternatives.delete(best?.violation.message ?? '');

		return {
			pointer: best?.violation.pointer ?? pointerOf(anchor),
			likelyCause: best?.violation.message ?? '',
			alternatives: [...alternatives],
			collapsed: members.length,
		};
	});
}
