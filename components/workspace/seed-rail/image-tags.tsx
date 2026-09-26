import type { ReferenceImage } from '../../../core/brand-record';
import { type ImageClassification, ImageClassificationSchema } from '../../../core/brand-seed';
import { EnumSelect, selectClass } from './field-editors';

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
 * person has to be able to classify what it skipped, so an unclassified image gets an unset option
 * and joins the list once chosen. Entries naming an image the record no longer holds keep their
 * rows so the list saves back unchanged.
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
	const known = new Set(images.map((image) => image.id));
	const rows = [
		...images.map((image, index) => ({ imageId: image.id, image, name: `Image ${index + 1}` })),
		...value
			.filter((entry) => !known.has(entry.imageId))
			.map((entry) => ({ imageId: entry.imageId, image: undefined, name: 'Unknown image' })),
	];

	if (rows.length === 0) {
		return <span className="text-muted-foreground text-xs">No images classified</span>;
	}

	return (
		<ul className="flex flex-col gap-1">
			{rows.map(({ imageId, image, name }) => {
				const detected = value.find((entry) => entry.imageId === imageId)?.detected;

				return (
					<li key={imageId} className="flex items-center justify-between gap-2 text-xs">
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
						{detected === undefined ? (
							<select
								aria-label={`${name} classification`}
								value=""
								onChange={(event) =>
									onChange([
										...value,
										{ imageId, detected: event.target.value as ImageClassification['detected'] },
									])
								}
								className={selectClass}
							>
								<option value="" disabled>
									unset
								</option>
								{DETECTED.map((option) => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						) : (
							<EnumSelect
								label={`${name} classification`}
								value={detected}
								options={DETECTED}
								onChange={(next) =>
									onChange(
										value.map((other) =>
											other.imageId === imageId ? { ...other, detected: next } : other,
										),
									)
								}
							/>
						)}
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
