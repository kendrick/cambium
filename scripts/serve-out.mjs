import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serves `out/`, the static export `pnpm build` writes, over HTTP. Playwright then drives what
 * ships rather than a dev server. `next dev` compiles on demand and reports errors the export
 * never produces, which leaves a browser suite green over code no user will run.
 */

const OUT_DIR = resolve(fileURLToPath(new URL('../out', import.meta.url)));

const CONTENT_TYPES = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain; charset=utf-8',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
};

async function statOrNull(path) {
	try {
		return await stat(path);
	} catch {
		return null;
	}
}

/**
 * Maps a request path to its place under `out/`, or to null when the path escapes `out/`. The
 * check runs before any filesystem call because a `..` chain arrives intact. A browser normalises
 * the chain away, nothing else on the wire has to, and node's HTTP server hands over
 * `request.url` as it was sent.
 */
function resolveUnderOut(pathname) {
	const candidate = resolve(OUT_DIR, `.${pathname}`);

	if (candidate !== OUT_DIR && !candidate.startsWith(OUT_DIR + sep)) return null;

	return candidate;
}

/**
 * A route has two plausible homes on disk and this export uses both. `/` is `out/index.html`,
 * while `/_not-found` is `out/_not-found.html` beside a directory of the same name that holds
 * only RSC payloads. Checking the sibling `.html` before the directory index keeps the second
 * case from 404ing on a directory that has no `index.html`.
 */
async function findFile(target) {
	if ((await statOrNull(target))?.isFile()) return target;
	if (extname(target)) return null;

	const asHtml = `${target}.html`;
	if ((await statOrNull(asHtml))?.isFile()) return asHtml;

	const asIndex = resolve(target, 'index.html');
	return (await statOrNull(asIndex))?.isFile() ? asIndex : null;
}

function send(response, status, message) {
	response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
	response.end(message);
}

async function handle(request, response) {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return send(response, 405, 'method not allowed');
	}

	let pathname;
	try {
		// A malformed escape (`%zz`) makes `decodeURIComponent` throw, so the path never reaches
		// the filesystem.
		pathname = decodeURIComponent(request.url.split(/[?#]/, 1)[0]);
	} catch {
		return send(response, 400, 'bad request');
	}

	const target = resolveUnderOut(pathname);

	if (target === null) return send(response, 403, `refused: ${pathname} escapes out/`);

	const file = await findFile(target);

	if (file === null) return send(response, 404, `not found: ${pathname}`);

	response.writeHead(200, {
		'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
	});

	if (request.method === 'HEAD') return response.end();

	createReadStream(file).pipe(response);
}

// The check sits above `listen` so a missing export fails here, outside the browser. Answer the
// same question from the request handler and Playwright gets a live server, starts a browser, and
// reports the absent `out/` as a page that failed to load, which sends the reader after the app
// instead of the build.
const outDir = await statOrNull(OUT_DIR);

if (!outDir?.isDirectory()) {
	console.error('out/ is missing. Run `pnpm build` before the browser suite.');
	process.exit(1);
}

const port = Number(process.argv[2] ?? process.env.CAMBIUM_SERVE_PORT ?? process.env.PORT ?? 4173);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
	console.error(`invalid port: ${process.argv[2] ?? process.env.CAMBIUM_SERVE_PORT ?? ''}`);
	process.exit(1);
}

createServer((request, response) => {
	handle(request, response).catch(() => send(response, 500, 'internal error'));
}).listen(port, '127.0.0.1', () => {
	console.log(`serving ${OUT_DIR} at http://127.0.0.1:${port}`);
});
