import Link from 'next/link';
import { useState } from 'react';

import { ReferenceThumbnail } from '@/components/reference-thumbnail';
import { RECORD_PARAM } from '@/components/stored-record';
import { Button, buttonVariants } from '@/components/ui/button';

import type { BrandRecord } from '../../../core/brand-record';

import { DeleteDialog } from './delete-dialog';
import type { PaletteSwatch } from './palette';
import { PaletteStrip } from './palette-strip';
import { RenameForm, type RenameOutcome } from './rename-form';

export type LibraryItem =
	| {
			kind: 'readable';
			id: string;
			label: string;
			record: BrandRecord;
			swatches: PaletteSwatch[] | null;
	  }
	| { kind: 'unreadable'; id: string; label: null };

export type LibraryRowProps = {
	item: LibraryItem;
	/** Takes the listed record, so the write is built on the copy the person saw. */
	onRename: (record: BrandRecord, typed: string) => Promise<RenameOutcome>;
	/** Rejects when the delete failed and the row is still stored. */
	onDelete: (id: string) => Promise<void>;
};

export function LibraryRow({ item, onRename, onDelete }: LibraryRowProps) {
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [deleteFailed, setDeleteFailed] = useState(false);

	const confirmDelete = () => {
		setConfirming(false);
		setDeleteFailed(false);
		onDelete(item.id).catch(() => setDeleteFailed(true));
	};

	const deleteControls = (
		<>
			<Button onClick={() => setConfirming(true)} size="sm" type="button" variant="destructive">
				Delete<span className="sr-only"> {item.label ?? 'unreadable brand'}</span>
			</Button>
			<DeleteDialog
				label={item.label}
				onConfirm={confirmDelete}
				onOpenChange={setConfirming}
				open={confirming}
			/>
		</>
	);

	const deleteError = deleteFailed && (
		<p className="text-destructive w-full text-xs" role="alert">
			That brand couldn&apos;t be deleted. Try again.
		</p>
	);

	if (item.kind === 'unreadable') {
		return (
			<li
				className="flex flex-wrap items-center gap-3 rounded-md border p-3"
				data-library-row={item.id}
			>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="text-sm">A brand this version of Cambium can&apos;t read</p>
					<p className="text-muted-foreground text-xs">
						It is still stored in this browser. The usual cause is that a different version saved
						it.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">{deleteControls}</div>
				{deleteError}
			</li>
		);
	}

	const { record, label, swatches } = item;
	const first = record.images[0];

	return (
		<li
			className="flex flex-wrap items-center gap-3 rounded-md border p-3"
			data-library-row={item.id}
		>
			{first ? (
				<ReferenceThumbnail alt={`First reference image for ${label}`} src={first.downscaled} />
			) : (
				<div aria-hidden className="bg-muted h-16 w-24 shrink-0 rounded-sm" />
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				{editing ? (
					<RenameForm
						current={record.name ?? ''}
						label={label}
						onDone={() => setEditing(false)}
						onRename={(typed) => onRename(record, typed)}
					/>
				) : (
					<p className="truncate text-sm font-medium" data-library-name>
						{label}
					</p>
				)}
				<PaletteStrip swatches={swatches} />
			</div>
			<div className="flex flex-wrap gap-2">
				<Link
					className={buttonVariants({ variant: 'outline', size: 'sm' })}
					href={`/workspace?${RECORD_PARAM}=${record.id}`}
				>
					Open<span className="sr-only"> {label}</span>
				</Link>
				<Button onClick={() => setEditing(true)} size="sm" type="button" variant="outline">
					Rename<span className="sr-only"> {label}</span>
				</Button>
				{deleteControls}
			</div>
			{deleteError}
		</li>
	);
}
