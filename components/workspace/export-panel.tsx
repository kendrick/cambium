'use client';

import { useCallback, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';
import { artifactFilenames, exportArtifacts } from '../../core/export/artifacts';
import { downloadFile } from '@/lib/download';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ExportPanel({ store }: { store: StoreApi<WorkspaceState> }) {
	const tokenSet = useStore(store, (state) => state.tokenSet);
	const record = useStore(store, (state) => state.record);
	const [error, setError] = useState<string | null>(null);

	const brandUrl = record?.brandUrl ?? null;
	const filenames = artifactFilenames(brandUrl);

	// `exportArtifacts` runs `TokenSetSchema.parse` under the hood, so this waits for a click rather
	// than paying that cost on every render a token-list keystroke would otherwise trigger. Matching
	// by filename rather than array position means a reorder in `exportArtifacts` can't quietly wire
	// a button to the wrong file.
	const handleDownload = useCallback(
		(filename: string) => {
			if (!tokenSet) return;

			try {
				const artifacts = exportArtifacts(tokenSet, { brandUrl });
				const artifact = artifacts.find((candidate) => candidate.filename === filename);

				if (!artifact) throw new Error(`exportArtifacts produced no file named ${filename}`);

				setError(null);
				downloadFile(artifact);
			} catch (thrown) {
				setError(thrown instanceof Error ? thrown.message : String(thrown));
			}
		},
		[tokenSet, brandUrl],
	);

	// Unreachable in practice: shell.tsx only mounts this panel once tokenSet is set, and its own
	// empty state covers the gap before that. This stays only so the store's TokenSet | null type
	// narrows for the rest of the component.
	if (!tokenSet) return null;

	return (
		<div className="flex min-h-0 flex-col gap-3">
			<p className="text-muted-foreground text-sm">
				The light and dark DTCG documents, and the stylesheet built from both.
			</p>
			{error ? (
				<Alert variant="destructive">
					<AlertTitle>The export failed</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			<ul className="flex flex-col gap-2">
				{filenames.map((filename) => (
					<li key={filename} className="flex items-center justify-between gap-3">
						<span className="text-sm">{filename}</span>
						<Button variant="outline" size="sm" onClick={() => handleDownload(filename)}>
							Download {filename}
						</Button>
					</li>
				))}
			</ul>
		</div>
	);
}
