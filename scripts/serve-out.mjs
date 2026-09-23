import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
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
 * cost is that a file written after startup never gets served. Nothing here pays it, because
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

async function statOrNull(path) {
	try {
		return await stat(path);
	} catch {
		return null;
	}
}

// The check runs before the walk and before `listen`, so a missing export fails here, outside the
// browser. Answer the same question from the request handler and Playwright gets a live server,
// starts a browser, and reports the absent `out/` as a page that failed to load, which sends the
// reader after the app instead of the build.
if (!(await statOrNull(OUT_DIR))?.isDirectory()) {
	console.error('out/ is missing. Run `pnpm build` before the browser suite.');
	process.exit(1);
}

// Node resolves the symlinks in this file's own path before running it, so every segment of
// `OUT_DIR` is already real except the last one, which node never saw. A worktree pointing at a
// shared export makes that last segment a symlink. Containment then compares a resolved candidate
// against an unresolved root, and every route 404s under a startup line that reads healthy.
const SERVED_ROOT = await realpath(OUT_DIR);

function isUnderRoot(candidate) {
	return candidate === SERVED_ROOT || candidate.startsWith(SERVED_ROOT + sep);
}

/**
 * Turns a request path into the key the manifest is built under, or null when the path climbs out
 * of `out/`. A `..` chain arrives intact: a browser normalises it away, nothing else on the wire
 * has to, and node's HTTP server hands over `request.url` as it was sent. Answering the chain here
 * is what separates a request that tried to leave the export from one that asked for a page this
 * build does not have, since the lookup alone would call both a 404.
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
 * Walks the export once and returns the files it may serve, each with the route it sits at and the
 * fully resolved path to open.
 *
 * Resolving every entry keeps a planted symlink (`ln -s / out/root`) out of the manifest. Doing it
 * here rather than per request is what makes the check hold: verify one path, open another, and
 * the link can be swapped in the window between the two. A path with no symlinks left in it has
 * nothing to swap.
 *
 * `chain` carries the resolved directories above this one, so a link back up the tree
 * (`ln -s . out/self`) is skipped rather than followed forever.
 */
async function collect(dir, prefix, chain) {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
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
			file: real,
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

const MANIFEST = manifestFrom(await collect(SERVED_ROOT, '', [SERVED_ROOT]));

/**
 * Resolves once the file is open, so a route the manifest carries but the process cannot read
 * answers 500 rather than a 200 whose body never arrives.
 *
 * `createReadStream(...).pipe(response)` raises that failure after the handler has returned, too
 * late for the handler's own `catch`, and an `error` event with no listener ends the process.
 */
function openForRead(file) {
	return new Promise((resolveStream, rejectStream) => {
		const stream = createReadStream(file);

		stream.once('open', () => resolveStream(stream));
		stream.once('error', (error) => {
			stream.destroy();
			rejectStream(error);
		});
	});
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

	if (request.method === 'HEAD') {
		response.writeHead(200, { 'content-type': entry.type });

		return response.end();
	}

	let stream;
	try {
		stream = await openForRead(entry.file);
	} catch {
		return send(response, 500, 'internal error');
	}

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
