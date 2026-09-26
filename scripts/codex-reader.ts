import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	SEED_JSON_SCHEMA,
	SEED_PROMPT_VERSION,
	SEED_SYSTEM_PROMPT,
	SEED_USER_DIRECTIVE,
} from '../app/readers/seed-prompt';
import type { BrandReader, ReadOptions } from '../core/brand-reader';
import type { ReferenceImage } from '../core/brand-record';

export const CODEX_PROVIDER = 'codex';

/**
 * `codex exec --json` on 0.156.0 never names the model that actually answered a request: every
 * event type a live run has been observed to emit (`thread.started`, `turn.started`,
 * `item.completed`, `turn.completed`, and the `error`/`turn.failed` pair on a rejected request)
 * carries no model field. Reading it off `~/.codex/config.toml` instead would make a stored
 * record's `model` depend on a file the record never travels with, so a caller that wants a
 * reproducible field has to pass `model` explicitly. This is what a caller who didn't gets
 * instead, so the record says "unspecified" rather than quietly guessing.
 */
export const CODEX_MODEL_UNSPECIFIED = 'codex-default (unspecified)';

const CODEX_BIN = 'codex';

const IMAGE_EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
};

export type CodexReaderConfig = {
	/**
	 * Passed straight through to `codex exec -m`. Left out, codex answers with whatever
	 * `~/.codex/config.toml` names on the machine running this script, and the returned record's
	 * `model` field falls back to `CODEX_MODEL_UNSPECIFIED` rather than guessing which one that was.
	 */
	model?: string;
};

/**
 * Carries the pieces `read` needs to turn a non-zero exit or an empty final message into a
 * message with codex's own stderr inside it, rather than a bare "Command failed" that names
 * nothing about why.
 */
class CodexExecError extends Error {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: string | number | null;

	constructor(message: string, stdout: string, stderr: string, exitCode: string | number | null) {
		super(message);
		this.stdout = stdout;
		this.stderr = stderr;
		this.exitCode = exitCode;
	}
}

/**
 * `ReferenceImage.downscaled` stores the exact data URL a model was sent, header included (see
 * the identical split in `app/readers/anthropic-request.ts`). `codex exec` takes a file rather
 * than inline bytes, so this reader has to reverse that split before it can write anything to
 * disk, and it names the offending image's id when the header is missing or unrecognised, the
 * same way the Anthropic path does.
 */
function parseDataUrl(image: ReferenceImage): { mediaType: string; data: string } {
	const match = /^data:([^;,]+);base64,(.+)$/s.exec(image.downscaled);

	if (!match) {
		throw new Error(`reference image "${image.id}" is not a base64 image data URL`);
	}

	const [, mediaType, data] = match;

	return { mediaType, data };
}

function extensionFor(image: ReferenceImage, mediaType: string): string {
	const extension = IMAGE_EXTENSIONS[mediaType];

	if (!extension) {
		throw new Error(
			`reference image "${image.id}" has media type "${mediaType}", which codex exec does not accept as an image`,
		);
	}

	return extension;
}

/**
 * Mirrors the ordering `buildContent` in `app/readers/anthropic-request.ts` uses: each image
 * preceded by its id, so a model reading `keyColors.sourceImageId` or
 * `imageClassifications.imageId` back against the attachments has something to point at. A
 * Messages API content array can interleave an id line directly ahead of its image block;
 * `codex exec`'s `-i` attachments are a separate channel from the prompt text, so the closest
 * this reader can get is listing the id lines in the same order the `-i` flags attach the
 * images, immediately ahead of the shared user directive.
 */
function buildPrompt(images: ReferenceImage[]): string {
	const idLines = images.map((image) => `Image id: ${image.id}`).join('\n');

	return [SEED_SYSTEM_PROMPT, idLines, SEED_USER_DIRECTIVE].join('\n\n');
}

/**
 * Runs one `codex exec` invocation and hands back its full stdout and stderr either way, so the
 * caller can read `--json` events on success and codex's own diagnostic on failure.
 *
 * `spawn` rather than `execFile`, because `stdio` isn't among the options `execFile` accepts
 * (Node's own `ExecFileOptions` has no such field) even though it takes the same shape `spawn`
 * does. `stdio: ['ignore', ...]` is the programmatic form of `< /dev/null`: `codex exec` treats a
 * stdin that isn't a TTY as a second input stream and blocks reading it until EOF arrives, and
 * `execFile`'s own default pipe never sends one, so an unconfigured stdin would hang the whole
 * script instead of running the request.
 */
