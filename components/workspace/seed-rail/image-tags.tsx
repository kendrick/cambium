import type { ReferenceImage } from '../../../core/brand-record';
import { type ImageClassification, ImageClassificationSchema } from '../../../core/brand-seed';
import { selectClass } from './field-editors';

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
 *
 * One row per record image, not per entry. The model can return an empty or partial list, and a
 * person has to be able to classify what it skipped, or take back a reading, so every row keeps an
 * `unset` option that drops the image's entry. `BrandRecordSchema` refuses an entry naming an image
 * the record doesn't hold, so there's never an entry without a row.
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
	if (images.length === 0) {
		return <span className="text-muted-foreground text-xs">No images classified</span>;
	}

	const choose = (imageId: string, choice: string) => {
		if (choice === '') {
			onChange(value.filter((entry) => entry.imageId !== imageId));
			return;
		}

		const detected = choice as ImageClassification['detected'];
		onChange(
			value.some((entry) => entry.imageId === imageId)
				? value.map((entry) => (entry.imageId === imageId ? { ...entry, detected } : entry))
				: [...value, { imageId, detected }],
		);
	};

	return (
		<ul className="flex flex-col gap-1">
			{images.map((image, index) => {
				const name = `Image ${index + 1}`;
				const detected = value.find((entry) => entry.imageId === image.id)?.detected;

				return (
					<li key={image.id} className="flex items-center justify-between gap-2 text-xs">
						<span className="flex min-w-0 items-center gap-2">
							{/* A data URL held in the record, so next/image's optimiser has nothing to fetch. */}
							{/* oxlint-disable-next-line nextjs/no-img-element */}
							<img
								src={image.downscaled}
								alt=""
								className="size-6 shrink-0 rounded border object-cover"
							/>
							<span className="text-muted-foreground truncate">{name}</span>
						</span>
						<select
							aria-label={`${name} classification`}
							value={detected ?? ''}
							onChange={(event) => choose(image.id, event.target.value)}
							className={selectClass}
						>
							<option value="">unset</option>
							{DETECTED.map((option) => (
								<option key={option} value={option}>
									{option}
								</option>
							))}
						</select>
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
	activeClassifications,
	handEdited,
}: {
	images: readonly ReferenceImage[];
	classifications: readonly ImageClassification[] | null;
	/** The saved version's own reading, so a still-unsaved draft edit doesn't borrow its credit. */
	activeClassifications: readonly ImageClassification[] | null;
	/** True once the active version's provenance is a hand edit, so it has no model reading at all. */
	handEdited: boolean;
}) {
	const disagreements = tagDisagreements(images, classifications);

	if (disagreements.length === 0) return null;

	return (
		<ul data-tag-disagreements className="flex flex-col gap-1">
			{disagreements.map(({ image, position, detected }) => {
				// A hand edit to this field, saved or still in the draft, replaces the model's reading
				// with the person's own; a saved hand-edited version keeps no model reading behind it at
				// all. Attribute "the model" only when the draft's value still matches the saved version's
				// and that version wasn't itself a hand edit, or the note would credit a model with a
				// classification a person actually chose.
				const isModelReading =
					!handEdited &&
					activeClassifications?.find((entry) => entry.imageId === image.id)?.detected === detected;

				return (
					<li
						key={image.id}
						data-tag-disagreement={image.id}
						className="border-foreground/20 bg-muted flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs"
					>
						<span aria-hidden className="font-semibold">
							≠
						</span>
						<span>
							Image {position}: you tagged this <strong>{image.tag}</strong>;{' '}
							{isModelReading ? 'the model read it as' : 'the seed has it as'}{' '}
							<strong>{detected}</strong>.
						</span>
					</li>
				);
			})}
		</ul>
	);
}
