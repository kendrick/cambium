import Link from 'next/link';

import { ReferenceThumbnail } from '@/components/reference-thumbnail';
import { RECORD_PARAM } from '@/components/stored-record';
import { buttonVariants } from '@/components/ui/button';

import type { BrandRecord } from '../../../core/brand-record';

import type { PaletteSwatch } from './palette';
import { PaletteStrip } from './palette-strip';

export type LibraryItem =
	| {
			kind: 'readable';
			id: string;
			label: string;
			record: BrandRecord;
			swatches: PaletteSwatch[] | null;
	  }
	| { kind: 'unreadable'; id: string; label: null };

export function LibraryRow({ item }: { item: LibraryItem }) {
	if (item.kind === 'unreadable') {
		return (
			<li className="flex flex-col gap-1 rounded-md border p-3" data-library-row={item.id}>
				<p className="text-sm">A brand this version of Cambium can&apos;t read</p>
				<p className="text-muted-foreground text-xs">
					It is still stored in this browser. The usual cause is that a different version saved it.
				</p>
			</li>
		);
	}

	const { record, label, swatches } = item;
	const first = record.images[0];

	return (
		<li className="flex items-center gap-3 rounded-md border p-3" data-library-row={item.id}>
			{first ? (
				<ReferenceThumbnail alt={`First reference image for ${label}`} src={first.downscaled} />
			) : (
				<div aria-hidden className="bg-muted h-16 w-24 shrink-0 rounded-sm" />
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<p className="truncate text-sm font-medium" data-library-name>
					{label}
				</p>
				<PaletteStrip swatches={swatches} />
			</div>
			<Link
				className={buttonVariants({ variant: 'outline', size: 'sm' })}
				href={`/workspace?${RECORD_PARAM}=${record.id}`}
			>
				Open<span className="sr-only"> {label}</span>
			</Link>
		</li>
	);
}
