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

/**
 * `missing` and `unreadable` are separate states because the recovery differs and because
 * collapsing them destroys a signal the system depends on.
 *
 * `app/storage/indexed-db-record-store.ts` parses on the way out and throws when a stored record's
 * `schemaVersion` has moved, deliberately: the export archive is the only migration path, and it
 * works only if a mismatch is loud. #9 bumps that number in this same wave. Reporting that throw as
 * "nothing is stored" would take the one incompatibility alarm this system has and answer it with
 * "there was never anything here", on the screen most likely to meet it first.
 *
 * It is also a lie about a larger thing than the dropped tags this route already stopped lying
 * about. A record that cannot be read is still on disk, and telling somebody their work is gone is
 * how the work then actually gets deleted.
 */
type SavedRecord =
	| { kind: 'loading' }
	| { kind: 'found'; imageCount: number }
	| { kind: 'missing' }
	| { kind: 'unreadable' };

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
			let result: SavedRecord;

			try {
				// Dynamic for the same reason the save path is: the store imports `BrandRecordSchema`, and
				// zod costs more than the first-load budget has to give. See ADR-0002.
				const { createIndexedDbRecordStore } =
					await import('../../app/storage/indexed-db-record-store');
				const store = await createIndexedDbRecordStore();
				const record = await store.get(recordId);

				// Only a resolved null means the record is not there. That is the one answer storage gives
				// that is actually about absence, and every other outcome below is about failure.
				result = record ? { kind: 'found', imageCount: record.images.length } : { kind: 'missing' };
			} catch {
				// A schema mismatch, a corrupt row, an origin that will not open its database at all: the
				// route cannot tell these apart and does not need to, because the advice is the same for
				// all of them and is the opposite of the advice for a record that is not there.
				//
				// The try also covers opening the store, which used to sit outside any handler. A browser
				// refusing IndexedDB left the whole effect rejecting and the screen on "Looking for that
				// record…" forever.
				result = { kind: 'unreadable' };
			}

			if (live) setLoaded({ id: recordId, result });
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

	if (saved.kind === 'unreadable') {
		return (
			<div className="flex flex-col items-start gap-4">
				<p className="text-sm">
					A record is stored under that id, but this version of Cambium could not read it. A record
					whose format has moved is refused rather than guessed at, so the usual cause is that a
					different version of Cambium saved it.
				</p>
				{/* The one instruction that matters, because the failure looks like absence and the
				    reflex it invites is the thing that would make the loss real. */}
				<p className="text-muted-foreground text-sm">
					It is still in this browser. Clearing your browsing data is what would lose it.
				</p>
				<Link className={buttonVariants({ variant: 'outline' })} href="/">
					Start a new brand
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
