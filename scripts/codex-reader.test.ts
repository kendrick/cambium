import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, writeFileSync, type Dirent } from 'node:fs';
import { dirname, extname, join as pathJoin, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	SEED_JSON_SCHEMA,
	SEED_PROMPT_VERSION,
	SEED_SYSTEM_PROMPT,
	SEED_USER_DIRECTIVE,
} from '../app/readers/seed-prompt';
import type { ReferenceImage } from '../core/brand-record';
import { parseSeed } from '../core/parse-seed';
import { CODEX_MODEL_UNSPECIFIED, createCodexReader } from './codex-reader';

// `codex-reader.ts` shells out for real, so every test here replaces the module rather than
// letting a stray call reach an actual `codex` binary. Vitest hoists this call above the imports
// above, so `createCodexReader` sees the mocked `spawn` the moment its own module loads.
vi.mock('node:child_process', () => ({
	spawn: vi.fn<(file: string, args: string[], options?: unknown) => EventEmitter>(),
}));

// Cast away spawn's real return type rather than fight it: `fakeChild` below stands in for the
// whole `ChildProcess` surface the reader actually touches (`.stdout`, `.stderr`, `error`,
// `close`), and that is what every test's mockImplementation returns.
const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

/**
 * A minimal stand-in for the parts of `ChildProcess` `runCodexExec` reads: `.stdout` and
 * `.stderr` as separate emitters, plus `error`/`close` on the process itself. Real event order
 * matters here — the reader attaches its listeners synchronously right after `spawn` returns, so
 * every emit below is deferred a tick past that, the same way a real child's output arrives only
 * after the event loop turns.
 */
function fakeChild() {
	const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();

	return proc;
}

const IMAGE_A: ReferenceImage = {
	id: 'img-a',
	downscaled: 'data:image/webp;base64,AAAA',
	originalHash: 'sha256:aaa',
	tag: 'ui',
};

const IMAGE_B: ReferenceImage = {
	id: 'img-b',
	downscaled: 'data:image/jpeg;base64,QUJD',
	originalHash: 'sha256:bbb',
	tag: 'photo',
};

