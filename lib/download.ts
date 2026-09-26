/**
 * The repo's first download code, and browser-only for that reason: `Blob` and
 * `URL.createObjectURL` have no equivalent under Node, so this stays out of `core/` and off any
 * import path a Vitest unit test walks. `e2e/export.spec.ts` (issue #29's browser wave) is the only
 * thing that proves it fires, per `docs/agents/testing.md`'s "no browser tier in Vitest".
 */
export function downloadFile({
	filename,
	mediaType,
	contents,
}: {
	filename: string;
	mediaType: string;
	contents: string;
}): void {
	const url = URL.createObjectURL(new Blob([contents], { type: mediaType }));
	const anchor = document.createElement('a');

	anchor.href = url;
	anchor.download = filename;
	anchor.click();

	// Revoking on this tick can race the browser's own read of the blob and cancel the download in
	// some engines, so the revoke waits for the next one instead.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
