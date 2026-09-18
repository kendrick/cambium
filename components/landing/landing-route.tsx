'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { UploadForm } from '@/components/landing/upload-form';
import { buttonVariants } from '@/components/ui/button';

/**
 * A saved record is addressed by query parameter, never by a path segment. Static export cannot
 * prerender a page for a record that does not exist at build time, and `generateStaticParams` has
 * nothing to enumerate when the ids are made in the browser.
 */
const RECORD_PARAM = 'record';

type SavedRecord =
	| { kind: 'loading' }
	| { kind: 'found'; imageCount: number }
	| { kind: 'missing' };

export function LandingRoute() {
	const router = useRouter();
	const recordId = useSearchParams().get(RECORD_PARAM);
	const [loaded, setLoaded] = useState<{ id: string; result: SavedRecord } | null>(null);

	// The loaded answer carries the id it answers for, so "loading" is derived from a mismatch
	// rather than written back during the effect. A stale answer for a record the address bar has
	// already moved off then cannot be mistaken for the current one.
	const saved: SavedRecord = loaded?.id === recordId ? loaded.result : { kind: 'loading' };

	// Replace rather than push: the form's state is gone once the record is written, so a back
	// button that returned to an empty picker would look like the upload was lost.
	const onSaved = useCallback((id: string) => router.replace(`/?${RECORD_PARAM}=${id}`), [router]);

	useEffect(() => {
		if (!recordId) return;

		// Stops a resolved read from setting state on a route that has already moved on.
		let live = true;

		void (async () => {
			// Dynamic for the same reason the save path is: the store imports `BrandRecordSchema`, and
			// zod costs more than the first-load budget has to give. See ADR-0002.
			const { createIndexedDbRecordStore } =
				await import('../../app/storage/indexed-db-record-store');
			const store = await createIndexedDbRecordStore();
			const record = await store.get(recordId).catch(() => null);

			if (!live) return;

			setLoaded({
				id: recordId,
				result: record ? { kind: 'found', imageCount: record.images.length } : { kind: 'missing' },
			});
		})();

		return () => {
			live = false;
		};
	}, [recordId]);

	if (!recordId) {
		return <UploadForm onSaved={onSaved} />;
	}

	// Reading the record back rather than trusting the id in the address bar. A URL somebody pasted
	// from another browser resolves to nothing here, and showing an id for a record that is not
	// stored would make the addressing decorative.
	if (saved.kind === 'loading') {
		return <p className="text-muted-foreground text-sm">Looking for that record…</p>;
	}

	if (saved.kind === 'missing') {
		return (
			<div className="flex flex-col items-start gap-4">
				<p className="text-sm">
					Nothing is stored under that id. Records live in this browser alone, so a link from
					another machine will not find one.
				</p>
				<Link className={buttonVariants({ variant: 'outline' })} href="/">
					Start again
				</Link>
			</div>
		);
	}

	const count =
		saved.imageCount === 1 ? 'One reference image is' : `${saved.imageCount} reference images are`;

	return (
		<div className="flex flex-col items-start gap-4">
			<p className="text-sm">
				Saved. {count} stored in this browser under{' '}
				<code className="bg-muted rounded px-1 py-0.5 text-xs">{recordId}</code>.
			</p>
			{/* Says what was dropped at the moment the user could otherwise assume everything was kept.
			    #77 adds the fields; until it lands, silence here would be the bad surprise. */}
			<p className="text-muted-foreground text-sm">
				The images are stored. Their type tags and the brand site are not kept yet, so those went
				when the form closed.
			</p>
			<p className="text-muted-foreground text-sm">
				Nothing has been generated from them yet. That takes an API key and a model call, and the
				workspace that asks for one is still being built.
			</p>
			<Link className={buttonVariants({ variant: 'outline' })} href="/">
				Add another brand
			</Link>
		</div>
	);
}
