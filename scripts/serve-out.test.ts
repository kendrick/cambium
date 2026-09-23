import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { type IncomingHttpHeaders, request as httpRequest } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const SERVER = fileURLToPath(new URL('./serve-out.mjs', import.meta.url));

// Every case here spawns node, which pays its own startup before the server binds. That fits
// inside Vitest's 5s default on a warm checkout and has no margin left on a loaded one.
const TIMEOUT = 30_000;

/**
 * The layout every case runs against, built here rather than taken from the real `out/`.
 *
 * `OUT_DIR` is resolved from the script's own URL, so the only way to hand the server a different
 * export is to hand it a different copy of itself. That buys the two files the real repo has no
 * reason to hold: `out.html` beside `out/`, the sibling a request for `/` can reach, and
 * `secret.txt` for a `..` chain to aim at.
 *
 * `_not-found` reproduces the shape the real export writes: an `.html` file beside a directory of
 * the same name holding only RSC payloads, which is the whole reason the sibling lookup exists.
 *
 * `doomed.txt` exists to be deleted once the server is up, which is how a live server ends up
 * holding a route it cannot open.
 */
async function buildExport(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'cambium-serve-out-'));

	await mkdir(join(root, 'scripts'));
	await mkdir(join(root, 'out', '_not-found'), { recursive: true });
	await copyFile(SERVER, join(root, 'scripts', 'serve-out.mjs'));

	await writeFile(join(root, 'out', 'index.html'), '<h1>real index</h1>\n');
	await writeFile(join(root, 'out', '_not-found.html'), '<h1>real not found</h1>\n');
	await writeFile(join(root, 'out', '_not-found', 'page.rsc'), '0:["rsc payload"]\n');
	await writeFile(join(root, 'out', 'styles.css'), 'body{color:red}\n');
	await writeFile(join(root, 'out', 'nojekyll'), 'no extension\n');
	await writeFile(join(root, 'out', 'doomed.txt'), 'here at startup\n');

	await writeFile(join(root, 'out.html'), '<h1>outside the sandbox</h1>\n');
	await writeFile(join(root, 'secret.txt'), 'outside the sandbox\n');

	return root;
}

/**
 * The same layout with the escaping links already in place, so the walk that builds the manifest
 * has to refuse them. A link planted after the server is up tests something weaker: whether a
 * manifest fixed at startup carries a route it never saw.
 *
 * `alias.css` is the control. A walk that dropped every symlink it met would pass all three
 * refusals below and still be broken, because the export would lose every linked file with them.
 */
async function buildExportWithLinks(): Promise<string> {
	const root = await buildExport();

	await symlink('/', join(root, 'out', 'root'));
	await symlink('..', join(root, 'out', 'up'));
	await symlink(join('..', 'secret.txt'), join(root, 'out', 'leak.txt'));
	await symlink('styles.css', join(root, 'out', 'alias.css'));

	return root;
}

/**
 * An export reached through a symlink, which is what a worktree pointing at a shared build has.
 * Node resolves the links in the server's own path before running it, so `out/` is the one path
 * left for the server to resolve. A server that skips it 404s every route behind a startup line
 * that reads healthy.
 */
async function buildLinkedExport(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'cambium-serve-out-linked-'));

	await mkdir(join(root, 'scripts'));
	await mkdir(join(root, 'real-export'));
	await copyFile(SERVER, join(root, 'scripts', 'serve-out.mjs'));

	await writeFile(join(root, 'real-export', 'index.html'), '<h1>linked index</h1>\n');
	await writeFile(join(root, 'real-export', 'styles.css'), 'body{color:blue}\n');
	await symlink('real-export', join(root, 'out'));

	return root;
}

/**
 * Starts the copied server on whatever port the OS has free and reads the bound number back off
 * its own startup line. Asking for a fixed port instead would make a second Vitest worker, or a
 * stray `pnpm test:e2e`, fail this file on `EADDRINUSE`.
 */
function startServer(root: string): Promise<{ child: ChildProcess; port: number }> {
	const child = spawn('node', [join(root, 'scripts', 'serve-out.mjs'), '0'], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	return new Promise((resolve, reject) => {
		let stdout = '';

		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			stdout += chunk;

			const port = /http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout)?.[1];
			if (port) resolve({ child, port: Number(port) });
		});

		child.on('error', reject);
		child.on('exit', (code) => reject(new Error(`the server exited with ${code} before binding`)));
	});
}

type Answer = { status: number; headers: IncomingHttpHeaders; body: string };

/**
 * Drives the server over a socket rather than calling its resolver, because the response a
 * browser gets back is what these cases are about. A fixture importing `routeFor` watches that
 * function turn `/` into a key and learns nothing about which file the response then carries.
 *
 * `node:http` rather than `fetch`, because `path` reaches the wire as written. `new URL` folds a
 * `..` segment away and rejects a malformed escape, which are the two requests this file most
 * needs to send.
 */
