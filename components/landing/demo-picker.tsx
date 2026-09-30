'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { RECORD_PARAM } from '@/components/stored-record';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { assetPath } from '@/lib/asset-path';

import { DEMO_FIXTURES, demoRecordName } from '../../app/demo/demo-fixtures';

/**
 * The keyless path (#40), rendered in the record library's first-run slot. Each button fetches one
 * committed record from `public/`, inserts it as a fresh record, and opens it in the workspace,
 * which has no idea it's a demo. The record, zod and IndexedDB all load on click, never with the
 * route (ADR-0002's first-load budget).
 */
export function DemoPicker() {
	const router = useRouter();
	const [opening, setOpening] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	async function open(slug: string, label: string) {
		setOpening(slug);
		setFailed(false);

		try {
			const response = await fetch(assetPath(`/demo/fixtures/${slug}.json`));

			if (!response.ok) throw new Error(`demo fixture ${slug} answered ${response.status}`);

			const raw: unknown = await response.json();
			const [{ openDemoRecord }, { createIndexedDbRecordStore, closeIndexedDbRecordStore }] =
				await Promise.all([
					import('../../app/demo/open-demo-record'),
					import('../../app/storage/indexed-db-record-store'),
				]);
			const store = await createIndexedDbRecordStore();
			let id: string;

			try {
				id = await openDemoRecord(store, raw, demoRecordName(label));
			} finally {
				// Closed on every path, as the upload form does, because an open connection blocks another connection's upgrade.
				closeIndexedDbRecordStore(store);
			}

			router.push(`/workspace?${RECORD_PARAM}=${id}`);
		} catch {
			setFailed(true);
			setOpening(null);
		}
	}

	return (
		<div data-demo-picker className="flex flex-col gap-3">
			{/* Follows the library's own first-run sentence, so it reads as the other way in. */}
			<p className="text-sm">
				Or, with no API key, open a demo brand. Everything works on a demo except generating from
				new images.
			</p>
			<ul className="flex flex-wrap gap-2">
				{DEMO_FIXTURES.map(({ slug, label }) => (
					<li key={slug}>
						<Button
							variant="outline"
							disabled={opening !== null}
							onClick={() => void open(slug, label)}
						>
							Open the {label} demo
						</Button>
					</li>
				))}
			</ul>
			{failed ? (
				<Alert variant="destructive">
					<AlertTitle>The demo didn’t open</AlertTitle>
					<AlertDescription>
						Loading or saving the demo record failed. Try again, or pick another one.
					</AlertDescription>
				</Alert>
			) : null}
		</div>
	);
}
