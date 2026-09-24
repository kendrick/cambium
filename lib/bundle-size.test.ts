import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { type BuildOutput, firstLoadScripts, measureBundle, routeOf } from './bundle-size';

function fixture(pages: Record<string, string>, contents: Record<string, string>): BuildOutput {
	return {
		pages: Object.entries(pages).map(([route, html]) => ({ route, html })),
		scriptPaths: Object.keys(contents),
		read: (path) => new TextEncoder().encode(contents[path] ?? ''),
	};
}

const gzippedLength = (text: string) =>
	gzipSync(new TextEncoder().encode(text), { level: 9 }).byteLength;

describe('firstLoadScripts', () => {
	it('reads the scripts the entry document fetches, as paths under the export directory', () => {
		const html =
			'<script src="/_next/static/chunks/a.js" async></script>' +
			'<script async src="/_next/static/chunks/b.js"></script>';

		expect(firstLoadScripts(html)).toEqual([
			'_next/static/chunks/a.js',
			'_next/static/chunks/b.js',
		]);
	});

	// The deploy prefix is set at build time from the environment, so the same build measured under
	// GitHub Pages and under a bare domain has to produce the same paths.
	it('strips a deploy prefix so the path still matches the file on disk', () => {
		expect(firstLoadScripts('<script src="/cambium/_next/static/chunks/a.js"></script>')).toEqual([
			'_next/static/chunks/a.js',
		]);
	});

	it('ignores tags that are not scripts', () => {
		const html =
			'<link rel="preload" as="script" href="/_next/static/chunks/a.js">' +
			'<img src="/logo.png">' +
			'<script src="/_next/static/chunks/b.js"></script>';

		expect(firstLoadScripts(html)).toEqual(['_next/static/chunks/b.js']);
	});
});

describe('measureBundle', () => {
	it('counts only a route’s own scripts toward its first load, and everything toward total', () => {
		const eager = 'const eager = 1;';
		const lazy = 'const lazy = 2;';

		const measurement = measureBundle(
			fixture(
				{ '/': '<script src="/_next/static/chunks/eager.js"></script>' },
				{
					'_next/static/chunks/eager.js': eager,
					'_next/static/chunks/lazy.js': lazy,
				},
			),
		);

		expect(measurement.routes).toEqual([{ route: '/', firstLoadBytes: gzippedLength(eager) }]);
		expect(measurement.totalBytes).toBe(gzippedLength(eager) + gzippedLength(lazy));
	});

	// A second route has its own first load. Measuring one entry document let /workspace pass a
	// budget it was over, because nothing ever read its HTML.
	it('measures every route’s first load separately, counting shared chunks on each', () => {
		const shared = 'const shared = "framework";';
		const home = 'const home = "upload form";';
		const workspace = 'const workspace = "tabs, store binding, and a longer page chunk";';

		const measurement = measureBundle(
			fixture(
				{
					'/': '<script src="/_next/static/chunks/shared.js"></script><script src="/_next/static/chunks/home.js"></script>',
					'/workspace':
						'<script src="/_next/static/chunks/shared.js"></script><script src="/_next/static/chunks/workspace.js"></script>',
				},
				{
					'_next/static/chunks/shared.js': shared,
					'_next/static/chunks/home.js': home,
					'_next/static/chunks/workspace.js': workspace,
				},
			),
		);

		expect(measurement.routes).toEqual([
			{ route: '/', firstLoadBytes: gzippedLength(shared) + gzippedLength(home) },
			{ route: '/workspace', firstLoadBytes: gzippedLength(shared) + gzippedLength(workspace) },
		]);
		// Shared once in the total: each file is one download however many routes fetch it.
		expect(measurement.totalBytes).toBe(
			gzippedLength(shared) + gzippedLength(home) + gzippedLength(workspace),
		);
	});

	it('flags each file with whether any route loads it first', () => {
		const measurement = measureBundle(
			fixture(
				{
					'/': '<script src="/_next/static/chunks/eager.js"></script>',
					'/other': '<script src="/_next/static/chunks/other.js"></script>',
				},
				{
					'_next/static/chunks/lazy.js': 'const lazy = 2;',
					'_next/static/chunks/other.js': 'const other = 3;',
					'_next/static/chunks/eager.js': 'const eager = 1;',
				},
			),
		);

		expect(measurement.files.map((file) => [file.path, file.firstLoad])).toEqual([
			['_next/static/chunks/eager.js', true],
			['_next/static/chunks/lazy.js', false],
			['_next/static/chunks/other.js', true],
		]);
	});

	// Treating an unresolvable script as weightless would shrink first-load silently, which is the
	// one number the budget exists to hold.
	it('refuses to measure when a route references a script the build did not emit', () => {
		expect(() =>
			measureBundle(
				fixture(
					{
						'/': '',
						'/workspace': '<script src="/_next/static/chunks/gone.js"></script>',
					},
					{},
				),
			),
		).toThrow(
			'/workspace references scripts that are not in the build output: _next/static/chunks/gone.js',
		);
	});

	// No routes would pass every per-route budget by measuring nothing.
	it('refuses to measure a build with no routes', () => {
		expect(() => measureBundle(fixture({}, { '_next/static/chunks/a.js': 'a' }))).toThrow(
			'no routes',
		);
	});
});

describe('routeOf', () => {
	it('names each exported HTML file by the path a visitor requests', () => {
		expect(
			['index.html', 'workspace.html', '404.html', 'docs/index.html', 'docs/intro.html'].map(
				routeOf,
			),
		).toEqual(['/', '/workspace', '/404', '/docs', '/docs/intro']);
	});
});
