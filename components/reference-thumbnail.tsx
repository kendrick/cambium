import type { ComponentProps } from 'react';

import type { Rect } from '../core/brand-seed';
import { cn } from '@/lib/utils';

export type RegionOutline = {
	/** Unique within one frame. Lands on `data-region-outline`, so one box can be found by name. */
	id: string;
	region: Rect;
};

export type RegionFrameProps = Omit<ComponentProps<'div'>, 'children'> & {
	src: string;
	alt: string;
	outlines?: readonly RegionOutline[];
	imageClassName?: string;
};

const percent = (fraction: number) => `${fraction * 100}%`;

/**
 * A region is stored as fractions of the image, so percentages of a box that shrink-wraps the
 * `<img>` land on the same pixels at any display size. The wrapper has to hug the image exactly:
 * `object-contain`, a wider wrapper, or a flex or grid parent that stretches it would letterbox
 * the picture, and the percentages would then measure the letterbox. A parent laying several of
 * these out in a row needs `items-start` or `items-center` for that reason.
 */
export function RegionFrame({
	src,
	alt,
	outlines = [],
	imageClassName,
	className,
	...rest
}: RegionFrameProps) {
	return (
		<div {...rest} className={cn('relative w-fit', className)}>
			{/* A data URL held in the record or the picker, so next/image's optimiser has nothing to fetch. */}
			{/* oxlint-disable-next-line nextjs/no-img-element */}
			<img src={src} alt={alt} className={cn('block h-auto w-auto', imageClassName)} />
			{outlines.map(({ id, region }) => (
				<div
					key={id}
					data-region-outline={id}
					aria-hidden
					className="pointer-events-none absolute rounded-sm border-2 border-white shadow-[0_0_0_1px_black,inset_0_0_0_1px_black]"
					style={{
						left: percent(region.x),
						top: percent(region.y),
						width: percent(region.width),
						height: percent(region.height),
					}}
				/>
			))}
		</div>
	);
}

/**
 * Sized for a strip or a list row. Takes a `src` rather than a `ReferenceImage` so a picked
 * image and a stored one work alike; both carry a `downscaled` data URL. It never creates an
 * object URL, so it never revokes one: a caller that passes one owns its lifetime.
 */
export function ReferenceThumbnail({ imageClassName, ...props }: RegionFrameProps) {
	return (
		<RegionFrame {...props} imageClassName={cn('max-h-16 max-w-24 rounded-sm', imageClassName)} />
	);
}
