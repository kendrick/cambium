import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serves `out/`, the static export `pnpm build` writes, over HTTP. Playwright then drives what
 * ships rather than a dev server. `next dev` compiles on demand and reports errors the export
 * never produces, which leaves a browser suite green over code no user will run.
 *
 * Every path this process opens is resolved once, at startup, into a manifest keyed by request
 * path. A request is then a `Map` lookup, so no value off the wire reaches a filesystem call. The
 * lookup settles which path is opened and not which file answers to it by the time it opens, so
 * `openVerified` checks every descriptor against the file the walk indexed.
 *
 * The cost is that a file written after startup never gets served. Nothing here pays it, because
 * `playwright.config.ts` sets `reuseExistingServer: false` and the order is always build `out/`,
 * start the server, run the suite.
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

// `bigint` keeps `dev` and `ino` exact for the comparison in `openVerified`. Inode numbers are
// 64-bit, and a double rounds the large ones together, so two different files can compare equal.
async function statOrNull(path) {
	try {
		return await stat(path, { bigint: true });
	} catch {
		return null;
	}
}

/**
 * Resolves `out/` to the directory this process will serve, or says what is missing and stops.
 *
 * Node resolves the symlinks in this file's own path before running it, so every segment of
 * `OUT_DIR` is already real except the last one, which node never saw. A worktree pointing at a
 * shared export makes that last segment a symlink. Containment then compares a resolved candidate
 * against an unresolved root, and every route 404s under a startup line that reads healthy.
 *
 * Resolving and checking in one place leaves no gap between them. Split across two calls, an
 * `out/` that goes away in between ends the process with an unhandled rejection and a stack, which
 * buries the one line a person needs.
 *
 * Running before the walk and before `listen` is what keeps a missing export outside the browser.
 * Answer the same question from the request handler and Playwright gets a live server, starts a
 * browser, and reports the absent `out/` as a page that failed to load, which sends the reader
 * after the app instead of the build.
 */
async function servedRoot() {
	const real = await realpath(OUT_DIR).catch(() => null);

	if (real !== null && (await statOrNull(real))?.isDirectory()) return real;

	console.error('out/ is missing. Run `pnpm build` before the browser suite.');
	process.exit(1);
}

const SERVED_ROOT = await servedRoot();

function isUnderRoot(candidate) {
	return candidate === SERVED_ROOT || candidate.startsWith(SERVED_ROOT + sep);
}

/**
 * Turns a request path into the key the manifest is built under, or null when the collapsed path
 * lands outside `out/`. The check asks where the path lands and not which route it took there: a
 * chain that climbs out of a root named `out` and straight back into it, as `/%2e%2e/out/app.css`
 * does, is answered as `/app.css` like any other file the walk indexed.
 *
 * A `..` chain arrives intact: a browser normalises it away, nothing else on the wire has to, and
 * node's HTTP server hands over `request.url` as it was sent. Answering the chain here is what
 * separates a request that tried to leave the export from one that asked for a page this build
 * does not have, since the lookup alone would call both a 404.
 *
 * `path.resolve` collapses the chain without touching the filesystem. Only the part below the root
 * survives, as a key; the absolute path it returns is thrown away.
 */
function routeFor(pathname) {
	const target = resolve(SERVED_ROOT, `.${pathname}`);

	if (target === SERVED_ROOT) return '/';
	if (!target.startsWith(SERVED_ROOT + sep)) return null;

	return target.slice(SERVED_ROOT.length).split(sep).join('/');
}

/**
 * Walks the export once and returns the files it may serve, each with the route it sits at, the
 * fully resolved path to open, and the identity on disk that `openVerified` re-checks.
 *
 * Resolving every entry keeps a planted symlink (`ln -s / out/root`) out of the manifest. The walk
 * cannot keep that answer true. It records a name, and a name can point somewhere else by the time
 * a request opens it, which is why `openVerified` checks the file again at the open.
 *
 * A directory the walk cannot read stops it. Read as an empty one instead, it costs nothing at
 * startup and then 404s its whole subtree under a startup line that reads healthy.
 *
 * `chain` carries the resolved directories above this one, so a link back up the tree
 * (`ln -s . out/self`) is skipped rather than followed forever.
 */
async function collect(dir, prefix, chain) {
	const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
		throw new Error(`cannot read ${dir}: ${error.code ?? error.message}`, { cause: error });
	});
	const found = await Promise.all(entries.map((entry) => resolveEntry(dir, prefix, chain, entry)));

	return found.flat();
}

async function resolveEntry(dir, prefix, chain, entry) {
	const real = await realpath(join(dir, entry.name)).catch(() => null);

	if (real === null || !isUnderRoot(real)) return [];

	const route = `${prefix}/${entry.name}`;
	const stats = await statOrNull(real);

	if (stats?.isDirectory()) {
		return chain.includes(real) ? [] : collect(real, route, [...chain, real]);
	}

	if (!stats?.isFile()) return [];

	return [
		{
			// `dev` and `ino` name the file itself. `real` names a path, which the filesystem
			// answers again on every open, with an answer that can change in between.
			dev: stats.dev,
			file: real,
			ino: stats.ino,
			route,
			// Taken from the route rather than from `file`, so a link named `alias.txt` pointing at
			// `styles.css` is served as `text/plain`, the type the request asked for.
			type: CONTENT_TYPES[extname(route)] ?? 'application/octet-stream',
		},
	];
}

/**
 * Keys every file under each route that may reach it. A route has two plausible homes on disk and
 * this export uses both: `/` is `out/index.html`, while `/_not-found` is `out/_not-found.html`
 * beside a directory of the same name that holds only RSC payloads.
 *
 * The passes run in priority order: the file's own path, then the sibling `.html`, then the
 * directory's `index.html`. The first pass to claim a key keeps it, which is what stops
 * `/_not-found` from 404ing on a directory that has no `index.html`.
 *
 * Neither derived key carries an extension, because `/app.js` asks for a file rather than for
 * `app.js.html`.
 */
