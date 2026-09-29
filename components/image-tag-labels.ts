import type { ImageTag } from '../core/image-tag';

/**
 * The words a person picked a tag by, shared so every place that names a tag afterwards (the
 * picker's alt text, the saved screen, the seed rail's thumbnails) says it the way the picker's
 * select did. It lives outside `upload-form.tsx` so the workspace chunk can import it without
 * pulling in the upload form and `lib/image-intake` behind it.
 */
export const TAG_LABELS: Record<ImageTag, string> = {
	auto: 'Automatic',
	logo: 'Logo',
	ui: 'Interface',
	photo: 'Photograph',
	artwork: 'Artwork',
};
