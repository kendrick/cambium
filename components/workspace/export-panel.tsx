'use client';

import { useCallback, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { WorkspaceState } from '../../app/state/workspace-store';
import { exportArtifacts, filenamePrefix } from '../../core/export/artifacts';
import { downloadFile } from '@/lib/download';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const ARTIFACT_SUFFIXES = ['light.tokens.json', 'dark.tokens.json', 'tokens.css'] as const;

/**
 * Loaded lazily from `shell.tsx`: `exportArtifacts` pulls in `serializeDtcg` and `toStylesheet`,
 * both new to the workspace chunk per #29, and neither adapter earns its weight until someone
 * opens this tab.
 */
export function ExportPanel({ store }: { store: StoreApi<WorkspaceState> }) {
	const tokenSet = useStore(store, (state) => state.tokenSet);
	const record = useStore(store, (state) => state.record);
	const [error, setError] = useState<string | null>(null);

	const brandUrl = record?.brandUrl ?? null;
	const prefix = filenamePrefix(brandUrl);

	// `exportArtifacts` runs `TokenSetSchema.parse` under the hood, so this waits for a click rather
	// than paying that cost on every render a token-list keystroke would otherwise trigger.
	const handleDownload = useCallback(
		(index: number) => {
			if (!tokenSet) return;

			try {
				const artifacts = exportArtifacts(tokenSet, { brandUrl });
				setError(null);
				downloadFile(artifacts[index]);
			} catch (thrown) {
				setError(thrown instanceof Error ? thrown.message : String(thrown));
			}
		},
		[tokenSet, brandUrl],
	);

	if (!tokenSet) {
		return (
			<p className="text-muted-foreground text-sm">
				There are no tokens to export yet. They show up here once the seed produces a token set.
			</p>
		);
	}

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
				{ARTIFACT_SUFFIXES.map((suffix, index) => {
					const filename = `${prefix}${suffix}`;

					return (
						<li key={suffix} className="flex items-center justify-between gap-3">
							<span className="text-sm">{filename}</span>
							<Button variant="outline" size="sm" onClick={() => handleDownload(index)}>
								Download {filename}
							</Button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
