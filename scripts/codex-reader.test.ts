import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
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
// `importOriginal` keeps every other export real: the import-graph check at the bottom of this
// file needs a real `execFileSync` to run `git ls-files`, and replacing the whole module—which
// would lose every real export, not just `spawn`—would take that away too.
vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();

	return {
		...actual,
		spawn: vi.fn<(file: string, args: string[], options?: unknown) => EventEmitter>(),
	};
});

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
// file under the three directories the plan forbids, on every run, so a new file importing any of
// `CHILD_PROCESS_SCRIPTS` below fails this the same way an existing one would. Narrowing this to a
// smaller directory set or a file allowlist would defeat the point of the check.
//
// Enumerated through `git ls-files`, not a live `readdirSync` walk. `package-scripts.test.ts` runs
// in the same `pnpm test` and plants (then deletes) canary files across app/, components/ and
// core/ while it exercises `pnpm format`'s own tree walk (docs/agents/commands.md has the
// mechanism). A directory walk that lists one of those canaries and reads it a moment later can
// lose that race outright, which is what made this suite fail ENOENT on about half of full runs.
// `git ls-files` only returns tracked (or index-staged) paths, and a real import has to be
// committed to ship anyway, so a canary that spends its whole life untracked never shows up here.
// That guard's own canaries do sit briefly in the index (one fully added, the rest
// `--intent-to-add`, so its format script can't dodge the check by reading the index instead of
// the tree), so `git ls-files` can still name one of those for the length of that window — and
// that test deletes the file before it unstages it, so a listed path can still be gone by the time
// this scan reads it. That case is skipped below, not treated as a failure.
const IMPORT_GRAPH_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every script under `scripts/` that reaches `node:child_process`, in the one place both the guard
 * below and its own "catches a real offender" tests read it from, so a script added to one list
 * can't silently miss the other.
 */
const CHILD_PROCESS_SCRIPTS = ['codex-reader', 'magick-codec', 'demo-fixture'];
const IMPORT_GRAPH_TARGETS = new Set(
	CHILD_PROCESS_SCRIPTS.map((name) => resolve(IMPORT_GRAPH_REPO_ROOT, 'scripts', name)),
);
const IMPORT_GRAPH_SCAN_DIRS = ['app', 'components', 'core'];
const IMPORT_GRAPH_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js']);
const IMPORT_GRAPH_RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];
const IMPORT_GRAPH_SPECIFIER_PATTERN =
	/\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;

/** Every tracked file under `dirs`, filtered to the extensions the specifier scan reads. */
function collectSourceFiles(dirs: string[]): string[] {
	const output = execFileSync('git', ['ls-files', '-z', '--', ...dirs], {
		cwd: IMPORT_GRAPH_REPO_ROOT,
		encoding: 'utf8',
	});

	return output
		.split('\0')
		.filter(Boolean)
		.filter((relativePath) => IMPORT_GRAPH_SOURCE_EXTENSIONS.has(extname(relativePath)))
		.map((relativePath) => resolve(IMPORT_GRAPH_REPO_ROOT, relativePath));
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

	return IMPORT_GRAPH_TARGETS.has(resolved);
}

/**
 * Read + specifier-scan for one file, isolated from how the file list was gathered. That split is
 * what lets the "catches a real offender" test below drive the actual detection logic against a
 * synthetic import with no filesystem or git involved, while the production test drives the same
 * function against `collectSourceFiles` and a real `readFileSync`. A file that vanishes between
 * being listed and being read—the shape of the canary race the comment atop this import-graph
 * scan describes—is skipped rather than failing the run: nothing this check promises to catch
 * ever exists only as a file that disappeared before anyone read it.
 */
function scanForOffenders(files: string[], readSource: (file: string) => string): string[] {
	const offenders: string[] = [];

	for (const file of files) {
		let source: string;

		try {
			source = readSource(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
			throw error;
		}

		for (const specifier of specifiersIn(source)) {
			if (resolvesToImportGraphTarget(specifier, file)) offenders.push(file);
		}
	}

	return offenders;
}

/**
 * Stands in for a `readFileSync` whose target vanished between listing and reading — the shape
 * `scanForOffenders` is asked to skip rather than fail on. Module scope rather than inline in its
 * one test: it captures nothing from its caller, so oxlint's `consistent-function-scoping` asks
 * for it up here.
 */
function throwEnoent(): never {
	const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
	error.code = 'ENOENT';
	throw error;
}

describe('import graph', () => {
	it('is never imported from app/, components/ or core/', () => {
		const files = collectSourceFiles(IMPORT_GRAPH_SCAN_DIRS);
		const offenders = scanForOffenders(files, (file) => readFileSync(file, 'utf8'));

		expect(offenders).toEqual([]);
	});

	// Proves the scan can actually fail, not just pass: a clone test can't stand in for this, because
	// `git ls-files` never lists an untracked provocation file, and making one tracked would mean
	// staging or committing a fake offender just to test a check against it. Injecting the file list
	// and its source instead exercises exactly the resolution logic `collectSourceFiles` and a real
	// `readFileSync` would run against a genuine offender, with no repo state required. Runs once per
	// `CHILD_PROCESS_SCRIPTS` entry, so adding a fourth guarded script to that list without a matching
	// specifier here fails loudly instead of shipping an unproven guard.
	it.each(CHILD_PROCESS_SCRIPTS)('is flagged for a file that imports scripts/%s', (name) => {
		const offendingFile = resolve(IMPORT_GRAPH_REPO_ROOT, 'app', 'not-a-real-file.ts');
		const offenders = scanForOffenders(
			[offendingFile],
			() => `import { anything } from '../scripts/${name}';\n`,
		);

		expect(offenders).toEqual([offendingFile]);
	});

	it('skips a listed file that vanishes before it is read, rather than failing', () => {
		const goneFile = resolve(IMPORT_GRAPH_REPO_ROOT, 'app', 'gone.ts');

		expect(scanForOffenders([goneFile], throwEnoent)).toEqual([]);
	});
});
