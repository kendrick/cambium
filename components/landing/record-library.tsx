'use client';

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

import { formatBytes } from '@/lib/format-bytes';

import { tokenSetForVersion } from '../../app/state/workspace-store';
import { listStoredRows, type StoredRow } from '../../app/storage/indexed-db-record-store';
import { estimateStorageUsage, type StorageUsage } from '../../app/storage/storage-estimate';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import type { ScaleEngine } from '../../core/scale-engine';

import { libraryOrder, recordLabel } from './library/library-order';
import { type LibraryItem, LibraryRow } from './library/library-row';
import { paletteSwatches } from './library/palette';

type Listing =
	| { kind: 'loading' }
	| { kind: 'listed'; items: LibraryItem[]; usage: StorageUsage | null }
	| { kind: 'unavailable' };

function toItem(row: StoredRow, engine: ScaleEngine): LibraryItem {
	if (row.kind === 'unreadable') return { kind: 'unreadable', id: row.id, label: null };

	const { record } = row;
	const latest = record.versions.at(-1);
	const tokenSet = latest ? tokenSetForVersion(engine, latest) : null;

	return {
		kind: 'readable',
		id: record.id,
		label: recordLabel(record),
		record,
		swatches: tokenSet ? paletteSwatches(tokenSet) : null,
	};
}

/**
 * Every brand saved in this browser. `landing-route.tsx` loads it lazily, because it reaches `idb`,
 * zod and the scale engine, and `/` has no first-load room for any of them.
 *
 * `firstRun` renders inside the empty state. #40 puts its keyless demo entry there.
 */
export function RecordLibrary({ firstRun }: { firstRun?: ReactNode }) {
	const headingId = useId();
	const [listing, setListing] = useState<Listing>({ kind: 'loading' });
	const live = useRef(true);

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
			<h2 className="text-lg font-semibold" id={headingId} tabIndex={-1}>
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
						<LibraryRow item={item} key={item.id} />
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