function runCodexExec(args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(CODEX_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });

		let stdout = '';
		let stderr = '';

		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});

		child.on('error', (error) => {
			reject(new CodexExecError(error.message, stdout, stderr, null));
		});

		child.on('close', (code) => {
			if (code !== 0) {
				reject(new CodexExecError(`codex exec exited with code ${code}`, stdout, stderr, code));
				return;
			}

			resolve({ stdout, stderr });
		});
	});
}

/**
 * The one field `--json` reliably carries that this reader can put to use: `thread.started`'s
 * `thread_id`, codex's own id for the run. It fills `RawReaderResponse.requestId` the way a
 * provider-issued request id would for a reader talking to an HTTP API directly.
 */
function extractThreadId(stdout: string): string | undefined {
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();

		if (!trimmed) continue;

		try {
			const event = JSON.parse(trimmed) as { type?: string; thread_id?: string };

			if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
				return event.thread_id;
			}
		} catch {
			// codex has printed a bare status line to stdout before ("Reading additional input from
			// stdin..." showed up on stderr on this machine, but the boundary between the two streams
			// isn't a documented contract); a line that isn't JSON just isn't the event being looked
			// for, not this reader's problem to diagnose.
		}
	}

	return undefined;
}

/**
 * `codex exec`, run against an already-authenticated CLI rather than an API key: `ReadOptions.auth`
 * is ignored the way it is in `app/readers/local-reader.ts`, for the same reason.
 * `core/brand-reader.ts` makes an absent provider first-class exactly so a reader like this one
 * never has to invent an auth shape it doesn't use.
 *
 * Lives in `scripts/`, not `app/readers/`: it shells out through `node:child_process`, which must
 * never reach the browser bundle, so nothing under `app/`, `components/` or `core/` may import
 * this file (checked below).
 */
export function createCodexReader(config: CodexReaderConfig = {}) {
	const reader = {
		async read(images: ReferenceImage[], _options: ReadOptions) {
			const tmpDir = await mkdtemp(join(tmpdir(), 'cambium-codex-'));

			try {
				const schemaPath = join(tmpDir, 'schema.json');
				const outputPath = join(tmpDir, 'output.txt');

				await writeFile(schemaPath, JSON.stringify(SEED_JSON_SCHEMA));

				// Every image writes independently, so Promise.all rather than a sequential loop: the
				// index in each temp filename is stable per image regardless of write order, and
				// there's nothing here for one image's write to depend on another's.
				const imagePaths = await Promise.all(
					images.map(async (image, index) => {
						const { mediaType, data } = parseDataUrl(image);
						const extension = extensionFor(image, mediaType);
						const imagePath = join(tmpDir, `image-${index}.${extension}`);

						await writeFile(imagePath, Buffer.from(data, 'base64'));

						return imagePath;
					}),
				);
				const imageArgs = imagePaths.flatMap((imagePath) => ['-i', imagePath]);

				const args = [
					'exec',
					'--json',
					...imageArgs,
					'--output-schema',
					schemaPath,
					'-o',
					outputPath,
					...(config.model ? ['-m', config.model] : []),
					buildPrompt(images),
				];

				let stdout: string;
				let stderr: string;

				try {
					({ stdout, stderr } = await runCodexExec(args));
				} catch (error) {
					if (error instanceof CodexExecError) {
						const detail = error.stderr.trim();

						throw new Error(
							`codex exec failed (exit ${error.exitCode ?? 'unknown'}): ${detail || error.message}`,
							{ cause: error },
						);
					}

					throw error;
				}

				const raw = await readFile(outputPath, 'utf8').catch(() => '');

				if (raw.trim().length === 0) {
					throw new Error(
						`codex exec produced no final message${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
					);
				}

				return {
					raw,
					provider: CODEX_PROVIDER,
					model: config.model ?? CODEX_MODEL_UNSPECIFIED,
					promptVersion: SEED_PROMPT_VERSION,
					requestId: extractThreadId(stdout),
				};
			} finally {
				await rm(tmpDir, { recursive: true, force: true });
			}
		},
	} satisfies BrandReader;

	return reader;
}
