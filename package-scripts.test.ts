import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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

// Spacing alone, so the formatted result stays stable across oxfmt versions and the assertions
// below keep meaning "oxfmt rewrote this file" rather than "oxfmt still indents the way it did".
// The comment rides along so a file left behind by a killed run explains itself.
const NOTE = '// Temporary fixture from package-scripts.test.ts. Safe to delete.';
const MESSY = `${NOTE}\nconst   x   =   {a:1,  b:2};\nexport { x };\n`;
const TIDY = `${NOTE}\nconst x = { a: 1, b: 2 };\nexport { x };\n`;

async function runScript(script: string, target?: string): Promise<string> {
	const args = target ? [script, target] : [script];

	try {
		const { stdout } = await run('pnpm', args, { cwd: ROOT });

		return stdout;
	} catch (error) {
		// A non-zero exit means some file in the tree needs formatting, which is a different
		// failure from the one under test, and it is the expected state while canaries are planted.
		// oxfmt prints its report either way, so read it off the error and let the assertions
		// answer on their own.
		const failure = error as { stdout?: string };
		if (typeof failure.stdout !== 'string') throw error;

		return failure.stdout;
	}
}

function filesTouched(stdout: string): number {
	const match = FILE_COUNT.exec(stdout);

	// Throw rather than return 0 or null. A parser that shrugs on a miss turns "the script
	// swallowed the path argument" into a passing assertion, which is the failure this file exists
	// to catch.
	if (!match) throw new Error(`oxfmt printed no file count:\n${stdout}`);

	return Number(match[1]);
}

/**
 * Directories git ignores, which is the set oxfmt declines to walk. Asked rather than hardcoded:
 * a list in this file goes stale the moment `.gitignore` grows an entry, and the failure that
 * follows is a canary nothing can reach.
 */
async function ignoredDirectories(candidates: string[]): Promise<Set<string>> {
	try {
		const { stdout } = await run('git', ['check-ignore', ...candidates], { cwd: ROOT });

		return new Set(stdout.split('\n').filter(Boolean));
	} catch (error) {
		// `git check-ignore` exits 1 when it matched nothing, which is an answer, not a failure.
		const failure = error as { code?: number; stdout?: string };
		if (failure.code !== 1 || typeof failure.stdout !== 'string') throw error;

		return new Set(failure.stdout.split('\n').filter(Boolean));
	}
}

/** Every place inside the repo a tree-wide write can land: the root, and each directory below it. */
async function walkedDirectories(): Promise<string[]> {
	const entries = await readdir(ROOT, { withFileTypes: true });
	const candidates = entries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
		.map((entry) => join(ROOT, entry.name));
	const ignored = await ignoredDirectories(candidates);

	return [ROOT, ...candidates.filter((directory) => !ignored.has(directory))];
}

/**
 * Plants one canary in `directory` and hands back its path. The name is random because a fixed one
 * can be excluded: `oxfmt --write . '!**\/format-canary-*\/**'` rewrites the tree and steps around
 * any canary whose path a script can predict. A plain file rather than a directory, so a peer's
 * canary never looks like somewhere this run should plant.
 */
async function plantCanary(directory: string): Promise<string> {
	const canary = join(directory, `${randomUUID().replaceAll('-', '').slice(0, 12)}.ts`);

	await writeFile(canary, MESSY);

	return canary;
}

// The value under test is a script string in package.json, but what reads it next is pnpm's runner
// and then oxfmt, both outside this repo. So every case here spawns the real command: a test that
// read package.json and grepped for a trailing `.` would pass just as happily against a runner
// that dropped the argument on the floor.
describe('pnpm format', () => {
	// The file count oxfmt prints is the producer describing itself, and it cannot see a second
	// write hidden earlier in the script string. What a peer loses an edit in is the working tree,
	// so the tree is what this reads.
	//
	// One canary is only evidence about the directory holding it. A script that enumerates source
	// directories instead of passing `.` rewrites everything a peer owns while never walking past a
	// canary parked somewhere else, which is how an earlier version of this guard was defeated. So
	// there is one canary in every directory oxfmt walks, each under a random name.
	//
	// That leaves one way through, and it closes itself. A write can still dodge every canary by
	// excluding `.ts` wholesale, but then `pnpm format` stops formatting the 100 TypeScript files
	// this repo is mostly made of, and the next `pnpm format:check` says so. Any exclusion narrow
	// enough to keep `format` working has to name paths it cannot predict.
	it(
		'writes only the file it was handed',
		async () => {
			// Collected as they are created, so a throw part way through still cleans up the rest.
			const scratch: string[] = [];
			const canaries: string[] = [];

			try {
				const outside = await mkdtemp(join(tmpdir(), 'cambium-format-'));
				const target = join(outside, 'messy.ts');

				scratch.push(outside);
				await writeFile(target, MESSY);

				for (const directory of await walkedDirectories()) {
					canaries.push(await plantCanary(directory));
				}

				// Each canary counts only if the tree walk reaches it. Naming a path on the command
				// line proves nothing, because oxfmt formats a file it is handed even when
				// `.gitignore` covers it, so an ignored canary would sit unformatted and pass for
				// the wrong reason. Ask the walk instead: this is the one a bare write performs.
				const walk = await runScript('format:check');

				for (const canary of canaries) {
					expect(walk).toContain(relative(ROOT, canary));
				}

				expect(filesTouched(await runScript('format', target))).toBe(1);
				expect(await readFile(target, 'utf8')).toBe(TIDY);

				for (const canary of canaries) {
					expect(await readFile(canary, 'utf8')).toBe(MESSY);
				}
			} finally {
				// Only what this test planted. A leftover is still mis-formatted in every case
				// except one, so it fails `pnpm format:check` on the next call rather than lurking.
				// The exception is a run killed after a tree-wide write already tidied the
				// canaries, and that can only happen while `format` is broken, which the next run
				// of this test reports anyway.
				await Promise.all([
					...scratch.map((dir) => rm(dir, { recursive: true, force: true })),
					...canaries.map((canary) => rm(canary, { force: true })),
				]);
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
			expect(filesTouched(await runScript('format:check', import.meta.filename))).toBe(1);
		},
		TIMEOUT,
	);

	// Loose because the tree keeps growing. oxfmt defaults to the working directory on its own, so
	// neither bare form needs a path argument to reach everything. This stands in for the same
	// claim about bare `format`, which no test may run: a tree-wide write is the thing AGENTS.md
	// forbids a dispatched task to do, and a test run is no better placed to do it.
	it(
		'still covers the tree when called bare',
		async () => {
			expect(filesTouched(await runScript('format:check'))).toBeGreaterThan(100);
		},
		TIMEOUT,
	);
});