/** All ten `BrandSeed` fields present and null: the minimal shape `BrandSeedSchema` accepts. */
const VALID_SEED = {
	keyColors: null,
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

function argAfter(args: string[], flag: string): string {
	const index = args.indexOf(flag);

	if (index === -1 || index === args.length - 1) {
		throw new Error(`expected ${flag} in args: ${args.join(' ')}`);
	}

	return args[index + 1]!;
}

function allArgsAfter(args: string[], flag: string): string[] {
	const values: string[] = [];

	for (let i = 0; i < args.length - 1; i += 1) {
		if (args[i] === flag) values.push(args[i + 1]!);
	}

	return values;
}

afterEach(() => {
	spawnMock.mockReset();
});

describe('createCodexReader', () => {
	it('writes each image to a temp file, calls codex exec with one -i per image and --output-schema, and returns the final message as raw', async () => {
		let capturedArgs: string[] = [];
		let imagePaths: string[] = [];
		let outputPath = '';
		let schemaPath = '';

		spawnMock.mockImplementation((_file: string, args: string[]) => {
			capturedArgs = args;
			imagePaths = allArgsAfter(args, '-i');
			schemaPath = argAfter(args, '--output-schema');
			outputPath = argAfter(args, '-o');

			// The attachments exist, with the bytes their data URLs decoded to, before codex "runs" —
			// this is what proves the reader wrote real files rather than just naming paths in argv.
			expect(readFileSync(imagePaths[0]!)).toEqual(Buffer.from('AAAA', 'base64'));
			expect(readFileSync(imagePaths[1]!)).toEqual(Buffer.from('QUJD', 'base64'));
			expect(JSON.parse(readFileSync(schemaPath, 'utf8'))).toEqual(SEED_JSON_SCHEMA);

			writeFileSync(outputPath, JSON.stringify(VALID_SEED));

			const proc = fakeChild();

			queueMicrotask(() => {
				proc.stdout.emit(
					'data',
					Buffer.from(
						'{"type":"thread.started","thread_id":"thread-abc"}\n{"type":"turn.completed"}\n',
					),
				);
				proc.emit('close', 0);
			});

			return proc;
		});

		const reader = createCodexReader();
		const response = await reader.read([IMAGE_A, IMAGE_B], { auth: null });

		expect(capturedArgs.slice(0, 2)).toEqual(['exec', '--json']);
		expect(imagePaths).toHaveLength(2);
		expect(response).toEqual({
			raw: JSON.stringify(VALID_SEED),
			provider: 'codex',
			model: CODEX_MODEL_UNSPECIFIED,
			promptVersion: SEED_PROMPT_VERSION,
			requestId: 'thread-abc',
		});

		const prompt = capturedArgs.at(-1)!;

		expect(prompt.startsWith(SEED_SYSTEM_PROMPT)).toBe(true);
		expect(prompt.indexOf('Image id: img-a')).toBeGreaterThan(-1);
		expect(prompt.indexOf('Image id: img-a')).toBeLessThan(prompt.indexOf('Image id: img-b'));
		expect(prompt.indexOf('Image id: img-b')).toBeLessThan(prompt.indexOf(SEED_USER_DIRECTIVE));

		// Nothing this run wrote survives a successful call.
		expect(existsSync(imagePaths[0]!)).toBe(false);
		expect(existsSync(imagePaths[1]!)).toBe(false);
		expect(existsSync(schemaPath)).toBe(false);
		expect(existsSync(outputPath)).toBe(false);
	});

	it('passes a configured model to -m and records it as the model that answered', async () => {
		let capturedArgs: string[] = [];

		spawnMock.mockImplementation((_file: string, args: string[]) => {
			capturedArgs = args;
			writeFileSync(argAfter(args, '-o'), JSON.stringify(VALID_SEED));

			const proc = fakeChild();

			queueMicrotask(() => {
				proc.stdout.emit(
					'data',
					Buffer.from('{"type":"thread.started","thread_id":"thread-model"}\n'),
				);
				proc.emit('close', 0);
			});

			return proc;
		});

		const reader = createCodexReader({ model: 'gpt-5.6-terra' });
		const response = await reader.read([IMAGE_A], { auth: null });

		expect(argAfter(capturedArgs, '-m')).toBe('gpt-5.6-terra');
		expect(response.model).toBe('gpt-5.6-terra');
	});

	it('rejects with codex stderr in the message on a non-zero exit, and still removes its temp files', async () => {
		let imagePaths: string[] = [];
		let schemaPath = '';

		spawnMock.mockImplementation((_file: string, args: string[]) => {
			imagePaths = allArgsAfter(args, '-i');
			schemaPath = argAfter(args, '--output-schema');

			const proc = fakeChild();

			queueMicrotask(() => {
				proc.stderr.emit('data', Buffer.from('model "bogus" is not recognised'));
				proc.emit('close', 1);
			});

			return proc;
		});

		const reader = createCodexReader();

		await expect(reader.read([IMAGE_A], { auth: null })).rejects.toThrow(
			/model "bogus" is not recognised/,
		);

		expect(existsSync(imagePaths[0]!)).toBe(false);
		expect(existsSync(schemaPath)).toBe(false);
	});

	it('rejects when codex exits 0 but writes no final message, naming stderr, and still cleans up', async () => {
		let imagePaths: string[] = [];

		spawnMock.mockImplementation((_file: string, args: string[]) => {
			imagePaths = allArgsAfter(args, '-i');
			// No write to the -o path: a turn can complete with no agent_message item, and that is
			// exactly as unusable to this reader as a hard failure.
			const proc = fakeChild();

			queueMicrotask(() => {
				proc.stdout.emit('data', Buffer.from('{"type":"turn.completed"}\n'));
				proc.stderr.emit('data', Buffer.from('no reasoning tokens produced'));
				proc.emit('close', 0);
			});

			return proc;
		});

		const reader = createCodexReader();

		await expect(reader.read([IMAGE_A], { auth: null })).rejects.toThrow(
			/no reasoning tokens produced/,
		);

		expect(existsSync(imagePaths[0]!)).toBe(false);
	});

	it('produces a response parseSeed accepts, for a recorded codex final message', async () => {
		spawnMock.mockImplementation((_file: string, args: string[]) => {
			writeFileSync(argAfter(args, '-o'), JSON.stringify(VALID_SEED));

			const proc = fakeChild();

			queueMicrotask(() => {
				proc.stdout.emit(
					'data',
					Buffer.from('{"type":"thread.started","thread_id":"thread-parse"}\n'),
				);
				proc.emit('close', 0);
			});

			return proc;
		});

		const reader = createCodexReader();
		const response = await reader.read([IMAGE_A], { auth: null });
		const result = parseSeed(response);

		expect(result.ok).toBe(true);
	});
});

// A static import-graph scan, not a check against a fixed list of files: it walks every source
// file under the three directories the plan forbids, on every run, so a new file importing
// scripts/codex-reader.ts fails this the same way an existing one would. Narrowing this to a
// smaller directory set or a file allowlist would defeat the point of the check.
const IMPORT_GRAPH_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_GRAPH_TARGET = resolve(IMPORT_GRAPH_REPO_ROOT, 'scripts', 'codex-reader');
const IMPORT_GRAPH_SCAN_DIRS = ['app', 'components', 'core'];
const IMPORT_GRAPH_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const IMPORT_GRAPH_RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];
const IMPORT_GRAPH_SPECIFIER_PATTERN =
	/\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;

