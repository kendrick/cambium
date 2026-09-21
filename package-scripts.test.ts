import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

// This file sits at the repo root, so its own directory is the root oxfmt falls back to.
const ROOT = import.meta.dirname;

// oxfmt totals what it touched in exactly one place: `Finished in 16ms on 147 files using 14
// threads`, on stdout. Under `--check` it also lists every file that needs formatting, which is
// what the reachability assertion reads.
const FILE_COUNT = /Finished in .+ on (\d+) files/;

// Every test spawns pnpm, which pays its own startup before oxfmt runs at all. The first one spawns
// it twice and git another half dozen times, and writes a fixture into every directory in the repo.
// That fits inside Vitest's 5s default on a warm local checkout and has no margin left on a cold or
// loaded one.
const TIMEOUT = 30_000;

// The marker rides along so a file left behind by a killed run explains itself, and the sweep below
// matches on this sentence rather than on a filename, because a fixture keeps its comment even after
// something has formatted it.
const NOTE = 'Temporary fixture from package-scripts.test.ts. Safe to delete.';

const CODE = `// ${NOTE}\nconst   x   =   {a:1,  b:2};\nexport { x };\n`;
const DATA = `{"_note": "${NOTE}",   "a":1,  "b":2}\n`;
const STYLE = `/* ${NOTE} */\na{color:red;background:blue}\n`;
const CONFIG = `# ${NOTE}\nkey:   value\n`;
const MARKUP = `<!-- ${NOTE} -->\n<p   class="x"  >hi</p>\n`;
const COMPONENT = `<!-- ${NOTE} -->\n<script>\nconst   x   =   {a:1,  b:2};\n</script>\n`;
const PROSE = `{/* ${NOTE} */}\n\nconst   x   =   {a:1,  b:2};\n`;

/**
 * One deliberately mis-formatted fixture per extension oxfmt rewrites, each carrying `NOTE` in that
 * extension's own comment syntax. JSON has no comments, so the marker rides in a key.
 *
 * Spacing alone, so the formatted result stays stable across oxfmt versions and the assertions keep
 * meaning "oxfmt rewrote this file" rather than "oxfmt still indents the way it did".
 *
 * The set is what oxfmt rewrites, not what this repo happens to hold today. That distinction cost a
 * round of review: an earlier version listed the six extensions the tree already used, which left a
 * peer's in-progress `.js` or `.scss` file with no canary sharing its extension. Each entry here was
 * confirmed by writing exactly this content to a scratch file and running `oxfmt --write` over it,
 * because an entry oxfmt cannot parse is never rewritten and would pass every assertion below for
 * the wrong reason.
 *
 * `.md` is the one oxfmt rewrites that is deliberately absent: `.oxfmtrc.json` ignores markdown, so
 * a `.md` canary would sit unformatted whatever the script did. `.mdx` is not covered by that ignore
 * rule and stays in. A file in the tree whose extension is missing here fails the coverage test
 * below rather than going quiet; an extension a future oxfmt *gains* is the gap neither can see, so
 * re-run the scratch probe when the formatter is upgraded.
 */
const MESSY: Record<string, string> = {
	'.ts': CODE,
	'.tsx': CODE,
	'.mts': CODE,
	'.cts': CODE,
	'.js': CODE,
	'.jsx': CODE,
	'.mjs': CODE,
	'.cjs': CODE,
	'.json': DATA,
	'.jsonc': DATA,
	'.json5': DATA,
	'.css': STYLE,
	'.less': STYLE,
	'.scss': STYLE,
	'.yml': CONFIG,
	'.yaml': CONFIG,
	'.html': MARKUP,
	'.vue': COMPONENT,
	'.mdx': PROSE,
};

// Extensions this repo tracks that oxfmt leaves alone, so they need no canary and their absence from
// `MESSY` is a decision rather than an oversight. Markdown is here because `.oxfmtrc.json` ignores
// it; the rest are not code. Anything tracked and outside both lists fails the coverage test below.
const UNFORMATTED = ['.md', '.png'];

