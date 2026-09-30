import { DTCG_MEDIA_TYPE, type ExportArtifact, filenamePrefix } from './artifacts';

/** One archive entry as the export pane lists and downloads it on its own. */
export type ExportFile = ExportArtifact & { path: string };

/**
 * Pure, like the adapters behind `entries`. Sorted to the zip's own order: `exportArchiveEntries`
 * inserts light before dark and only `buildExportArchive` sorts, so an unsorted listing would read
 * as a different export from the archive.
 *
 * The download name is the brand prefix plus the path's basename. That keeps #29's three names
 * byte for byte, and the nine basenames the archive writes are distinct.
 */
export function exportFiles(
	entries: Record<string, string>,
	brandUrl: string | null,
): ExportFile[] {
	const prefix = filenamePrefix(brandUrl);

	// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh.
	return (
		Object.keys(entries)
			// oxlint-disable-next-line unicorn/no-array-sort
			.sort()
			.map((path) => ({
				path,
				filename: `${prefix}${path.slice(path.lastIndexOf('/') + 1)}`,
				mediaType: mediaTypeOf(path),
				contents: entries[path]!,
			}))
	);
}

// `text/plain` rather than a throw, so a file the archive adds later downloads as text instead of
// taking the pane down in render. The media-type test proves none of today's nine lands here.
function mediaTypeOf(path: string): string {
	if (path.endsWith('.tokens.json')) return DTCG_MEDIA_TYPE;
	if (path.endsWith('.json')) return 'application/json';
	if (path.endsWith('.css')) return 'text/css';
	if (path.endsWith('.md')) return 'text/markdown';
	return 'text/plain';
}
