/**
 * The tag a person applies, which is a different thing from `BrandSeed.imageClassifications`, where
 * the model states what it thinks each image actually is. Issue #1 asks for the disagreement
 * between the two to be surfaced rather than hidden, so the four kinds are spelled the same here as
 * they are there and `auto` is the extra option only a person has.
 *
 * It lives in `core/` because a stored `ReferenceImage` carries one (#77), and `core/` cannot import
 * from `components/`. `components/landing/image-set.ts` re-exports it for the form.
 */
export const IMAGE_TAGS = ['auto', 'logo', 'ui', 'photo', 'artwork'] as const;

export type ImageTag = (typeof IMAGE_TAGS)[number];

export const DEFAULT_IMAGE_TAG: ImageTag = 'auto';
