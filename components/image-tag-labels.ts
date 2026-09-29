import type { ImageTag } from '../core/image-tag';

/**
 * The words a person picked a tag by, shared so the picker's alt text, the saved screen and the
 * seed rail's thumbnails name a tag the way the picker's select did. The Show source dialog's alt
 * still prints the raw tag. It lives outside `upload-form.tsx` so the workspace chunk can import
 * it without pulling in the upload form and `lib/image-intake` behind it.
 */
export const TAG_LABELS: Record<ImageTag, string> = {
	auto: 'Automatic',
	logo: 'Logo',
	ui: 'Interface',
	photo: 'Photograph',
	artwork: 'Artwork',
};
