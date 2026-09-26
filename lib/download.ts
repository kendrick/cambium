import type { ExportArtifact } from '../core/export/artifacts';

/**
 * Browser-only, and kept out of `core/` and off any import path a Vitest unit test walks. `Blob`
 * and `URL.createObjectURL` aren't why: Node 18+ ships both. What forces this out is
 * `document.createElement` and the anchor click below, which need a DOM. `e2e/export.spec.ts` is
 * the only thing that proves it fires, per `docs/agents/testing.md`'s "no browser tier in Vitest".
 */
export function downloadFile({ filename, mediaType, contents }: ExportArtifact): void {
	const url = URL.createObjectURL(new Blob([contents], { type: mediaType }));
	const anchor = document.createElement('a');

	anchor.href = url;
	anchor.download = filename;

	try {
		anchor.click();
	} finally {
		// Revoking on this tick can race the browser's own read of the blob and cancel the download
		// in some engines, so the revoke waits for the next one. It sits in `finally` because
		// something hooking `click` can throw, and an unrevoked URL pins its Blob for the page's life.
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}
