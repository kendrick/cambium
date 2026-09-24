'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import { KeyIndicator } from '@/components/landing/generate/key-indicator';
import { UploadForm } from '@/components/landing/upload-form';
import { isSchemaRejection, Outcome, RECORD_PARAM } from '@/components/stored-record';

import type { BrandRecord } from '../../core/brand-record';
import { getSessionKey } from '../../app/generation/session-key';

// Lazy because `/` sits within a few kB of `FIRST_LOAD_BUDGET_BYTES`, and the panel is wanted only
// after a record has been read back.
const GeneratePanel = lazy(() =>
	import('@/components/landing/generate/generate-panel').then((module) => ({
		default: module.GeneratePanel,
	})),
);

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
 * `unavailable` is separate from `unreadable` for the opposite reason. Where nothing was read,
 * nothing is known: there may be no record and no stored data. Folding that into `unreadable` would
 * assert a record exists on the evidence of an id in the address bar, which is the overclaim the
 * split above exists to prevent.
 */
type SavedRecord =
	| { kind: 'loading' }
	| { kind: 'found'; record: BrandRecord }
	| { kind: 'missing' }
	| { kind: 'unreadable' }
	| { kind: 'unavailable' };

/**
 * The key indicator sits above every outcome, the upload form included, because a key loaded in
 * this tab is true of the whole page and the person should be able to clear it from anywhere.
 */
export function LandingRoute() {
	// Read in the initializer, which is safe only because `useSearchParams` below keeps this whole
	// subtree out of the prerender, so there's no server HTML for it to disagree with. Only whether a
	// key exists is kept, never the key.
	const [keyStored, setKeyStored] = useState(() => getSessionKey() !== null);

	return (
		<>
			{keyStored && <KeyIndicator onCleared={() => setKeyStored(false)} />}
			<LandingOutcome onKeyStored={setKeyStored} />
		</>
	);
}

function LandingOutcome({ onKeyStored }: { onKeyStored: (stored: boolean) => void }) {
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

			// Nested because the failures license different sentences. The outer one is "could storage be
			// reached at all", which covers both the chunk import and opening the database, and where
			// nothing was read so nothing may exist. The inner one is "did this record load", where
			// storage answered and a schema rejection proves it handed a row over.
			//
			// Both used to sit outside any handler. A browser that refuses IndexedDB left the effect
			// rejecting and the screen on "Looking for that record…" indefinitely. That closes the
			// rejecting case only: `openDB` in `createIndexedDbRecordStore` passes no `blocked` handler,
			// so a connection held open by an older tab still neither resolves nor rejects. Closing that
			// one means a change in `app/storage/`, which this branch does not own.
			try {
				// Dynamic for the same reason the save path is: the store imports `BrandRecordSchema`, and
				// zod costs more than the first-load budget has to give. See ADR-0002.
				const { createIndexedDbRecordStore, closeIndexedDbRecordStore } =
					await import('../../app/storage/indexed-db-record-store');
				const store = await createIndexedDbRecordStore();

				try {
					const record = await store.get(recordId);

					// A resolved null is the one answer storage gives that is actually about absence.
					result = record ? { kind: 'found', record } : { kind: 'missing' };
				} catch (error) {
					// A rejection here is not proof a record exists. `get` reads the row and parses it in
					// one promise, so an aborted transaction rejects exactly like a row that will not
					// parse, and only the second one means anything came back. Sending both to
					// `unreadable` would put "it is still in this browser" in front of somebody on no
					// evidence, which is the original bug inverted rather than fixed.
					result = isSchemaRejection(error) ? { kind: 'unreadable' } : { kind: 'unavailable' };
				} finally {
					// A read holds a connection open for as long as the tab lives otherwise, which is what
					// turns the missing `blocked` handler from a rare hang into a likely one.
					closeIndexedDbRecordStore(store);
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
				{/* Three failures land here and the copy has to fit all of them: a chunk that would not
				    load, a database that would not open, and a read that failed partway on a database
				    that opened fine. Only the middle one is "storage is unreachable", so the sentence
				    claims the one thing true of all three, which is that the lookup did not finish. */}
				<p className="text-sm">
					Cambium could not look that record up, so this page cannot say whether it exists. Blocked
					site data, private browsing, and a dropped connection are the usual causes.
				</p>
				<p className="text-muted-foreground text-sm">Reloading is worth a try.</p>
			</Outcome>
		);
	}

	const { images, versions } = saved.record;
	const count =
		images.length === 1 ? 'One reference image is' : `${images.length} reference images are`;
	const workspaceLink = (
		<Link
			className="text-primary underline-offset-4 hover:underline"
			href={`/workspace?${RECORD_PARAM}=${recordId}`}
		>
			workspace
		</Link>
	);

	return (
		<Outcome action="Add another brand">
			<p className="text-sm">
				Saved. {count} stored in this browser under{' '}
				<code className="bg-muted rounded px-1 py-0.5 text-xs">{recordId}</code>.
			</p>
			{/* States what this build can keep rather than what this visit lost. Asserting a loss was
			    wrong whenever every tag was left on Automatic and the brand site was blank, which is the
			    common case: it claimed something had gone when nothing had. The route cannot tell those
			    apart on a reload either, because the form's state is gone by then. #77 adds the fields;
			    until it lands, saying nothing at all would still be the worse surprise. */}
			<p className="text-muted-foreground text-sm">
				The images are stored. Image tags and the brand site are not stored yet, so they do not
				outlive this page.
			</p>
			{versions.length === 0 ? (
				<>
					<p className="text-muted-foreground text-sm">
						Nothing has been generated from them yet. Generating sends the images to Anthropic with
						your own API key and saves what comes back as this brand&apos;s first version. You can
						already open the record in the {workspaceLink}.
					</p>
					<Suspense fallback={null}>
						<GeneratePanel images={images} onKeyStored={onKeyStored} recordId={recordId} />
					</Suspense>
				</>
			) : (
				// Generate here produces only the first version. Once one exists, a button here would append
				// to a record the person can't see from this page.
				<p className="text-muted-foreground text-sm">
					{versions.length === 1 ? 'One version has' : `${versions.length} versions have`} been
					generated from them. Open the record in the {workspaceLink}.
				</p>
			)}
		</Outcome>
	);
}
