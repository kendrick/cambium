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
 * Four outcomes rather than two, because each one licenses a different sentence and the wrong
 * sentence here is expensive.
 *
 * `missing` is a resolved null and nothing else. `unreadable` is storage answering and refusing
 * this record: `app/storage/indexed-db-record-store.ts` parses on the way out and throws when a
 * stored record's `schemaVersion` has moved, deliberately, because the export archive is the only
 * migration path and it works only if a mismatch is loud. #9 moves that number. Reporting that
 * throw as "nothing is stored" would take the one incompatibility alarm this system has and answer
 * it with "there was never anything here", on the screen most likely to meet it first. It is the
 * same lie this route already stopped telling about dropped tags, about a larger thing: a record
 * that cannot be read is still on disk, and telling somebody their work is gone is how the work
 * then actually gets deleted.
 *
 * `unavailable` is separate from `unreadable` for the opposite reason. When the database will not
 * open at all, nothing was read, so nothing is known: there may be no record and no stored data.
 * Folding it into `unreadable` would assert a record exists on the evidence of an id in the address
 * bar, which is the overclaim the split above exists to prevent.
 */
type SavedRecord =
	| { kind: 'loading' }
	| { kind: 'found'; imageCount: number }
	| { kind: 'missing' }
	| { kind: 'unreadable' }
	| { kind: 'unavailable' };

/**
 * The shape every terminal outcome renders: something to read, and the one way back.
 *
 * Extracted at the fifth branch rather than the fourth, which is where the repetition stopped being
 * cheaper than the indirection.
 */
function Outcome({ action, children }: { action: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col items-start gap-4">
			{children}
			<Link className={buttonVariants({ variant: 'outline' })} href="/">
				{action}
			</Link>
		</div>
	);
}

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

			// Nested because the two failures license different sentences. The outer one is "could this
			// browser be asked at all", where nothing was read and nothing may exist. The inner one is
			// "did this record load", where storage answered and refused a row it holds.
			//
			// Both used to sit outside any handler. A browser that refuses IndexedDB left the effect
			// rejecting and the screen on "Looking for that record…" indefinitely. That closes the
			// rejecting case only: `openDB` in `createIndexedDbRecordStore` passes no `blocked` handler,
			// so a connection held open by an older tab still neither resolves nor rejects. Closing that
			// one means a change in `app/storage/`, which this branch does not own.
			try {
				// Dynamic for the same reason the save path is: the store imports `BrandRecordSchema`, and
				// zod costs more than the first-load budget has to give. See ADR-0002.
				const { createIndexedDbRecordStore } =
					await import('../../app/storage/indexed-db-record-store');
				const store = await createIndexedDbRecordStore();

				try {
					const record = await store.get(recordId);

					// A resolved null is the one answer storage gives that is actually about absence.
					result = record
						? { kind: 'found', imageCount: record.images.length }
						: { kind: 'missing' };
				} catch {
					result = { kind: 'unreadable' };
				}
			} catch {
				result = { kind: 'unavailable' };
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
			<Outcome action="Start a new brand">
				<p className="text-sm">
					Nothing is stored under that id. Records live in this browser alone, so a link from
					another machine will not find one.
				</p>
			</Outcome>
		);
	}

	if (saved.kind === 'unreadable') {
		return (
			<Outcome action="Start a new brand">
				<p className="text-sm">
					A record is stored under that id, but this version of Cambium could not read it. The usual
					cause is that a different version saved it.
				</p>
				{/* The one instruction that matters, because this failure looks like absence and the
				    reflex it invites is what would make the loss real. */}
				<p className="text-muted-foreground text-sm">
					It is still in this browser. Clearing your browsing data is what would lose it.
				</p>
			</Outcome>
		);
	}

	if (saved.kind === 'unavailable') {
		return (
			<Outcome action="Start a new brand">
				{/* Says nothing about whether the record exists, because nothing was read. Private
				    browsing and blocked site data are the two causes worth naming. */}
				<p className="text-sm">
					This browser would not open its storage, so nothing could be looked up. Private browsing
					and blocked site data are the usual causes.
				</p>
			</Outcome>
		);
	}

	const count =
		saved.imageCount === 1 ? 'One reference image is' : `${saved.imageCount} reference images are`;

	return (
		<Outcome action="Add another brand">
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
		</Outcome>
	);
}