const EXTENSIONS = Object.keys(MESSY);

// The one fixture this suite expects oxfmt to rewrite, so the only one needing a formatted
// counterpart. It goes to a temp directory outside the repo and is what the scoped run is handed.
const TIDY = `// ${NOTE}\nconst x = { a: 1, b: 2 };\nexport { x };\n`;

// The shape of a canary filename, and the only shape the sweep will touch. Nobody names a file this
// way by hand, which is the point: content alone is too loose a test, and a sweep that trusted it
// deleted a copy of this very suite that a mutation run was using as its control. The same
// predictability is escape 1 in the list further down, and the two cannot both be fixed.
//
// Digits belong in the extension class. Without them this read `[a-z]+`, which matches `.jsonc` and
// not `.json5`, so every `.json5` stray was invisible to the sweep at any age and survived every
// later run. A killed run left fourteen of them, `pnpm format:check` stayed red on files nobody
// could find by rerunning the suite, and `pnpm format` then tidied them into silent litter. The
// test below is what keeps this pattern and `MESSY` agreeing, because eyeballing two lists is how
// they came apart in the first place.
const CANARY_NAME = /^[0-9a-f]{12}\.[a-z0-9]+$/;

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

async function git(args: string[]): Promise<string> {
	const { stdout } = await run('git', args, { cwd: ROOT });

	return stdout;
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
 *
 * `core.excludesFile` is switched off for the question, because git and oxfmt disagree about it. Git
 * consults the user's global excludes and oxfmt reads only the ignore files inside the tree, so left
 * on, somebody's personal rule prunes a directory from this walk that oxfmt still rewrites, and the
 * hole belongs to one machine and is invisible on every other. Not hypothetical: the global file on
 * the machine this was written on ignores `tmp`, and `pnpm format:check` reports `tmp/probe.ts` all
 * the same. `.git/info/exclude` is the same divergence with no equivalent switch, so it stays open.
 */
async function ignoredDirectories(candidates: string[]): Promise<Set<string>> {
	try {
		const stdout = await git(['-c', 'core.excludesFile=/dev/null', 'check-ignore', ...candidates]);

		return new Set(stdout.split('\n').filter(Boolean));
	} catch (error) {
		// `git check-ignore` exits 1 when it matched nothing, which is an answer, not a failure.
		const failure = error as { code?: number; stdout?: string };
		if (failure.code !== 1 || typeof failure.stdout !== 'string') throw error;

		return new Set(failure.stdout.split('\n').filter(Boolean));
	}
}

/**
 * The subdirectories of `parent`, minus `.git`. Dot-prefixed names stay in otherwise, because oxfmt
 * walks them: a mis-formatted file under `.github` is reported like any other. `.git` has to be
 * named here because `git check-ignore` does not report git's own directory as ignored.
 */
async function childDirectories(parent: string): Promise<string[]> {
	const entries = await readdir(parent, { withFileTypes: true });

	return entries
		.filter((entry) => entry.isDirectory() && entry.name !== '.git')
		.map((entry) => join(parent, entry.name));
}

/**
 * Every place inside the repo a tree-wide write can land: the root, and every directory under it at
 * any depth. A write scoped to a nested path, `oxfmt --write app/readers` say, rewrites everything
 * a peer owns there and walks past anything parked at the root or one level down. Nearly half of
 * this repo's TypeScript files sit two or more levels below the root, so depth is where the cover
 * has to reach.
 *
 * Pruned on the way down rather than collected and filtered afterwards. `node_modules` alone holds
 * thousands of directories, so a walk that reads them before asking git costs more than the rest of
 * this suite put together. Breadth-first for the same reason the pruning exists: it asks
 * `git check-ignore` once per level of depth instead of once per directory. That spends argv
 * length to save process spawns, which is the right way round while a level stays tens of
 * directories wide.
 *
 * What comes back is a snapshot rather than a lock. A directory created after its parent was read
 * gets no canary on this run. That is inherent to sampling a live tree, and the next run covers it.
 */
async function walkedDirectories(): Promise<string[]> {
	const walked = [ROOT];
	let frontier = [ROOT];

	while (frontier.length > 0) {
		const children = (await Promise.all(frontier.map(childDirectories))).flat();

		// `git check-ignore` with no paths is a usage error rather than an empty answer.
		if (children.length === 0) break;

		const ignored = await ignoredDirectories(children);

		frontier = children.filter((directory) => !ignored.has(directory));
		walked.push(...frontier);
	}

	return walked;
}

/**
 * Clears fixtures an earlier run left behind, before this run plants its own.
 *
 * A stray is not reliably loud. A run killed after a broken tree-wide write had already tidied the
 * canaries leaves *formatted* files, and `format:check` passes over those without a word, so they
 * pile up unseen. Content is what distinguishes the two states, because formatting a fixture keeps
 * its `NOTE`, so both tests have to pass before anything is removed: the name has the shape this
 * suite generates, and the contents carry the marker.
 *
 * Deleting on either test alone goes badly, and both failures are on the record. Content alone
 * deleted this file, which defines `NOTE` as a literal and so carries the marker itself, and then a
 * scratch copy of the suite that a mutation run was using as its control. A name alone would delete
 * whatever happened to match. Committed files are exempt on top of that, since no canary is ever
 * committed and the rule costs nothing.
 *
 * `MESSY` is deliberately not one of the gates. A stray is litter from some earlier version of this
 * file, which may have planted extensions the current one does not, and a sweep that consulted the
 * live set would walk straight past exactly those. The name shape and the marker already say what a
 * file is without asking what this run happens to plant.
 *
 * Age is the fourth gate, and it is what makes two of these runs able to share a checkout. A peer's
 * canaries are live files that look exactly like strays, so anything younger than `TIMEOUT` is left
 * alone: Vitest has already failed any run that has been going longer than that, so nothing newer
 * can belong to a dead one. A stray dropped seconds ago survives this sweep and is caught by a later
 * one, which is the right way round.
 *
 * Index entries need clearing too, and a killed run can leave one whose file is already gone. Shape
 * and absence from HEAD are the only evidence left in that case, so that branch runs on two gates
 * rather than four. A live peer never appears in it, because a peer's files still exist.
 */
async function sweepStrays(directories: string[]): Promise<void> {
	const committed = new Set(
		(await git(['ls-tree', '-r', '--name-only', '-z', 'HEAD'])).split('\0').filter(Boolean),
	);
	const uncommitted = (path: string) => !committed.has(relative(ROOT, path));
	const cutoff = Date.now() - TIMEOUT;

	const marked = await Promise.all(
		directories.map(async (directory) => {
			const entries = await readdir(directory, { withFileTypes: true });
			const suspects = entries
				.filter((entry) => entry.isFile() && CANARY_NAME.test(entry.name))
				.map((entry) => join(directory, entry.name))
				.filter(uncommitted);

			const hits = await Promise.all(
				suspects.map(async (path) => {
					if ((await stat(path)).mtimeMs > cutoff) return '';

					return (await readFile(path, 'utf8')).includes(NOTE) ? path : '';
				}),
			);

			return hits.filter(Boolean);
		}),
	);

	const orphaned = (await git(['ls-files', '--deleted', '-z']))
		.split('\0')
		.filter((file) => file && CANARY_NAME.test(file.split('/').at(-1) ?? ''))
		.map((file) => join(ROOT, file))
		.filter(uncommitted);

	const strays = [...marked.flat(), ...orphaned];

	if (strays.length === 0) return;

	// Cached entry first. Dropping the file while git still holds an entry for it only trades one
	// kind of stray for another.
	await git(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...strays]);
	await Promise.all(strays.map((stray) => rm(stray, { force: true })));
}

