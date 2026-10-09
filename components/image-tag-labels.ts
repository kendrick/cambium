import type { ImageTag } from '../core/image-tag';

/**
 * The words a person picked a tag by, shared so the picker's alt text, the saved screen, the
 * seed rail's thumbnails and the Show source dialog name a tag the way the picker's select did. It
 * lives outside `upload-form.tsx` so the workspace chunk can import it without pulling in the upload
 * form and `lib/image-intake` behind it.
 */
export const TAG_LABELS: Record<ImageTag, string> = {
	auto: 'Automatic',
	logo: 'Logo',
	ui: 'Interface',
	photo: 'Photograph',
	artwork: 'Artwork',
};
