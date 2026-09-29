import type { ReferenceImage } from '../../../core/brand-record';
import type { KeyColor } from '../../../core/brand-seed';
import { TAG_LABELS } from '@/components/image-tag-labels';
import { ReferenceThumbnail, type RegionOutline } from '@/components/reference-thumbnail';

/**
 * An outline's id is its colour's pin path, the same `keyColors.<n>` the rail's rows carry as
 * `data-seed-field`, so one string names a key colour everywhere in the rail.
 */
function outlinesFor(imageId: string, keyColors: readonly KeyColor[] | null): RegionOutline[] {
	return (keyColors ?? []).flatMap((color, index) =>
		color.sourceImageId === imageId && color.sourceRegion
			? [{ id: `keyColors.${index}`, region: color.sourceRegion }]
			: [],
	);
}

/**
 * Pinned above the scrolling field list so the brand stays on screen while a colour is tuned
 * (#155). The alt names position and tag because a stored record keeps no filename, and storing
 * one is a schema change #36's boundary rules out.
 */
export function ReferenceStrip({
	images,
	keyColors,
}: {
	images: readonly ReferenceImage[];
	keyColors: readonly KeyColor[] | null;
}) {
	if (images.length === 0) return null;

	return (
		<ul
			aria-label="Reference images"
			data-reference-strip
			className="flex shrink-0 items-start gap-2 overflow-x-auto"
		>
			{images.map((image, index) => (
				<li key={image.id}>
					<ReferenceThumbnail
						data-reference-thumbnail={image.id}
						src={image.downscaled}
						alt={`Reference image ${index + 1} of ${images.length}, ${TAG_LABELS[image.tag]}`}
						outlines={outlinesFor(image.id, keyColors)}
					/>
				</li>
			))}
		</ul>
	);
}
