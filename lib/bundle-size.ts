import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Measures what a visitor downloads, which is a different question from the one the OSS research
 * notes answer. Those measure a library in isolation, through esbuild, to price a package. This
 * measures the built app to price a page load. Same compression settings, different subject; see
 * ADR-0002 on why the two methods are allowed to diverge.
 *
 * This has to live in lib/ rather than core/. It reads the filesystem and calls node:zlib, and
 * core/purity.test.ts exists to fail exactly that.
 */

/**
 * The build output, as data. Injected the way lib/deploy-paths.ts takes an EnvSource, so the unit
 * tests measure fixtures instead of needing a real build on disk.
 *
 * Paths are relative to the export directory, matching the shape a `<script src>` reduces to:
 * `_next/static/chunks/13a-fmo859pu-.js`.
 */
export type BuildOutput = {
	entryHtml: string;
	scriptPaths: readonly string[];
	read: (path: string) => Uint8Array;
};

export type MeasuredFile = {
	path: string;
	gzippedBytes: number;
	firstLoad: boolean;
};

export type BundleMeasurement = {
	firstLoadBytes: number;
	totalBytes: number;
	files: MeasuredFile[];
};

/**
 * Turbopack content-hashes chunk names with no stable prefix, so the entry document is the only
 * thing that knows which chunks a visitor fetches before the page is interactive.
 */
const SCRIPT_SRC = /<script\b[^>]*?\ssrc="([^"]+)"/g;

/*
 * Two assumptions this pins, both true of the current build and neither guaranteed forever.
 *
 * Only `<script src>` counts as first load. A chunk Next emits as `modulepreload` alone would
 * measure as lazy; today every preloaded chunk is also a `<script src>`, so the two agree.
 *
 * Every script lives under `_next/static`. One served from `public/` would not be globbed, and
 * `measureBundle` throws rather than measuring, which is the failure this file wants.
 */

/**
 * Reduces a `<script src>` to a path relative to the export directory. `basePath` prefixes the src
 * with the deploy prefix (see lib/deploy-paths.ts) while the file on disk keeps its bare path, so
 * anchor on `_next/` rather than stripping a fixed number of segments.
 */
function toOutputPath(src: string): string {
	// `split` always yields at least one element, so this never needs a fallback.
	const [withoutQuery] = src.split(/[?#]/);
	const nextIndex = withoutQuery.indexOf('_next/');

	return nextIndex === -1 ? withoutQuery.replace(/^\/+/, '') : withoutQuery.slice(nextIndex);
}

export function firstLoadScripts(entryHtml: string): string[] {
	return [...entryHtml.matchAll(SCRIPT_SRC)].map((match) => toOutputPath(match[1] ?? ''));
}

/**
 * Compression matches the research notes' `gzip -9` so the two sets of figures stay comparable.
 * Each file is compressed alone because each is its own HTTP response.
 */
function gzippedSize(bytes: Uint8Array): number {
	return gzipSync(bytes, { level: 9 }).byteLength;
}

export function measureBundle(output: BuildOutput): BundleMeasurement {
	const firstLoad = new Set(firstLoadScripts(output.entryHtml));

	const missing = [...firstLoad].filter((path) => !output.scriptPaths.includes(path));
	if (missing.length > 0) {
		// Counting an unresolvable script as zero would quietly shrink first-load, which is the
		// number the budget exists to hold.
		throw new Error(
			`the entry document references scripts that are not in the build output: ${missing.join(', ')}`,
		);
	}

	// Sorted so the breakdown reads the same on every run. `toSorted` would say this better, but
	// it is ES2023 and tsconfig targets ES2022; the spread already makes the copy the rule wants.
	// oxlint-disable-next-line unicorn/no-array-sort
	const files = [...output.scriptPaths].sort().map((path) => ({
		path,
		gzippedBytes: gzippedSize(output.read(path)),
		firstLoad: firstLoad.has(path),
	}));

	return {
		firstLoadBytes: files
			.filter((file) => file.firstLoad)
			.reduce((total, file) => total + file.gzippedBytes, 0),
		totalBytes: files.reduce((total, file) => total + file.gzippedBytes, 0),
		files,
	};
}

/**
 * Reads a real static export. Globs rather than naming files: Turbopack content-hashes every chunk
 * and scopes the manifest directory by build id, so nothing here is stable enough to hard-code.
 */
export function readStaticExport(outDir: URL): BuildOutput {
	// Filesystem paths throughout, never URL pathnames. `URL.pathname` percent-encodes, so a
	// checkout living under a directory with a space in it makes `pathname` longer than the real
	// path and any offset taken from it lands mid-name.
	const root = fileURLToPath(outDir);
	const staticDir = join(root, '_next', 'static');

	const scriptPaths = readdirSync(staticDir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
		// Separators normalise to `/` because these keys are compared against `<script src>`.
		.map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));

	return {
		entryHtml: readFileSync(join(root, 'index.html'), 'utf8'),
		scriptPaths,
		read: (path) => readFileSync(join(root, path)),
	};
}