function get(port: number, path: string, method = 'GET'): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const outgoing = httpRequest({ host: '127.0.0.1', port, method, path }, (response) => {
			let body = '';

			response.setEncoding('utf8');
			response.on('data', (chunk: string) => (body += chunk));
			response.on('end', () =>
				resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
			);
		});

		outgoing.on('error', reject);
		outgoing.end();
	});
}

describe('scripts/serve-out.mjs', () => {
	let port: number;
	let child: ChildProcess;
	let exportRoot: string;

	beforeAll(async () => {
		exportRoot = await buildExport();
		const started = await startServer(exportRoot);

		port = started.port;
		child = started.child;
	}, TIMEOUT);

	afterAll(() => {
		child.kill();
	});

	it('serves a file with the content type its extension maps to', async () => {
		const answer = await get(port, '/styles.css');

		expect(answer.status).toBe(200);
		expect(answer.headers['content-type']).toBe('text/css; charset=utf-8');
		expect(answer.body).toBe('body{color:red}\n');
	});

	it('falls back to octet-stream for an extension the map does not carry', async () => {
		const answer = await get(port, '/nojekyll');

		expect(answer.status).toBe(200);
		expect(answer.headers['content-type']).toBe('application/octet-stream');
	});

	// Guards the escape that makes this whole file worth having. `/` clears containment as `out/`
	// itself, so a sibling lookup trusting that cleared target opens `out.html` beside the export,
	// and it opens it before `out/index.html` is ever considered.
	it('serves out/index.html for / rather than the out.html beside the export', async () => {
		const answer = await get(port, '/');

		expect(answer.status).toBe(200);
		expect(answer.body).toBe('<h1>real index</h1>\n');
	});

	it('serves the sibling .html for a route whose directory holds only RSC payloads', async () => {
		const answer = await get(port, '/_not-found');

		expect(answer.status).toBe(200);
		expect(answer.body).toBe('<h1>real not found</h1>\n');
	});

	it('refuses a path that climbs out of out/', async () => {
		const answer = await get(port, '/../secret.txt');

		expect(answer.status).toBe(403);
		expect(answer.body).toContain('escapes out/');
	});

	// The three cases below plant their link while the server is up, so each pins one thing: a link
	// that appears after startup never becomes servable. The manifest was fixed before the link
	// existed, and a route it does not carry is a 404 whatever sits at that path now.
	// `describe('with escaping symlinks already in place')` covers the walk's own refusals. Each
	// case removes its link in `finally` so a failed assertion can't leave a live `/ -> out/root`
	// symlink behind.
	it('refuses a request through a symlink planted at / after startup', async () => {
		const link = join(exportRoot, 'out', 'root');

		await symlink('/', link);

		try {
			const answer = await get(port, '/root/etc/hosts');

			expect(answer.status).toBe(404);
		} finally {
			await rm(link);
		}
	});

	// The link's own path sits inside out/; its target, `../secret.txt`, is the same file the
	// `..`-escape case above already proves the server must not serve directly.
	it('refuses a request through a symlink planted outside out/ after startup', async () => {
		const link = join(exportRoot, 'out', 'leak.txt');

		await symlink(join('..', 'secret.txt'), link);

		try {
			const answer = await get(port, '/leak.txt');

			expect(answer.status).toBe(404);
		} finally {
			await rm(link);
		}
	});

	// `out.html`, the sibling the `/`-routing test above guards, exists one directory above where
	// this link makes `/up/out.html` appear to sit.
	it('refuses a request through a symlink planted at the parent of out/ after startup', async () => {
		const link = join(exportRoot, 'out', 'up');

		await symlink('..', link);

		try {
			const answer = await get(port, '/up/out.html');

			expect(answer.status).toBe(404);
		} finally {
			await rm(link);
		}
	});

	it('answers 404 for a route with no file behind it', async () => {
		const answer = await get(port, '/no-such-route');

		expect(answer.status).toBe(404);
	});

	it('answers 400 for a path holding a malformed escape', async () => {
		const answer = await get(port, '/%zz');

		expect(answer.status).toBe(400);
	});

	it('answers 405 for a method other than GET or HEAD', async () => {
		const answer = await get(port, '/index.html', 'POST');

		expect(answer.status).toBe(405);
	});

	// The price of resolving every route at startup, written down so it stays a decision. Nothing
	// here pays it, because `playwright.config.ts` sets `reuseExistingServer: false` and the export
	// is built before the server starts.
	it('does not serve a file written after startup', async () => {
		const late = join(exportRoot, 'out', 'late.txt');

		await writeFile(late, 'written after the walk\n');

		try {
			const answer = await get(port, '/late.txt');

			expect(answer.status).toBe(404);
		} finally {
			await rm(late);
		}
	});

	// A route whose file went away is how a live server meets a path it cannot open.
	// `createReadStream(...).pipe(response)` raises that failure after the handler has returned,
	// too late for the handler's own `catch`, and an unhandled `error` event ends the process. The
	// second request is the real assertion; the 500 is what the first one gets on the way.
	it('answers 500 for a route whose file is gone, and keeps serving', async () => {
		await rm(join(exportRoot, 'out', 'doomed.txt'));

		const answer = await get(port, '/doomed.txt');

		expect(answer.status).toBe(500);

		const after = await get(port, '/styles.css');

		expect(after.status).toBe(200);
		expect(after.body).toBe('body{color:red}\n');
	});

	// Playwright starts this server itself, so a missing export has to fail here, before a browser
	// opens. Left to the request handler it would surface as a page that failed to load, which
	// sends the reader after the app instead of the build.
	it(
		'exits non-zero naming out/ when the export is missing',
		async () => {
			const root = await mkdtemp(join(tmpdir(), 'cambium-serve-out-bare-'));

			await mkdir(join(root, 'scripts'));
			await copyFile(SERVER, join(root, 'scripts', 'serve-out.mjs'));

			await expect(
				execFileAsync('node', [join(root, 'scripts', 'serve-out.mjs'), '0']),
			).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('out/ is missing') });
		},
		TIMEOUT,
	);

	it(
		'exits non-zero naming the port when the port is not a valid one',
		async () => {
			const root = await buildExport();

			await expect(
				execFileAsync('node', [join(root, 'scripts', 'serve-out.mjs'), '70000']),
			).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('70000') });
		},
		TIMEOUT,
	);

	// Holds the port with a socket of its own rather than racing a second copy of the server for
	// it, so nothing but the failure under test can turn this red. A person who hits a taken port
	// needs the number and a reason, which is why the stack frames are asserted absent. A raw node
	// stack buries both.
	it(
		'exits non-zero naming the port when the port is already taken',
		async () => {
			const root = await buildExport();
			const holder = createServer();

			await new Promise<void>((settle) => holder.listen(0, '127.0.0.1', settle));

			const taken = (holder.address() as AddressInfo).port;

			try {
				const failure = await execFileAsync('node', [
					join(root, 'scripts', 'serve-out.mjs'),
					String(taken),
				]).then(
					() => null,
					(error: { code?: number; stderr: string }) => error,
				);

				expect(failure?.code).toBe(1);
				expect(failure?.stderr).toContain(String(taken));
				expect(failure?.stderr).toContain('EADDRINUSE');
				expect(failure?.stderr).not.toMatch(/^\s+at /m);
			} finally {
				holder.close();
			}
		},
		TIMEOUT,
	);
});

