'use client';

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

import { formatBytes } from '@/lib/format-bytes';

import { tokenSetForVersion } from '../../app/state/workspace-store';
import {
	closeIndexedDbRecordStore,
	createIndexedDbRecordStore,
	listStoredRows,
	type StoredRow,
} from '../../app/storage/indexed-db-record-store';
import { createPerOperationRecordStore } from '../../app/storage/per-operation-record-store';
import { StaleRecordWriteError } from '../../app/storage/record-store';
import { estimateStorageUsage, type StorageUsage } from '../../app/storage/storage-estimate';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import type { BrandRecord } from '../../core/brand-record';
import type { ScaleEngine } from '../../core/scale-engine';

import { libraryOrder, recordLabel } from './library/library-order';
import { type LibraryItem, LibraryRow } from './library/library-row';
import { type PaletteSwatch, paletteSwatches } from './library/palette';
import type { RenameOutcome } from './library/rename-form';

// A connection per call, as the workspace does. One held while this page sits idle would block a
// later tab's upgrade and the e2e wipe.
const records = createPerOperationRecordStore(
	createIndexedDbRecordStore,
	closeIndexedDbRecordStore,
);

type Listing =
	| { kind: 'loading' }
	| { kind: 'listed'; items: LibraryItem[]; usage: StorageUsage | null }
	| { kind: 'unavailable' };

function toItem(row: StoredRow, engine: ScaleEngine): LibraryItem {
	if (row.kind === 'unreadable') return { kind: 'unreadable', id: row.id, label: null };

	const { record } = row;

	return {
		kind: 'readable',
		id: record.id,
		label: recordLabel(record),
		record,
		swatches: swatchesFor(record, engine),
	};
}

// Caught per record because a throw here would reject the whole listing, and one brand this build
// can't draw a palette for shouldn't hide the rest. That record still lists, without a palette.
function swatchesFor(record: BrandRecord, engine: ScaleEngine): PaletteSwatch[] | null {
	const latest = record.versions.at(-1);
	if (!latest) return null;

	try {
		const tokenSet = tokenSetForVersion(engine, latest);
		return tokenSet ? paletteSwatches(tokenSet) : null;
	} catch {
		return null;
	}
}

/**
 * Every brand saved in this browser.
 *
 * `firstRun` renders inside the empty state. #40 puts its keyless demo entry there.
 */
export function RecordLibrary({ firstRun }: { firstRun?: ReactNode }) {
	const headingId = useId();
	const [listing, setListing] = useState<Listing>({ kind: 'loading' });
	const live = useRef(true);
	const headingRef = useRef<HTMLHeadingElement>(null);

	const refresh = useCallback(async () => {
		let next: Listing;

		try {
			// The list is still worth showing when the usage read fails, so that failure resolves to null.
			const [rows, usage] = await Promise.all([
				listStoredRows(),
				estimateStorageUsage().catch(() => null),
			]);
			const engine = createOklchScaleEngine();
			next = { kind: 'listed', items: libraryOrder(rows.map((row) => toItem(row, engine))), usage };
		} catch {
			next = { kind: 'unavailable' };
		}

		if (live.current) setListing(next);
	}, []);

	// Built on the copy the list read, so `put` refuses it if another tab wrote since.
	const rename = useCallback(
		async (record: BrandRecord, typed: string): Promise<RenameOutcome> => {
			const name = typed.trim();
			const { name: _previous, ...unnamed } = record;

			try {
				await records.put(name ? { ...unnamed, name } : unnamed);
			} catch (error) {
				await refresh();
				return {
					ok: false,
					message:
						error instanceof StaleRecordWriteError
							? "This brand changed in another tab. The list now shows what's saved, so try again."
							: "The new name couldn't be saved. Try again.",
				};
			}

			await refresh();
			return { ok: true };
		},
		[refresh],
	);

	const remove = useCallback(
		async (id: string) => {
			try {
				await records.delete(id);
			} catch (error) {
				await refresh();
				throw error;
			}

			await refresh();
			// The deleted row held focus. Moving it to the heading keeps a keyboard user off <body>.
			headingRef.current?.focus();
		},
		[refresh],
	);

	useEffect(() => {
		live.current = true;
		void refresh();

		return () => {
			live.current = false;
		};
	}, [refresh]);

	if (listing.kind === 'loading') return null;

	return (
		<section
			aria-labelledby={headingId}
			className="flex w-full flex-col gap-3"
			data-library={listing.kind}
		>
			<h2 className="text-lg font-semibold" id={headingId} ref={headingRef} tabIndex={-1}>
				Your brands
			</h2>
			{listing.kind === 'unavailable' ? (
				<p className="text-sm">
					Cambium couldn&apos;t read the brands saved in this browser. Blocked site data and private
					browsing are the usual causes.
				</p>
			) : listing.items.length === 0 ? (
				<div className="flex flex-col gap-3" data-library-first-run>
					<p className="text-sm">
						No brands are saved in this browser yet. Save reference images below to start your first
						one. It will be listed here, ready to reopen.
					</p>
					{firstRun}
				</div>
			) : (
				<ul className="flex flex-col gap-2">
					{listing.items.map((item) => (
						<LibraryRow item={item} key={item.id} onDelete={remove} onRename={rename} />
					))}
				</ul>
			)}
			{listing.kind === 'listed' && <UsageLine usage={listing.usage} />}
		</section>
	);
}

/** The origin's figure, since IndexedDB shares one budget with everything else the site stores. */
function UsageLine({ usage }: { usage: StorageUsage | null }) {
	if (!usage) {
		return (
			<p className="text-muted-foreground text-xs" data-storage-usage="unknown">
				This browser doesn&apos;t report how much storage Cambium is using.
			</p>
		);
	}

	return (
		<p className="text-muted-foreground text-xs" data-storage-usage={usage.usedBytes}>
			Cambium is using {formatBytes(usage.usedBytes)} of the {formatBytes(usage.quotaBytes)} this
			browser allows it.
		</p>
	);
}
