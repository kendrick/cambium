/**
 * What the set of picked reference images is, and what it still needs.
 *
 * Issue #1 rejects a mode toggle between structured and freeform input: a tag is per-image and a
 * mixed upload has to work, so the set rather than the screen is what carries the state. Guidance
 * keys off the tags present, which is why the vocabulary and the suggestion live in one module.
 */

import type { ImageTag } from '../../core/image-tag';

// The vocabulary itself lives in `core/image-tag.ts` now that #77 gives `ReferenceImageSchema` a
// `tag` field: `core/` can't import from `components/`, so the schema needed its own copy and this
// module re-exports it rather than keeping a second one to drift out of sync.
export { DEFAULT_IMAGE_TAG, IMAGE_TAGS, type ImageTag } from '../../core/image-tag';

/**
 * One image is enough to generate from; three is where a single Messages API call stops paying for
 * itself. Both numbers are the ticket's, not a guess.
 */
export const MIN_REFERENCE_IMAGES = 1;
export const MAX_REFERENCE_IMAGES = 3;

/**
 * Which suggestion the set has earned, separated from the sentence that says it.
 *
 * `docs/agents/testing.md` rejects component tests because the interface is still moving, and
 * pinning exact wording is that same brittleness one layer down. The choice is behaviour worth
 * asserting; the prose is not, so the copy table below is deliberately left untested.
 */
export type GuidanceKey =
	| 'empty'
	| 'full'
	| 'untagged'
	| 'needs-mark'
	| 'needs-surfaces'
	| 'needs-mood';

/**
 * Suggests whatever the set is missing most, in the order the three signals actually rank.
 *
 * A logo is the only image that states the brand's colour outright rather than leaving it to be
 * inferred from a background, so its absence outranks everything. A screenshot is the only one that
 * shows surfaces, borders, and type in use. A photograph or a poster carries temperature and a
 * wider palette than either. Anything tagged `auto` is left out of the reckoning, because the whole
 * point of the default is that the person has not said.
 */
export function chooseGuidance(tags: readonly ImageTag[]): GuidanceKey {
	if (tags.length === 0) return 'empty';

	// Checked before anything else: at the limit there is no fourth image to suggest, so naming one
	// would be advice nobody can take.
	if (tags.length >= MAX_REFERENCE_IMAGES) return 'full';

	if (tags.every((tag) => tag === 'auto')) return 'untagged';

	if (!tags.includes('logo')) return 'needs-mark';
	if (!tags.includes('ui')) return 'needs-surfaces';

	return 'needs-mood';
}