// `out/` is a symlink whenever a worktree points at a shared export. Left unresolved, it makes
// every route 404 under a startup line that reads healthy.
describe('scripts/serve-out.mjs with out/ reached through a symlink', () => {
	let port: number;
	let child: ChildProcess;

	beforeAll(async () => {
		const started = await startServer(await buildLinkedExport());

		port = started.port;
		child = started.child;
	}, TIMEOUT);

	afterAll(() => {
		child.kill();
	});

	it('serves the index behind the link for /', async () => {
		const answer = await get(port, '/');

		expect(answer.status).toBe(200);
		expect(answer.body).toBe('<h1>linked index</h1>\n');
	});

	it('serves a file behind the link by its own path', async () => {
		const answer = await get(port, '/styles.css');

		expect(answer.status).toBe(200);
		expect(answer.headers['content-type']).toBe('text/css; charset=utf-8');
		expect(answer.body).toBe('body{color:blue}\n');
	});
});

// Links that exist before the walk, which is the case the walk itself has to answer. A link left
// in the manifest is a path the server will open later, whatever it points at by then.
describe('scripts/serve-out.mjs with escaping symlinks already in place', () => {
	let port: number;
	let child: ChildProcess;

	beforeAll(async () => {
		const started = await startServer(await buildExportWithLinks());

		port = started.port;
		child = started.child;
	}, TIMEOUT);

	afterAll(() => {
		child.kill();
	});

	it('refuses a file under a link pointing at /', async () => {
		const answer = await get(port, '/root/etc/hosts');

		expect(answer.status).toBe(404);
	});

	it('refuses a file under a link pointing at the parent of out/', async () => {
		const answer = await get(port, '/up/out.html');

		expect(answer.status).toBe(404);
	});

	it('refuses a link whose target sits outside out/', async () => {
		const answer = await get(port, '/leak.txt');

		expect(answer.status).toBe(404);
	});

	it('serves a link whose target sits inside out/', async () => {
		const answer = await get(port, '/alias.css');

		expect(answer.status).toBe(200);
		expect(answer.headers['content-type']).toBe('text/css; charset=utf-8');
		expect(answer.body).toBe('body{color:red}\n');
	});
});