function manifestFrom(files) {
	const manifest = new Map();
	const claim = (route, entry) => {
		if (!manifest.has(route)) manifest.set(route, entry);
	};

	for (const entry of files) claim(entry.route, entry);

	for (const entry of files) {
		if (!entry.route.endsWith('.html')) continue;

		const route = entry.route.slice(0, -'.html'.length);

		if (route !== '' && extname(route) === '') claim(route, entry);
	}

	for (const entry of files) {
		if (!entry.route.endsWith('/index.html')) continue;

		const route = entry.route.slice(0, -'/index.html'.length) || '/';

		if (extname(route) === '') claim(route, entry);
	}

	return manifest;
}

// Once the server is up, a short manifest looks exactly like a small export, so a walk that failed
// has to stop the process here, before `listen`.
async function walkOrExit() {
	try {
		return await collect(SERVED_ROOT, '', [SERVED_ROOT]);
	} catch (error) {
		console.error(`${error.message}. Re-run \`pnpm build\` before the browser suite.`);
		process.exit(1);
	}
}

const MANIFEST = manifestFrom(await walkOrExit());

/**
 * Opens the file the walk indexed, or throws.
 *
 * The open runs before any status goes out, so a route the manifest carries but the process cannot
 * read answers 500 rather than a 200 over a body that never arrives. `pipe` raises that failure
 * after the handler has returned, too late for its `catch`, and an `error` event with no listener
 * ends the process.
 *
 * The path came from the walk, so nothing off the wire reaches this call. A path is still only a
 * name at open time. `open` follows a symlink at the last component, so a link dropped in over an
 * indexed file serves whatever it points at, and `O_NOFOLLOW` refuses that link. The `dev`/`ino`
 * comparison covers the swaps that need no link at all—a file renamed over the path, or a new one
 * written at it—by asking the open descriptor what it is instead of asking the name where it
 * points.
 *
 * `O_NONBLOCK` covers the third shape. A FIFO left at the path parks the open in the threadpool
 * until somebody writes to it, and four of those starve every other filesystem call in the
 * process. `isFile` then refuses it.
 *
 * None of this sees a hard link planted inside the export before the walk. It has no target to
 * resolve and an identity of its own, so the walk indexes it like any other file and every check
 * here agrees. The one tell is a link count above one, and refusing on that would also refuse an
 * export restored by `cp -al` or from a CI cache, which puts a healthy startup line over a subtree
 * that serves nothing. Planting a hard link needs write access to `out/` before startup, which is
 * already enough to copy the bytes in.
 */
async function openVerified(entry) {
	const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
	const opened = await open(entry.file, flags);

	try {
		const stats = await opened.stat({ bigint: true });

		if (!stats.isFile() || stats.dev !== entry.dev || stats.ino !== entry.ino) {
			throw new Error(`${entry.file} is not the file the walk indexed`);
		}
	} catch (error) {
		await opened.close().catch(() => {});

		throw error;
	}

	return opened;
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
		// A malformed escape (`%zz`) makes `decodeURIComponent` throw, so the path never reaches the
		// manifest.
		pathname = decodeURIComponent(request.url.split(/[?#]/, 1)[0]);
	} catch {
		return send(response, 400, 'bad request');
	}

	const route = routeFor(pathname);

	if (route === null) return send(response, 403, `refused: ${pathname} escapes out/`);

	const entry = MANIFEST.get(route);

	if (entry === undefined) return send(response, 404, `not found: ${pathname}`);

	// HEAD opens the file and drops it. Answered from the manifest alone, HEAD reports 200 for a
	// route whose file is gone, while the GET it stands in for reports 500, so a client asking the
	// cheap question first gets the wrong answer to the expensive one.
	let opened;
	try {
		opened = await openVerified(entry);
	} catch {
		return send(response, 500, 'internal error');
	}

	if (request.method === 'HEAD') {
		await opened.close();
		response.writeHead(200, { 'content-type': entry.type });

		return response.end();
	}

	const stream = opened.createReadStream();

	response.writeHead(200, { 'content-type': entry.type });

	// The status is already on the wire by now, so a read that fails mid-body can only cut the
	// connection. A client reading a truncated response knows something went wrong; a server that
	// died on an unhandled `error` leaves the rest of the suite with nothing to talk to.
	stream.on('error', () => response.destroy());
	response.on('close', () => stream.destroy());

	stream.pipe(response);
}

const port = Number(process.argv[2] ?? process.env.CAMBIUM_SERVE_PORT ?? process.env.PORT ?? 4173);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
	console.error(`invalid port: ${process.argv[2] ?? process.env.CAMBIUM_SERVE_PORT ?? ''}`);
	process.exit(1);
}

const server = createServer((request, response) => {
	handle(request, response).catch(() => send(response, 500, 'internal error'));
});

// A port already in use throws a raw node stack at whoever ran the suite unless something answers
// it. The missing-`out/` check above sets the bar: say what failed, name the number, exit non-zero.
server.on('error', (error) => {
	console.error(`cannot bind 127.0.0.1:${port}: ${error.code ?? error.message}`);
	process.exit(1);
});

// Logs the port the socket bound. Port 0 means "any free port", so echoing the requested number
// back would leave the real one only inside the process. `scripts/serve-out.test.ts` asks for 0
// and reads the answer off this line.
server.listen(port, '127.0.0.1', () => {
	console.log(
		`serving ${MANIFEST.size} routes from ${SERVED_ROOT} at http://127.0.0.1:${server.address().port}`,
	);
});
