import type { ReferenceImage } from '../../../core/brand-record';
import type { Rect } from '../../../core/brand-seed';
import { RegionFrame } from '@/components/reference-thumbnail';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';

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
						<RegionFrame
							data-source-image
							src={image.downscaled}
							alt={`The reference this colour was read from, tagged ${image.tag}`}
							imageClassName="max-h-[60vh] max-w-full"
							outlines={region ? [{ id: 'source', region }] : []}
						/>
					</div>
				) : null}
				<div className="flex justify-end">
					<DialogClose render={<Button variant="outline" size="sm" />}>Close</DialogClose>
				</div>
			</DialogPopup>
		</Dialog>
	);
}
