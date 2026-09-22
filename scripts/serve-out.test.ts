import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { type IncomingHttpHeaders, request as httpRequest } from 'node:http';
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

	await writeFile(join(root, 'out.html'), '<h1>outside the sandbox</h1>\n');
	await writeFile(join(root, 'secret.txt'), 'outside the sandbox\n');

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
 * browser gets back is what these cases are about. A fixture importing `resolveUnderOut` watches
 * that function clear `/` and learns nothing about which file the response then carries.
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

	beforeAll(async () => {
		const started = await startServer(await buildExport());

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
});