function readDirEntries(dir: string): Dirent[] {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function collectSourceFiles(dir: string): string[] {
	const files: string[] = [];

	for (const entry of readDirEntries(dir)) {
		if (entry.name === 'node_modules' || entry.name === '.next') continue;

		const full = pathJoin(dir, entry.name);

		if (entry.isDirectory()) {
			files.push(...collectSourceFiles(full));
		} else if (IMPORT_GRAPH_SOURCE_EXTENSIONS.has(extname(entry.name))) {
			files.push(full);
		}
	}

	return files;
}

function specifiersIn(source: string): string[] {
	const specifiers: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = IMPORT_GRAPH_SPECIFIER_PATTERN.exec(source))) {
		const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];

		if (specifier) specifiers.push(specifier);
	}

	return specifiers;
}

function resolvesToImportGraphTarget(specifier: string, fromFile: string): boolean {
	let resolved: string;

	if (specifier.startsWith('.')) {
		resolved = resolve(dirname(fromFile), specifier);
	} else if (specifier.startsWith('@/')) {
		resolved = resolve(IMPORT_GRAPH_REPO_ROOT, specifier.slice(2));
	} else {
		return false;
	}

	for (const ext of IMPORT_GRAPH_RESOLVABLE_EXTENSIONS) {
		if (resolved.endsWith(ext)) {
			resolved = resolved.slice(0, -ext.length);
			break;
		}
	}

	return resolved === IMPORT_GRAPH_TARGET;
}

describe('import graph', () => {
	it('is never imported from app/, components/ or core/', () => {
		const offenders: string[] = [];

		for (const dir of IMPORT_GRAPH_SCAN_DIRS) {
			for (const file of collectSourceFiles(resolve(IMPORT_GRAPH_REPO_ROOT, dir))) {
				const source = readFileSync(file, 'utf8');

				for (const specifier of specifiersIn(source)) {
					if (resolvesToImportGraphTarget(specifier, file)) offenders.push(file);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
