import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WEBP_QUALITY, type DecodedImage, type ImageCodec } from '../lib/image-intake';

const MAGICK_BIN = 'magick';

/**
 * ImageMagick's `-quality` is an integer 0-100; `WEBP_QUALITY` in `lib/image-intake.ts` is the 0-1
 * ratio the browser encoder already takes. Scaling it here, rather than declaring a second
 * constant, is what keeps this codec asking for the same declared quality the browser one would for
 * the same seed image—not the same pixels, since different WebP encoders at an identical quality
 * setting don't produce identical bytes.
 */
const MAGICK_QUALITY = Math.round(WEBP_QUALITY * 100);

/**
 * Carries magick's own stderr the way `CodexExecError` does in `scripts/codex-reader.ts`, so a
 * caller several layers up (the demo-fixture CLI) can print what actually went wrong instead of a
 * bare "Command failed". `spawn`'s `error` event fires with no exit code and no stderr at all when
 * the binary itself is missing, which is why `exitCode` is nullable here rather than always a
 * number.
 */
export class MagickExecError extends Error {
	readonly stderr: string;
	readonly exitCode: string | number | null;

	constructor(
		message: string,
		stderr: string,
		exitCode: string | number | null,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = 'MagickExecError';
		this.stderr = stderr;
		this.exitCode = exitCode;
	}
}

/**
 * Runs one `magick` invocation and hands back its stdout, or rejects with a `MagickExecError`
 * naming the binary outright when it isn't on PATH at all, the one failure a caller has to tell
 * apart from every other kind of bad exit.
 *
 * `stdio: ['ignore', ...]` closes stdin the same way `runCodexExec` does in
 * `scripts/codex-reader.ts`: neither call this codec makes ever reads from it, and leaving the
 * pipe open only risks a hang if some future `magick` build ever decided to.
 */
function runMagick(args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(MAGICK_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });

		let stdout = '';
		let stderr = '';

		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});

		child.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') {
				reject(
					new MagickExecError(
						`magick is not installed, or not on PATH (${error.message})`,
						stderr,
						null,
						{ cause: error },
					),
				);
				return;
			}

			reject(new MagickExecError(error.message, stderr, null, { cause: error }));
		});

		child.on('close', (code) => {
			if (code !== 0) {
				reject(
					new MagickExecError(
						`magick exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
						stderr,
						code,
					),
				);
				return;
			}

			resolve({ stdout, stderr });
		});
	});
}

async function writeTempFile(dir: string, name: string, blob: Blob): Promise<string> {
	const path = join(dir, name);

	await writeFile(path, Buffer.from(await blob.arrayBuffer()));

	return path;
}

/**
 * Shells out to `magick` for both halves of `ImageCodec` that `lib/image-intake.ts` needs from a
 * caller running outside a browser: `decode` for width and height, `encode` for the resized WebP.
 * That is what puts a demo fixture's downscaled data URL, `MAX_EDGE_PX` fit and `originalHash`
 * through the same pipeline the landing form runs, per #18's plan, rather than a second
 * implementation that could drift from it.
 *
 * Every call writes its input to a temp file rather than piping bytes over stdin: `identify`
 * takes no `-resize`, so reading the actual pixels this codec produced needs `magick <file>
 * -format ... info:` either way, and a single code path for both the plain-decode and
 * resize-then-measure cases is simpler than branching between a file and a pipe.
 */
export function createMagickCodec(): ImageCodec {
	return {
		async decode(blob, resize): Promise<DecodedImage> {
			const dir = await mkdtemp(join(tmpdir(), 'cambium-magick-'));

			try {
				const input = await writeTempFile(dir, 'input', blob);
				const args = resize
					? [input, '-resize', `${resize.width}x${resize.height}!`, '-format', '%w %h', 'info:']
					: [input, '-format', '%w %h', 'info:'];

				const { stdout } = await runMagick(args);
				const [width, height] = stdout.trim().split(/\s+/).map(Number);

				return { width, height, close() {} };
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},

		async encode(source, size): Promise<Blob> {
			const dir = await mkdtemp(join(tmpdir(), 'cambium-magick-'));

			try {
				const input = await writeTempFile(dir, 'input', source);
				const output = join(dir, 'output.webp');

				await runMagick([
					input,
					'-resize',
					`${size.width}x${size.height}!`,
					'-quality',
					String(MAGICK_QUALITY),
					output,
				]);

				return new Blob([await readFile(output)], { type: 'image/webp' });
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	};
}
