import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

// This file sits at the repo root, so its own directory is the root oxfmt falls back to.
const ROOT = import.meta.dirname;

// oxfmt reports what it touched in exactly one place: `Finished in 16ms on 147 files using 14
// threads`, on stdout. Nothing else in the output tells a one-file run from a whole-tree one.
const FILE_COUNT = /Finished in .+ on (\d+) files/;

// Each test spawns pnpm, which pays its own startup before oxfmt runs at all. That fits inside
// Vitest's 5s default on a warm local checkout and has no margin left on a cold or loaded one.
const TIMEOUT = 30_000;

// Spacing alone, so the formatted result stays stable across oxfmt versions and the assertion
// below keeps meaning "oxfmt rewrote this file" rather than "oxfmt still indents the way it did".
const MESSY = 'const   x   =   {a:1,  b:2};\nexport { x };\n';
const TIDY = 'const x = { a: 1, b: 2 };\nexport { x };\n';

async function filesTouched(script: string, target?: string): Promise<number> {
	const args = target ? [script, target] : [script];
	let stdout: string;

	try {
		({ stdout } = await run('pnpm', args, { cwd: ROOT }));
	} catch (error) {
		// A non-zero exit means the tree needs formatting, which is a different failure from the
		// one under test. oxfmt prints its count either way, so read it off the error and let the
		// count assertion answer on its own.
		const failure = error as { stdout?: string };
		if (typeof failure.stdout !== 'string') throw error;
		stdout = failure.stdout;
	}

	const match = FILE_COUNT.exec(stdout);

	// Throw rather than return 0 or null. A parser that shrugs on a miss turns "the script
	// swallowed the path argument" into a passing assertion, which is the failure this file exists
	// to catch.
	if (!match) throw new Error(`oxfmt printed no file count:\n${stdout}`);

	return Number(match[1]);
}

// The value under test is a script string in package.json, but what reads it next is pnpm's runner
// and then oxfmt, both outside this repo. So every case here spawns the real command: a test that
// read package.json and grepped for a trailing `.` would pass just as happily against a runner
// that dropped the argument on the floor.
describe('pnpm format', () => {
	// The target is a temp file outside the repo, because this is the writing form. Should the
	// scoping regress, oxfmt rewrites the tree before this assertion gets a chance to fail. Every
	// test runs against an already-formatted tree and oxfmt is idempotent, so that costs a no-op
	// pass rather than a lost edit.
	it(
		'writes only the file it was handed',
		async () => {
			const dir = await mkdtemp(join(tmpdir(), 'cambium-format-'));
			const target = join(dir, 'messy.ts');

			try {
				await writeFile(target, MESSY);

				expect(await filesTouched('format', target)).toBe(1);
				expect(await readFile(target, 'utf8')).toBe(TIDY);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
		TIMEOUT,
	);
});

describe('pnpm format:check', () => {
	// This file is its own fixture. It is a root-level `.ts`, which is what oxfmt formats, and it
	// cannot go missing while the test naming it still exists.
	it(
		'checks only the file it was handed',
		async () => {
			expect(await filesTouched('format:check', import.meta.filename)).toBe(1);
		},
		TIMEOUT,
	);

	// Loose because the tree keeps growing. oxfmt defaults to the working directory on its own, so
	// neither bare form needs a path argument to reach everything. This stands in for the same
	// claim about bare `format`, which no test may run: a tree-wide write is the thing AGENTS.md
	// forbids a dispatched task to do, and a test suite is in no better position to do it.
	it(
		'still covers the tree when called bare',
		async () => {
			expect(await filesTouched('format:check')).toBeGreaterThan(100);
		},
		TIMEOUT,
	);
});
