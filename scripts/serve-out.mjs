import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
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

function isUnderOut(candidate) {
	return candidate === OUT_DIR || candidate.startsWith(OUT_DIR + sep);
}

/**
 * Maps a request path to its place under `out/`, or to null when the path escapes `out/`. The
 * check runs before any filesystem call because a `..` chain arrives intact. A browser normalises
 * the chain away, nothing else on the wire has to, and node's HTTP server hands over
 * `request.url` as it was sent.
 *
 * Clearing the wire path is half the job. `findFile` derives the paths it opens from this answer,
 * and a derived path can leave `out/` on its own, so `findFile` re-checks each one.
 */
function resolveUnderOut(pathname) {
	const candidate = resolve(OUT_DIR, `.${pathname}`);

	return isUnderOut(candidate) ? candidate : null;
}

/**
 * The only thing that answers whether a path is a file this server may open. `isUnderOut` alone
 * used to be treated as that answer, but it compares strings that `path.resolve` produced without
 * ever touching the filesystem, so a symlink planted inside `out/` (`ln -s / out/root`) passes it
 * while pointing anywhere. Resolving the candidate with `realpath` and checking containment again
 * against the link's target is what actually stops that: a candidate that traverses a symlink to
 * outside `out/` now fails here even though its own path string never left `out/`.
 *
 * The `isFile` check has to run before `realpath`, not after: `realpath` rejects on a path that
 * doesn't exist, and a missing candidate is not a containment failure, so checking existence first
 * keeps that rejection out of the escape case this function exists to catch.
 */
async function fileUnderOut(candidate) {
	if (!isUnderOut(candidate)) return null;
	if (!(await statOrNull(candidate))?.isFile()) return null;

	const real = await realpath(candidate).catch(() => null);

	return real !== null && isUnderOut(real) ? candidate : null;
}

/**
 * A route has two plausible homes on disk and this export uses both. `/` is `out/index.html`,
 * while `/_not-found` is `out/_not-found.html` beside a directory of the same name that holds
 * only RSC payloads. Checking the sibling `.html` before the directory index keeps the second
 * case from 404ing on a directory that has no `index.html`.
 *
 * Each candidate goes back through `fileUnderOut` because that sibling can sit outside `out/`.
 * `/` resolves to `out/` itself, which clears containment by definition, and the sibling of `out/`
 * is `out.html` in the repo root. The sibling is checked first, so nothing else catches it.
 */
async function findFile(target) {
	const direct = await fileUnderOut(target);
	if (direct) return direct;
	if (extname(target)) return null;

	const sibling = await fileUnderOut(`${target}.html`);
	if (sibling) return sibling;

	return fileUnderOut(resolve(target, 'index.html'));
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

const server = createServer((request, response) => {
	handle(request, response).catch(() => send(response, 500, 'internal error'));
});

// Logs the port the socket bound. Port 0 means "any free port", so echoing the requested number
// back would leave the real one only inside the process. `scripts/serve-out.test.ts` asks for 0
// and reads the answer off this line.
server.listen(port, '127.0.0.1', () => {
	console.log(`serving ${OUT_DIR} at http://127.0.0.1:${server.address().port}`);
});
