import type { ReferenceImage } from '../../../core/brand-record';
import type { Rect } from '../../../core/brand-seed';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';

const percent = (fraction: number) => `${fraction * 100}%`;

/**
 * The region is stored as fractions of the image, so percentages of a box that shrink-wraps the
 * `<img>` land on the same pixels at any display size. The wrapper has to hug the image exactly:
 * `object-contain` or a wider wrapper would letterbox it, and the percentages would then measure the
 * letterbox instead of the picture.
 */
export function SourceRegion({
	label,
	image,
	region,
}: {
	/** Sentence fragment naming the colour, e.g. "brand key colour". */
	label: string;
	image: ReferenceImage | undefined;
	region: Rect | null;
}) {
	return (
		<Dialog>
			<DialogTrigger
				render={
					<Button
						variant="link"
						size="xs"
						className="text-muted-foreground hover:text-foreground h-auto self-start px-0 font-normal underline"
					/>
				}
				aria-label={`Show source of ${label}`}
			>
				Show source
			</DialogTrigger>
			<DialogPopup className="max-w-2xl">
				<DialogTitle>Where the {label} came from</DialogTitle>
				<DialogDescription>
					{image === undefined
						? 'The image this colour was read from is not in this record.'
						: region === null
							? 'The model named this image but recorded no region, so the whole image is shown.'
							: 'The outlined region is where the model read this colour.'}
				</DialogDescription>
				{image ? (
					<div className="bg-muted flex justify-center rounded-md p-2">
						<div data-source-image className="relative w-fit">
							{/* A data URL held in the record, so next/image's optimiser has nothing to fetch. */}
							{/* oxlint-disable-next-line nextjs/no-img-element */}
							<img
								src={image.downscaled}
								alt={`The reference this colour was read from, tagged ${image.tag}`}
								className="block h-auto max-h-[60vh] w-auto max-w-full"
							/>
							{region ? (
								<div
									data-source-region
									aria-hidden
									className="pointer-events-none absolute rounded-sm border-2 border-white shadow-[0_0_0_1px_black,inset_0_0_0_1px_black]"
									style={{
										left: percent(region.x),
										top: percent(region.y),
										width: percent(region.width),
										height: percent(region.height),
									}}
								/>
							) : null}
						</div>
					</div>
				) : null}
				<div className="flex justify-end">
					<DialogClose render={<Button variant="outline" size="sm" />}>Close</DialogClose>
				</div>
			</DialogPopup>
		</Dialog>
	);
}