/**
 * Plants one canary of `extension` in `directory` and hands back its path. The name is random
 * because a fixed one can be excluded: `oxfmt --write . '!**\/format-canary-*\/**'` rewrites the
 * tree and steps around any canary whose path a script can predict. A plain file rather than a
 * directory, so a peer's canary never looks like somewhere this run should plant.
 */
function canaryName(extension: string): string {
	return `${randomUUID().replaceAll('-', '').slice(0, 12)}${extension}`;
}

async function plantCanary(directory: string, extension: string): Promise<string> {
	const canary = join(directory, canaryName(extension));

	await writeFile(canary, MESSY[extension]);

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
	// A deliberately wrong file is the only instrument available here, which is worth knowing before
	// anyone reaches for a subtler one. oxfmt does not rewrite a file that already matches its own
	// output, so a tree-wide write across a clean tree changes no bytes and moves no timestamps.
	// There is nothing left to measure. Only a file that is wrong on purpose has to change.
	//
	// So this guard samples. It catches evasions that have been demonstrated against it, one at a
	// time, and it says nothing about the ones nobody has thought of yet. What it does catch, each
	// one failing in the mutation matrix:
	//
	//   a tree-wide write, with or without its summary sent to /dev/null
	//   a write that enumerates source directories, and one scoped to a nested path at any depth
	//   a write that excludes an extension
	//   a write enumerated from `git ls-files` rather than from a tree walk
	//
	// And one verified directly rather than through the matrix: a walk pruned by a personal
	// `core.excludesFile`, which git reads and oxfmt does not.
	//
	// Four escapes are known. They are written down so the next reader inherits them instead of
	// finding them the hard way:
	//
	//   1. A glob that excludes the canary name shape. The names are random, the shape is not, so
	//      `oxfmt --write . '!**/????????????.*'` rewrites the tree and passes every test here.
	//   2. An enumeration that cannot see an intent-to-add entry. `git diff --cached --name-only` and
	//      `git ls-tree -r HEAD` both report nothing for a canary. Mis-formatting a committed file
	//      would cover both, and it is not safe here, because Vitest runs test files in parallel.
	//      Holding `core/provenance.ts` wrong for 1.2s failed 18 of the 43 files in the unit project,
	//      three times out of three.
	//   3. `.git/info/exclude`. `ignoredDirectories` switches `core.excludesFile` off, and git offers
	//      no equivalent switch for this one, so its ignore model can still diverge from oxfmt's and
	//      prune a directory the formatter walks.
	//   4. `sweepStrays` reads absence from HEAD as permission to delete, so it removes a staged but
	//      uncommitted file that matches the canary shape, carries the marker, and is old enough.
	//
	// The list is open, and a fifth axis would not close it. A canary has to be tellable from a real
	// file to work at all, which is exactly what a selector needs in order to skip one. More canaries
	// do not change that. They move the selector.
	//
	// Living with that is defensible for one reason. oxfmt skips a file that already matches its
	// output, so the writes this guard cannot see are writes that change no bytes, and a write that
	// changes no bytes cannot cost a peer an edit. The escapes above are real because a peer's
	// in-flight file is unformatted and therefore changeable. They are also narrow, and that is the
	// whole of what this guard buys.
	it(
		'writes only the file it was handed',
		async () => {
			// Collected as they are created, so a throw part way through still cleans up the rest.
			const scratch: string[] = [];
			const canaries: string[] = [];

			try {
				const directories = await walkedDirectories();

				await sweepStrays(directories);

				const outside = await mkdtemp(join(tmpdir(), 'cambium-format-'));
				const target = join(outside, 'messy.ts');

				scratch.push(outside);
				await writeFile(target, MESSY['.ts']);

				for (const directory of directories) {
					for (const extension of EXTENSIONS) {
						canaries.push(await plantCanary(directory, extension));
					}
				}

				// Each canary counts only if oxfmt's own tree walk reaches it. Naming a path on the
				// command line proves nothing, because oxfmt formats a file it is handed even when
				// `.gitignore` covers it, so an ignored canary would sit unformatted and pass for
				// the wrong reason. `format:check` runs that walk. It is a separate script string
				// from `format`, so it settles reachability and nothing else: an unreachable canary
				// satisfies every assertion below for free, and that is the vacuous pass being
				// ruled out here.
				const bareCheck = await runScript('format:check');

				for (const canary of canaries) {
					expect(bareCheck).toContain(relative(ROOT, canary));
				}

				// `--intent-to-add` rather than a full add: it puts each path where `git ls-files`
				// reads, which is all the tracked axis needs, and writes no blob to the object
				// store. A script enumerated as `git ls-files -z | xargs -0 oxfmt --write` rewrote
				// every tracked file in the repo and passed this guard until these entries existed.
				//
				// It happens here rather than before the walk above, and comes out in the `finally`,
				// because an index entry is committable. Anyone running `git commit -a` in this
				// checkout while these exist takes the canaries with them, so the window is held to
				// the one command that needs it.
				await git(['add', '--intent-to-add', '--', ...canaries]);

				expect(filesTouched(await runScript('format', target))).toBe(1);
				expect(await readFile(target, 'utf8')).toBe(TIDY);

				for (const canary of canaries) {
					expect(await readFile(canary, 'utf8')).toBe(MESSY[extname(canary)]);
				}
			} finally {
				// Only what this test planted. A leftover is still mis-formatted in every case
				// except one, so it fails `pnpm format:check` on the next call rather than lurking.
				// The exception is a run killed after a tree-wide write already tidied the
				// canaries, and the sweep at the top of the next run clears those.
				//
				// Files first, index second, and the index call cannot take the run down with it.
				// A concurrent `git add` holding `index.lock` is enough to make it throw, and a
				// throw here would both strand two hundred files in the tree and replace the
				// assertion failure this test exists to report. What it leaves instead is index
				// entries naming files that are already gone, which the next sweep clears.
				await Promise.all([
					...scratch.map((dir) => rm(dir, { recursive: true, force: true })),
					...canaries.map((canary) => rm(canary, { force: true })),
				]);

				if (canaries.length > 0) {
					await git(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...canaries]).catch(
						() => undefined,
					);
				}
			}
		},
		TIMEOUT,
	);

	// The fixture list is written down, and anything written down goes stale. This is the alarm on
	// that: the moment someone commits a file whose extension has no fixture, the extension axis
	// above has a hole, and this fails naming it. Cheap, because it spawns nothing.
	it(
		'has a fixture for every extension in the tree',
		async () => {
			const tracked = (await git(['ls-files', '-z'])).split('\0').filter(Boolean);
			const extensions = new Set(tracked.map((file) => extname(file)).filter(Boolean));
			const uncovered = [...extensions].filter(
				(extension) => !EXTENSIONS.includes(extension) && !UNFORMATTED.includes(extension),
			);

			expect(uncovered).toEqual([]);
		},
		TIMEOUT,
	);

	// Planting and sweeping read two different descriptions of the same filename, and they drifted:
	// the sweep's pattern spelled its extension `[a-z]+`, which has no digits, so `.json5` canaries
	// were planted and then never swept. Nothing compared the two, because a human reading them saw
	// `.ts` and `.jsonc` match and stopped there. This compares them for every extension, and it
	// calls the real generator rather than a copy of it, so a change to either side has to face it.
	it('can sweep every name it plants', () => {
		for (const extension of EXTENSIONS) {
			const name = canaryName(extension);

			expect(extname(name), `extname does not round-trip ${extension}`).toBe(extension);
			expect(CANARY_NAME.test(name), `${name} is planted but the sweep cannot see it`).toBe(true);
		}

		// An extension in both lists would be planted and simultaneously declared unformatted, which
		// makes the coverage test above vacuous for it.
		expect(EXTENSIONS.filter((extension) => UNFORMATTED.includes(extension))).toEqual([]);
	});
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
	// forbids a dispatched task to do, and a test run is no better placed to do it. The guard above
	// does put a file in every directory, which is a different act: it creates and deletes fixtures
	// of its own and rewrites nothing a peer owns.
	it(
		'still covers the tree when called bare',
		async () => {
			expect(filesTouched(await runScript('format:check'))).toBeGreaterThan(100);
		},
		TIMEOUT,
	);
});
