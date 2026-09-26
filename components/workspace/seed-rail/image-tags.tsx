import type { ReferenceImage } from '../../../core/brand-record';
import { type ImageClassification, ImageClassificationSchema } from '../../../core/brand-seed';
import { EnumSelect } from './field-editors';

const DETECTED = ImageClassificationSchema.shape.detected.options;

/**
 * Where a person's tag and the model's reading of the same image differ. `auto` is a person
 * declining to say, so it never disagrees with anything, and an image the model didn't classify has
 * nothing to disagree with.
 */
export function tagDisagreements(
	images: readonly ReferenceImage[],
	classifications: readonly ImageClassification[] | null,
): { image: ReferenceImage; position: number; detected: ImageClassification['detected'] }[] {
	return images.flatMap((image, index) => {
		const detected = classifications?.find((entry) => entry.imageId === image.id)?.detected;

		return image.tag !== 'auto' && detected !== undefined && detected !== image.tag
			? [{ image, position: index + 1, detected }]
			: [];
	});
}

/**
 * Images are named by position, since an id is a uuid nobody reads and the thumbnail beside it is
 * what a person actually recognises.
 */
export function ImageClassificationsEditor({
	images,
	value,
	onChange,
}: {
	images: readonly ReferenceImage[];
	value: ImageClassification[];
	onChange: (next: ImageClassification[]) => void;
}) {
	if (value.length === 0) {
		return <span className="text-muted-foreground text-xs">No images classified</span>;
	}

	return (
		<ul className="flex flex-col gap-1">
			{value.map((entry) => {
				const index = images.findIndex((image) => image.id === entry.imageId);
				const image = images[index];
				const name = index === -1 ? 'Unknown image' : `Image ${index + 1}`;

				return (
					<li key={entry.imageId} className="flex items-center justify-between gap-2 text-xs">
						<span className="flex min-w-0 items-center gap-2">
							{image ? (
								// A data URL held in the record, so next/image's optimiser has nothing to fetch.
								// oxlint-disable-next-line nextjs/no-img-element
								<img
									src={image.downscaled}
									alt=""
									className="size-6 shrink-0 rounded border object-cover"
								/>
							) : null}
							<span className="text-muted-foreground truncate">{name}</span>
						</span>
						<EnumSelect
							label={`${name} classification`}
							value={entry.detected}
							options={DETECTED}
							onChange={(detected) =>
								onChange(
									value.map((other) =>
										other.imageId === entry.imageId ? { ...other, detected } : other,
									),
								)
							}
						/>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * Both readings side by side, and neither one wins. Which is right is the person's call: they may
 * have mis-tagged, or the model may have misread, and the fix differs.
 */
export function TagDisagreements({
	images,
	classifications,
}: {
	images: readonly ReferenceImage[];
	classifications: readonly ImageClassification[] | null;
}) {
	const disagreements = tagDisagreements(images, classifications);

	if (disagreements.length === 0) return null;

	return (
		<ul data-tag-disagreements className="flex flex-col gap-1">
			{disagreements.map(({ image, position, detected }) => (
				<li
					key={image.id}
					data-tag-disagreement={image.id}
					className="border-foreground/20 bg-muted flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs"
				>
					<span aria-hidden className="font-semibold">
						≠
					</span>
					<span>
						Image {position}: you tagged this <strong>{image.tag}</strong>; the model read it as{' '}
						<strong>{detected}</strong>.
					</span>
				</li>
			))}
		</ul>
	);
}
