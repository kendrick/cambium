'use client';

import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';
import {
	buildExportArchive,
	type ExportArchiveInput,
	exportArchiveEntries,
} from '../../core/export/archive';
import { filenamePrefix } from '../../core/export/artifacts';
import { type ExportFile, exportFiles } from '../../core/export/export-files';
import { downloadBytes, downloadFile } from '@/lib/download';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type Listing = { ok: true; files: ExportFile[] } | { ok: false; message: string };

function messageOf(thrown: unknown): string {
	return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * The listing and the archive both come from one `exportArchiveEntries` input, so the files shown here and the files in the zip can't disagree about what exists.
 */
export function ExportPanel({ store }: { store: StoreApi<WorkspaceState> }) {
	const tokenSet = useStore(store, (state) => state.tokenSet);
	const seed = useStore(store, (state) => state.draftSeed);
	const repairs = useStore(store, (state) => state.contrast?.repairs ?? null);
	const brandUrl = useStore(store, (state) => state.record?.brandUrl ?? null);
	const [error, setError] = useState<string | null>(null);

	const input = useMemo<ExportArchiveInput | null>(
		() => (tokenSet && seed && repairs ? { tokens: tokenSet, seed, repairs } : null),
		[tokenSet, seed, repairs],
	);
	const deferredInput = useDeferredValue(input);

	// Runs every adapter whenever this tab is mounted. `TabsPanel` unmounts an inactive tab, so a hidden pane costs nothing. The deferred input lets a seed edit made beside a visible Export tab repaint the rail before the nine adapters rerun.
	const listing = useMemo<Listing | null>(() => {
		if (!deferredInput) return null;

		try {
			return { ok: true, files: exportFiles(exportArchiveEntries(deferredInput), brandUrl) };
		} catch (thrown) {
			return { ok: false, message: messageOf(thrown) };
		}
	}, [deferredInput, brandUrl]);

	const archiveFilename = `${filenamePrefix(brandUrl)}export.zip`;

	// Reads the undeferred input, so the archive never lags an edit the listing hasn't caught up with yet.
	const handleArchive = useCallback(() => {
		if (!input) return;

		try {
			setError(null);
			downloadBytes(archiveFilename, 'application/zip', buildExportArchive(input));
		} catch (thrown) {
			setError(messageOf(thrown));
		}
	}, [input, archiveFilename]);

	const handleFile = useCallback((file: ExportFile) => {
		try {
			setError(null);
			downloadFile(file);
		} catch (thrown) {
			setError(messageOf(thrown));
		}
	}, []);

	if (!listing) return null;

	const failure = error ?? (listing.ok ? null : listing.message);

	return (
		<div className="flex min-h-0 flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-muted-foreground text-sm">
					Every file in the export. Open one to read it, or download the lot as one archive.
				</p>
				<Button size="sm" disabled={!listing.ok} onClick={handleArchive}>
					Download {archiveFilename}
				</Button>
			</div>
			{failure ? (
				<Alert variant="destructive">
					<AlertTitle>The export failed</AlertTitle>
					<AlertDescription>{failure}</AlertDescription>
				</Alert>
			) : null}
			{listing.ok ? (
				<ul className="flex flex-col gap-2">
					{listing.files.map((file) => (
						<li key={file.path} className="flex items-start justify-between gap-3">
							<details className="min-w-0 flex-1 text-sm">
								<summary className="cursor-pointer font-mono text-xs">{file.path}</summary>
								{/* Shows the export's bytes at full precision, so display rounding must never reach it. The height cap starts at `md`, which leaves a phone scrolling the page rather than a nested box. */}
								<pre
									data-export-preview={file.path}
									className="bg-muted mt-2 rounded p-2 text-xs break-words whitespace-pre-wrap md:max-h-64 md:overflow-auto"
								>
									{file.contents}
								</pre>
							</details>
							<Button variant="outline" size="sm" onClick={() => handleFile(file)}>
								Download {file.filename}
							</Button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
