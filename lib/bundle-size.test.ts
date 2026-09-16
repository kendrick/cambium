import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { type BuildOutput, firstLoadScripts, measureBundle } from './bundle-size';

function fixture(entryHtml: string, contents: Record<string, string>): BuildOutput {
	return {
		entryHtml,
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
	it('counts only the entry document’s scripts toward first load, and everything toward total', () => {
		const eager = 'const eager = 1;';
		const lazy = 'const lazy = 2;';

		const measurement = measureBundle(
			fixture('<script src="/_next/static/chunks/eager.js"></script>', {
				'_next/static/chunks/eager.js': eager,
				'_next/static/chunks/lazy.js': lazy,
			}),
		);

		expect(measurement.firstLoadBytes).toBe(gzippedLength(eager));
		expect(measurement.totalBytes).toBe(gzippedLength(eager) + gzippedLength(lazy));
	});

	it('flags each file with whether it is first load', () => {
		const measurement = measureBundle(
			fixture('<script src="/_next/static/chunks/eager.js"></script>', {
				'_next/static/chunks/lazy.js': 'const lazy = 2;',
				'_next/static/chunks/eager.js': 'const eager = 1;',
			}),
		);

		expect(measurement.files.map((file) => [file.path, file.firstLoad])).toEqual([
			['_next/static/chunks/eager.js', true],
			['_next/static/chunks/lazy.js', false],
		]);
	});

	// Treating an unresolvable script as weightless would shrink first-load silently, which is the
	// one number the budget exists to hold.
	it('refuses to measure when the entry references a script the build did not emit', () => {
		expect(() =>
			measureBundle(fixture('<script src="/_next/static/chunks/gone.js"></script>', {})),
		).toThrow('_next/static/chunks/gone.js');
	});
});
