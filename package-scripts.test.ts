import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	appendFile,
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

// This file sits at the repo root, so its own directory is the root oxfmt falls back to.
const ROOT = import.meta.dirname;

// oxfmt totals what it touched in exactly one place: `Finished in 16ms on 147 files using 14
// threads`, on stdout. Under `--check` it also lists every file that needs formatting, which is
// what the reachability assertion reads.
const FILE_COUNT = /Finished in .+ on (\d+) files/;

// Every guard run spawns pnpm twice, and pnpm pays its own startup before oxfmt runs at all. On top
// of that come one bare `oxfmt --list-different` per level of directory depth, half a dozen git
// calls, and a fixture in every directory oxfmt walks. That fits inside Vitest's 5s default on a warm
// local checkout and has no margin left on a cold or loaded one.
const TIMEOUT = 30_000;

// The marker rides along so a file left behind by a killed run explains itself, and the sweep below
// checks for it before deleting, because a fixture keeps its comment even after something has
// formatted it.
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
const UNFORMATTED = ['.md', '.png', '.jpg'];

const EXTENSIONS = Object.keys(MESSY);

// The one fixture this suite expects oxfmt to rewrite, so the only one needing a formatted
// counterpart. It goes to a temp directory outside the repo and is what the scoped run is handed.
const TIDY = `// ${NOTE}\nconst x = { a: 1, b: 2 };\nexport { x };\n`;

// The shape of a canary filename. The manifest decides what the sweep deletes, and this is a second
// filter on top of it, cheap enough to keep: a manifest line that somehow names a file of any other
// shape is left alone. Nobody names a file this way by hand, so the filter costs nothing real.
//
// Digits belong in the extension class. Without them this read `[a-z]+`, which matches `.jsonc` and
// not `.json5`, so every `.json5` stray was invisible to the sweep at any age and survived every
// later run. A killed run left fourteen of them, `pnpm format:check` stayed red on files nobody
// could find by rerunning the suite, and `pnpm format` then tidied them into silent litter. The
// test below is what keeps this pattern and `MESSY` agreeing, because eyeballing two lists is how
// they came apart in the first place.
const CANARY_NAME = /^[0-9a-f]{12}\.[a-z0-9]+$/;

async function runScript(root: string, script: string, target?: string): Promise<string> {
	const args = target ? [script, target] : [script];

	try {
		const { stdout } = await run('pnpm', args, { cwd: root });

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

async function git(root: string, args: string[]): Promise<string> {
	const { stdout } = await run('git', args, { cwd: root });

	return stdout;
}

// `git add` and `git rm --cached` both write the checkout's one shared index, so two guard runs
// sharing a checkout, or a developer's own `git add` alongside one, can hold `index.lock` while
// this runs. Git exits 128
// for that and for plenty else, so contention is read off stderr, never off the exit code. The
// cap sits well inside `TIMEOUT`. A lock that outlives it was more likely left by a crashed git
// than held by a live one, so the error names the lock and says how to clear it. A reader then
// sees a stuck index, and never mistakes it for the guard catching a bad script.
async function writeIndex(root: string, args: string[], cap = 5_000): Promise<void> {
	const deadline = Date.now() + cap;

	for (let wait = 25; ; wait = Math.min(wait * 2, 400)) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- each attempt waits on the lock the last one met
			await git(root, args);

			return;
		} catch (error) {
			const stderr = (error as { stderr?: string }).stderr ?? '';

			if (!stderr.includes('index.lock') || !stderr.includes('File exists')) throw error;
			if (Date.now() + wait > deadline) {
				throw new Error(
					`index.lock still held after ${cap}ms; if no git is running, remove it:\n${stderr}`,
					{
						cause: error,
					},
				);
			}

			// oxlint-disable-next-line no-await-in-loop -- each wait gives the lock holder time to finish
			await new Promise((settle) => setTimeout(settle, wait));
		}
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
 * A fresh filename for one canary or probe of `extension`. The name is random because a fixed one
 * can be excluded: `oxfmt --write . '!**\/format-canary-*\/**'` rewrites the tree and steps around
 * any canary whose path a script can predict. It names a plain file rather than a directory, so a
 * peer's canary never looks like somewhere this run should plant.
 */
function canaryName(extension: string): string {
	return `${randomUUID().replaceAll('-', '').slice(0, 12)}${extension}`;
}

/**
 * One run's record of every file it creates inside the repo, canaries and walk probes alike.
 *
 * It lives under the git directory, which neither `git status` nor oxfmt's tree walk reads, and it
 * is located with `--git-path` because in a linked worktree `.git` is a file rather than a
 * directory. Each checkout gets its own, so a sweep in one worktree never reads another's paths.
 */
interface Run {
	root: string;
	manifest: string;
	planted: string[];
}

async function manifestDirectory(root: string): Promise<string> {
	const path = (await git(root, ['rev-parse', '--git-path', 'package-scripts-canaries'])).trim();

	return resolve(root, path);
}

// A file another run can delete between our listing it and reading it. A missing file counts as an
// answer here. Any other error still throws.
async function unlessGone<T>(pending: Promise<T>): Promise<T | undefined> {
	try {
		return await pending;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}

async function startRun(root: string): Promise<Run> {
	const directory = await manifestDirectory(root);

	await mkdir(directory, { recursive: true });

	return { root, manifest: join(directory, randomUUID()), planted: [] };
}

// Written before the files exist, never after. A run killed between the two leaves a manifest
// naming a file that was never written, which the sweep shrugs off; the other order leaves a file
// no manifest names, which the sweep may never touch.
async function plant(owner: Run, directories: string[], extensions: string[]): Promise<string[]> {
	const paths = directories.flatMap((directory) =>
		extensions.map((extension) => join(directory, canaryName(extension))),
	);

	// NUL-separated, since a directory name can hold a newline and cannot hold a NUL.
	await appendFile(owner.manifest, paths.map((path) => `${path}\0`).join(''));
	owner.planted.push(...paths);

	// Every write settles before this returns or throws. `Promise.all` rejects on the first failed
	// write while its siblings are still in flight, so cleanup could remove the files and the
	// manifest and then have a sibling land a file no manifest lists, which no sweep will touch.
	const writes = await Promise.allSettled(
		paths.map((path) => writeFile(path, MESSY[extname(path)])),
	);
	const failed = writes.find((write) => write.status === 'rejected');

	if (failed) throw failed.reason;

	return paths;
}

/**
 * The subdirectories of `parent`, minus `.git` and `node_modules`. `.git` is git's own and never
 * formatted. oxfmt skips `node_modules` unless told otherwise, so a probe there would only be a
 * write into somebody's install. Dot-prefixed names stay in otherwise, because oxfmt walks them: a
 * mis-formatted file under `.github` is reported like any other.
 */
async function childDirectories(parent: string): Promise<string[]> {
	const entries = await readdir(parent, { withFileTypes: true });

	return entries
		.filter(
			(entry) => entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules',
		)
		.map((entry) => join(parent, entry.name));
}

// The walk reads oxfmt directly rather than through a script, because the script is the thing under
// test and this is only asking where oxfmt goes. Any exit is read for its listing: a peer's
// half-written file that will not parse exits 2 and still lists everything else.
async function listDifferent(root: string): Promise<Set<string>> {
	const oxfmt = join(root, 'node_modules', '.bin', 'oxfmt');

	try {
		const { stdout } = await run(oxfmt, ['--list-different'], { cwd: root });

		return new Set(stdout.split('\n').filter(Boolean));
	} catch (error) {
		const failure = error as { stdout?: string };
		if (typeof failure.stdout !== 'string') throw error;

		return new Set(failure.stdout.split('\n').filter(Boolean));
	}
}

/**
 * Every place inside the repo a tree-wide write can land, as oxfmt itself sees the tree: the root,
 * and every directory under it at any depth that oxfmt's own walk enters. A write scoped to a
 * nested path, `oxfmt --write app/readers` say, rewrites everything a peer owns there and walks past
 * anything parked at the root or one level down. Nearly half of this repo's TypeScript files sit
 * two or more levels below the root, so depth is where the cover has to reach.
 *
 * Asked of oxfmt rather than of git, because git's ignore model is not oxfmt's. A walk pruned by
 * `git check-ignore` lost a directory to a personal `core.excludesFile` that oxfmt never reads, on
 * one machine only. Switching that off still left `core.ignorecase`, which git init turns on for
 * macOS: a `hidden/` rule prunes `Hidden/` for git, while oxfmt matches case-sensitively and
 * formats it. Asking oxfmt covers every divergence of that kind, including ones nobody has found.
 *
 * Breadth-first, one probe per child directory of the current frontier, one bare
 * `oxfmt --list-different` per level of depth. A probe oxfmt lists is a directory it walks; a probe
 * it does not list prunes that directory and everything under it. The root gets a probe too, as the
 * control: oxfmt always walks the root, so a listing without it means the listing broke, and an
 * empty frontier from a broken listing would otherwise shrink the guard to the root without a word.
 *
 * The residue is a directory oxfmt skips for `.ts` but enters for something else. A file-level rule
 * such as `foo/*.ts`, or any ignore pattern aimed at the probe's extension, drops `foo/` and its
 * whole subtree from this walk even though oxfmt formats `foo/bar/x.ts` and `foo/x.json`. Nothing in
 * this repo's ignore files has that shape today.
 *
 * What comes back is a snapshot rather than a lock. A directory created after its parent was read
 * gets no canary on this run. That is inherent to sampling a live tree, and the next run covers it.
 */
async function walkedDirectories(walk: Run): Promise<string[]> {
	const walked = [walk.root];
	let frontier = [walk.root];

	while (frontier.length > 0) {
		const children = (await Promise.all(frontier.map(childDirectories))).flat();

		if (children.length === 0) break;

		const [control, ...probes] = await plant(walk, [walk.root, ...children], ['.ts']);

		try {
			const listed = await listDifferent(walk.root);

			if (!listed.has(relative(walk.root, control))) {
				throw new Error(`oxfmt --list-different did not list the root probe ${control}`);
			}

			frontier = children.filter((_, index) => listed.has(relative(walk.root, probes[index])));
		} finally {
			await Promise.all([control, ...probes].map((probe) => rm(probe, { force: true })));
		}

		walked.push(...frontier);
	}

	return walked;
}

/**
 * Clears what earlier runs left behind, before this run plants its own.
 *
 * A stray is not reliably loud. A run killed after a broken tree-wide write had already tidied the
 * canaries leaves *formatted* files, and `format:check` passes over those without a word, so they
 * pile up unseen.
 *
 * Only a path some run's manifest lists can be deleted. Guessing from the file itself goes wrong:
 * matching on content alone once deleted this very file, which defines `NOTE` as a literal, and
 * then a scratch copy of the suite a mutation run was using as its control. Name shape, marker,
 * absence from HEAD and age together still match a file somebody staged and has not committed yet.
 * A manifest records what a run created, so nothing it does not list is touched, whatever its
 * name, contents or age.
 *
 * The old gates stay on as a second filter because they are cheap: the name has the canary shape,
 * the path sits inside this repo, it is not committed, and a file still on disk carries the marker.
 * A listed path whose file is already gone keeps only its index entry to clear.
 *
 * Age is read off the manifest, and it is what lets two runs share a checkout. A run inside its
 * `TIMEOUT` keeps a manifest younger than that, so its canaries are not swept. Vitest fails a test at
 * `TIMEOUT` without stopping its body, so a run that overruns can lose its own fixtures to a peer's
 * sweep. That run has already failed, and its fixtures are the only ones at risk. A stray dropped
 * seconds ago survives this sweep and is caught by a later one, which is the right way round.
 *
 * Two sweeps can run at once over the same stale manifests. Either one may delete a manifest or
 * hold `index.lock` while the other is still reading, so a vanished file is skipped rather than
 * thrown on, and a failed `git rm --cached` leaves everything listed for a later sweep.
 */
async function sweepStrays(root: string): Promise<void> {
	const directory = await manifestDirectory(root);
	const manifests = (await unlessGone(readdir(directory))) ?? [];

	const cutoff = Date.now() - TIMEOUT;
	const stale = (
		await Promise.all(
			manifests.map(async (name) => {
				const manifest = join(directory, name);
				const stats = await unlessGone(stat(manifest));

				return stats && stats.mtimeMs <= cutoff ? manifest : '';
			}),
		)
	).filter(Boolean);

	if (stale.length === 0) return;

	const committed = new Set(
		(await git(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD'])).split('\0').filter(Boolean),
	);
	const listed = (
		await Promise.all(
			stale.map(async (manifest) => (await unlessGone(readFile(manifest, 'utf8'))) ?? ''),
		)
	)
		.flatMap((contents) => contents.split('\0'))
		.filter(Boolean)
		.filter((path) => {
			const inside = relative(root, path);

			return (
				CANARY_NAME.test(basename(path)) &&
				!inside.startsWith('..') &&
				!isAbsolute(inside) &&
				!committed.has(inside)
			);
		});

	const doomed = (
		await Promise.all(
			listed.map(async (path) => {
				const contents = await unlessGone(readFile(path, 'utf8'));

				return contents === undefined || contents.includes(NOTE) ? path : '';
			}),
		)
	).filter(Boolean);

	// Cached entry first. Dropping the file while git still holds an entry for it only trades one
	// kind of stray for another. `-f` because the fully staged canary may have been tidied after it
	// was added, and git refuses to unstage content that differs from both the file and HEAD.
	if (doomed.length > 0) {
		const unstaged = await git(root, [
			'rm',
			'--cached',
			'-f',
			'--quiet',
			'--ignore-unmatch',
			'--',
			...doomed,
		]).then(
			() => true,
			() => false,
		);

		if (!unstaged) return;

		await Promise.all(doomed.map((path) => rm(path, { force: true })));
	}

	await Promise.all(stale.map((manifest) => rm(manifest, { force: true })));
}

/**
 * Plants a canary in every directory oxfmt walks, runs `pnpm format` on one file outside the repo,
 * and reports every way the script reached further than that file. An empty list is a pass.
 *
 * It reports rather than asserting so the same guard can run against a scratch repo whose `format`
 * script is an exploit, where the expected answer is a failure and the test needs to say which one.
 */
interface GuardOptions {
	// Runs in the `finally`, just before the canaries come out of the index, so a test can hold
	// `index.lock` at exactly that moment rather than guessing at timing.
	beforeUnstage?: () => Promise<void>;
	unstageCap?: number;
}

async function formatGuard(
	root: string,
	extensions: string[],
	options: GuardOptions = {},
): Promise<string[]> {
	await sweepStrays(root);

	const failures: string[] = [];
	const guard = await startRun(root);
	const outside = await mkdtemp(join(tmpdir(), 'cambium-format-'));
	let canaries: string[] = [];
	let thrown: { error: unknown } | undefined;

	try {
		const target = join(outside, 'messy.ts');

		await writeFile(target, MESSY['.ts']);
		canaries = await plant(guard, await walkedDirectories(guard), extensions);

		// Each canary counts only if oxfmt's own tree walk reaches it. Naming a path on the command
		// line proves nothing, because oxfmt formats a file it is handed even when `.gitignore`
		// covers it, so an ignored canary would sit unformatted and pass for the wrong reason.
		// `format:check` runs that walk. It is a separate script string from `format`, so it settles
		// reachability and nothing else: an unreachable canary passes every check below for free,
		// and that is the vacuous pass being ruled out here.
		const bareCheck = await runScript(root, 'format:check');

		for (const canary of canaries) {
			if (!bareCheck.includes(relative(root, canary))) {
				failures.push(`unreachable ${relative(root, canary)}`);
			}
		}

		// Two ways into the index, because git's enumerations disagree about what is in it.
		// `--intent-to-add` puts a path where `git ls-files` reads and writes no blob; a script
		// enumerated as `git ls-files -z | xargs -0 oxfmt --write` rewrote every tracked file in the
		// repo and passed this guard until those entries existed. `git diff --cached` cannot see an
		// intent-to-add entry at all, so one canary is added in full. One is enough to catch a script
		// driven by the cached diff, and the rest stay intent-to-add so the blobs stay out of the
		// object store.
		//
		// It happens here rather than before the walk, and comes out in the `finally`, because an
		// index entry is committable. Anyone committing in this checkout while these exist takes the
		// canaries with them: `git commit -a` all of them, a plain `git commit` the one fully added.
		// The window is held to the one command that needs it.
		//
		// `-f` because the walk plants wherever oxfmt goes, and that includes directories git
		// ignores. Without it `git add` refuses the whole batch over one such path.
		const [added, ...intended] = canaries;

		if (intended.length > 0) {
			await writeIndex(root, ['add', '-f', '--intent-to-add', '--', ...intended]);
		}
		await writeIndex(root, ['add', '-f', '--', added]);

		const touched = filesTouched(await runScript(root, 'format', target));

		if (touched !== 1) failures.push(`touched ${touched} files`);
		if ((await readFile(target, 'utf8')) !== TIDY) failures.push('left its target unformatted');

		const after = await Promise.all(canaries.map((canary) => readFile(canary, 'utf8')));

		canaries.forEach((canary, index) => {
			if (after[index] !== MESSY[extname(canary)])
				failures.push(`rewrote ${relative(root, canary)}`);
		});

		return failures;
	} catch (error) {
		thrown = { error };
		throw error;
	} finally {
		// Only what this run planted. A leftover is still mis-formatted in every case except one, so
		// it fails `pnpm format:check` on the next call rather than lurking. The exception is a run
		// killed after a tree-wide write already tidied the canaries, and the sweep at the top of
		// the next run clears those.
		//
		// Files first, index second. The unstaging waits out a peer's `index.lock` the same way
		// staging does, because the fully added canary is a real blob in the shared index: left
		// there, the next plain `git commit` in this checkout takes a fixture with it.
		//
		// A lock that outlasts the cap keeps the manifest, so a later sweep can finish the job,
		// and the run fails naming the lock rather than passing over a staged canary. When the
		// body already threw, both errors surface in one AggregateError. Throwing only the cleanup
		// error would hide the failure the guard exists to report, and throwing only the original
		// would hide a canary still sitting in the index.
		await Promise.all([
			rm(outside, { recursive: true, force: true }),
			...guard.planted.map((path) => rm(path, { force: true })),
		]);

		await options.beforeUnstage?.();

		const stuck =
			canaries.length === 0
				? undefined
				: await writeIndex(
						root,
						['rm', '--cached', '-f', '--quiet', '--ignore-unmatch', '--', ...canaries],
						options.unstageCap,
					).then(
						() => undefined,
						(error: unknown) => error,
					);

		if (stuck === undefined) {
			await rm(guard.manifest, { force: true });
		} else if (thrown) {
			// oxlint-disable-next-line no-unsafe-finally -- a canary left staged must fail the run
			throw new AggregateError(
				[thrown.error, stuck],
				'format guard failed, then could not unstage its canaries',
			);
		} else {
			// oxlint-disable-next-line no-unsafe-finally -- a canary left staged must fail the run
			throw stuck;
		}
	}
}

// Already what oxfmt would write, so a scratch repo's committed files never show up as work.
const FORMATTED = 'export const x = 1;\n';

/**
 * A throwaway repo outside this one, whose `format` script is `formatScript`, so the guard can be
 * run against an exploit. An exploit never runs against this checkout: its whole purpose is a write
 * across the tree, and here that write lands on a peer's in-flight edits.
 *
 * `Hidden/` is a directory git prunes and oxfmt walks. `.gitignore` says `hidden/`, and with
 * `core.ignorecase` on, which git init sets by default on macOS and this sets everywhere, git
 * matches it and oxfmt, which matches case-sensitively, does not. It stays untracked, the way a
 * peer's brand-new directory is, because `git check-ignore` never reports a directory holding a
 * tracked file, so a walk pruned by it would enter `Hidden/` anyway. Only `.ts` gets planted here, and
 * `node_modules` is a link to this checkout's, so oxfmt and its config resolve without an install.
 */
async function scratchRepo(formatScript: string): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'cambium-scratch-')));
	const files: Record<string, string> = {
		'package.json': JSON.stringify({
			name: 'scratch',
			private: true,
			scripts: { format: formatScript, 'format:check': 'oxfmt --check' },
		}),
		'.gitignore': 'hidden/\n',
		'a/one.ts': FORMATTED,
		'a/b/two.ts': FORMATTED,
	};

	try {
		await git(root, ['init', '--quiet']);
		await git(root, ['config', 'core.ignorecase', 'true']);
		await copyFile(join(ROOT, '.oxfmtrc.json'), join(root, '.oxfmtrc.json'));
		await symlink(join(ROOT, 'node_modules'), join(root, 'node_modules'));

		await Promise.all(
			Object.entries({ ...files, 'Hidden/three.ts': FORMATTED }).map(async ([path, contents]) => {
				await mkdir(dirname(join(root, path)), { recursive: true });
				await writeFile(join(root, path), contents);
			}),
		);

		// The identity, hook and signing flags keep a developer's global git config from failing a
		// commit nobody reads.
		await git(root, ['add', '--', '.oxfmtrc.json', ...Object.keys(files)]);
		await git(root, [
			'-c',
			'user.name=scratch',
			'-c',
			'user.email=scratch@example.invalid',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'--quiet',
			'--no-verify',
			'--message',
			'scratch',
		]);

		return root;
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}

async function inScratch(formatScript: string, body: (root: string) => Promise<void>) {
	const root = await scratchRepo(formatScript);

	try {
		await body(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function indexed(root: string): Promise<string[]> {
	// `toSorted` is ES2023 and tsconfig targets ES2022. The array is fresh, so `sort` mutates
	// nothing a caller holds.
	// oxlint-disable-next-line unicorn/no-array-sort
	return (await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean).sort();
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
	// time, and it says nothing about the ones nobody has thought of yet. What it has been shown to
	// catch, by mutating `package.json` and watching this test fail:
	//
	//   a tree-wide write, with or without its summary sent to /dev/null
	//   a write that enumerates source directories, and one scoped to a nested path at any depth
	//   a write that excludes an extension
	//   a write enumerated from `git ls-files` rather than from a tree walk
	//
	// And three more held by arms in the describe block below, each run against an exploit in a
	// scratch repo and each paired with the correct script passing in the same repo shape:
	//
	//   a write aimed at a directory git prunes and oxfmt still walks
	//   a write enumerated from `git diff --cached --name-only`
	//   a sweep deleting a staged file this suite never created
	//
	// Two escapes stay open. They are written down so the next reader inherits them instead of
	// finding them the hard way:
	//
	//   1. A glob that excludes the canary name shape. The names are random, the shape is not, so
	//      `oxfmt --write . '!**/????????????.*'` rewrites the tree and passes every test here. The
	//      sweep does not need the shape, since the manifest decides what it deletes. It stays open
	//      because no name generator fixes it: whatever makes the names, they share some property a
	//      selector can exclude, and randomising the shape moves the glob without closing the hole.
	//   2. An enumeration from `git ls-tree -r HEAD`. Only a committed file appears there, and
	//      mis-formatting a committed file is not safe, because Vitest runs test files in parallel.
	//      Holding `core/provenance.ts` wrong for 1.2s failed 18 of the 43 files in the unit
	//      project, three times out of three.
	//
	// The walk has a narrower gap of its own, a file-level ignore rule aimed at the probe's
	// extension, which `walkedDirectories` describes.
	//
	// The list is open, and another canary axis would not close it. A canary has to be tellable from a real
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
			expect(await formatGuard(ROOT, EXTENSIONS)).toEqual([]);
		},
		TIMEOUT,
	);

	// The fixture list is written down, and anything written down goes stale. This is the alarm on
	// that: the moment someone commits a file whose extension has no fixture, the extension axis
	// above has a hole, and this fails naming it. Cheap, because it spawns nothing.
	it(
		'has a fixture for every extension in the tree',
		async () => {
			const tracked = (await git(ROOT, ['ls-files', '-z'])).split('\0').filter(Boolean);
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
	// `.ts` and `.jsonc` match and stopped there. The manifest now decides what gets swept, and the
	// shape is still a filter on it, so a name the shape rejects is still a canary nothing clears.
	// This compares them for every extension, and it calls the real generator rather than a copy of
	// it, so a change to either side has to face it.
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

// The escapes the guard used to let through, each run against a scratch repo so an exploit never
// touches this checkout. An exploit arm asserts the specific failure its escape produces, not just
// that the guard failed, since a guard that fails for an unrelated reason proves nothing about the
// hole. Nothing in this suite runs the old guard. Each exploit arm was checked by hand, by putting
// back the behaviour its escape relied on (a walk pruned by `git check-ignore`, intent-to-add only,
// a sweep gated on shape, marker, HEAD and age) and watching that arm fail. Redo that check when
// an arm changes, because an arm that cannot fail looks exactly like one that passes.
describe('pnpm format guard, against scripts built to evade it', () => {
	it(
		'walks a directory git prunes and oxfmt formats',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				// The premise, checked rather than trusted: git really does prune `Hidden/` under the
				// exact question the old walk asked, and oxfmt really does format what is in it.
				expect(
					await git(root, ['-c', 'core.excludesFile=/dev/null', 'check-ignore', 'Hidden']),
				).toBe('Hidden\n');

				const walk = await startRun(root);

				try {
					expect(await walkedDirectories(walk)).toContain(join(root, 'Hidden'));
				} finally {
					await rm(walk.manifest, { force: true });
				}
			});
		},
		TIMEOUT,
	);

	it(
		'passes the correct script',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				const committed = await indexed(root);

				expect(await formatGuard(root, ['.ts'])).toEqual([]);
				expect(await indexed(root)).toEqual(committed);
			});
		},
		TIMEOUT,
	);

	it(
		'fails a write aimed at a directory git prunes',
		async () => {
			await inScratch('oxfmt --write Hidden && oxfmt --write', async (root) => {
				const failures = await formatGuard(root, ['.ts']);

				expect(failures).toContainEqual(
					expect.stringMatching(/^rewrote Hidden\/[0-9a-f]{12}\.ts$/),
				);
				expect(failures.filter((failure) => failure.startsWith('unreachable'))).toEqual([]);
			});
		},
		TIMEOUT,
	);

	// `$(...)` rather than a pipe into xargs: GNU xargs runs its command once on empty input, so
	// against a guard that stages nothing in full the pipe would degrade into a bare tree-wide write
	// and fail for the wrong reason. This form degrades into exactly the correct script.
	it(
		'fails a write enumerated from the cached diff',
		async () => {
			await inScratch('oxfmt --write $(git diff --cached --name-only)', async (root) => {
				const committed = await indexed(root);
				const failures = await formatGuard(root, ['.ts']);

				expect(failures.filter((failure) => failure.startsWith('rewrote'))).toHaveLength(1);
				expect(failures.filter((failure) => failure.startsWith('unreachable'))).toEqual([]);

				// The fully added canary was tidied after staging, which is the case `git rm --cached`
				// refuses without `-f`. Nothing may be left in the index either way.
				expect(await indexed(root)).toEqual(committed);
			});
		},
		TIMEOUT,
	);

	it(
		'leaves a staged file no manifest lists, whatever it looks like',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				const expired = new Date(Date.now() - 2 * TIMEOUT);

				// Canary shape, the marker, absent from HEAD, and older than `TIMEOUT`: everything a
				// sweep guessing from the file would take. Staged, so losing it costs somebody work.
				const bystander = join(root, 'a', canaryName('.ts'));

				await writeFile(bystander, MESSY['.ts']);
				await git(root, ['add', '--', bystander]);
				await utimes(bystander, expired, expired);

				// A stale manifest in the same sweep, so the deleting branch runs rather than
				// returning early with nothing to do.
				const earlier = await startRun(root);
				const [stray] = await plant(earlier, [join(root, 'a')], ['.ts']);

				await utimes(earlier.manifest, expired, expired);
				await sweepStrays(root);

				expect(await readFile(stray, 'utf8').catch(() => 'gone')).toBe('gone');
				expect(await readFile(bystander, 'utf8')).toBe(MESSY['.ts']);
				expect(await git(root, ['ls-files', '--', bystander])).toBe(
					`${relative(root, bystander)}\n`,
				);
			});
		},
		TIMEOUT,
	);

	it(
		'clears what a stale manifest lists and leaves a live one alone',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				const committed = await indexed(root);
				const expired = new Date(Date.now() - 2 * TIMEOUT);

				// The three states a killed run can leave: an intent-to-add entry, a full entry whose
				// file was tidied after staging, and an entry whose file is already gone.
				const dead = await startRun(root);
				const [intended, added, orphaned] = await plant(
					dead,
					[join(root, 'a')],
					['.ts', '.ts', '.ts'],
				);

				await git(root, ['add', '--intent-to-add', '--', intended]);
				await git(root, ['add', '--', added, orphaned]);
				await writeFile(added, TIDY);
				await rm(orphaned);
				await utimes(dead.manifest, expired, expired);

				const live = await startRun(root);
				const [peer] = await plant(live, [join(root, 'a', 'b')], ['.ts']);

				await sweepStrays(root);

				const cleared = [intended, added, orphaned, dead.manifest];
				const remains = await Promise.all(
					cleared.map(async (path) => ({
						path,
						contents: await readFile(path, 'utf8').catch(() => 'gone'),
					})),
				);

				expect(remains).toEqual(cleared.map((path) => ({ path, contents: 'gone' })));

				expect(await indexed(root)).toEqual(committed);
				expect(await readFile(peer, 'utf8')).toBe(MESSY['.ts']);
				expect(await readFile(live.manifest, 'utf8')).toBe(`${peer}\0`);
			});
		},
		TIMEOUT,
	);

	// Two sweeps sharing a checkout, forced into the two collisions a real race produces at random.
	// A manifest that vanishes between the listing and the read is a dangling link here, and a peer
	// mid-`git rm` is an `index.lock` left in place. Neither may throw, and the lock must leave every
	// listed file where it was for a later sweep.
	it(
		'survives a peer sweeping the same manifests',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				const expired = new Date(Date.now() - 2 * TIMEOUT);
				const dead = await startRun(root);
				const [stray] = await plant(dead, [join(root, 'a')], ['.ts']);

				await git(root, ['add', '--intent-to-add', '--', stray]);
				await utimes(dead.manifest, expired, expired);
				await symlink(join(root, 'no-such-manifest'), join(dirname(dead.manifest), 'vanished'));

				const lock = join(root, '.git', 'index.lock');

				await writeFile(lock, '');
				await sweepStrays(root);

				expect(await readFile(stray, 'utf8')).toBe(MESSY['.ts']);
				expect(await readFile(dead.manifest, 'utf8')).toBe(`${stray}\0`);

				await rm(lock);
				await sweepStrays(root);

				expect(await readFile(stray, 'utf8').catch(() => 'gone')).toBe('gone');
				expect(await git(root, ['ls-files', '--', stray])).toBe('');
			});
		},
		TIMEOUT,
	);

	it(
		'stages once a peer lets go of the index',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				const lock = join(root, '.git', 'index.lock');
				const path = join(root, 'a', canaryName('.ts'));

				await writeFile(path, MESSY['.ts']);
				await writeFile(lock, '');

				const staging = writeIndex(root, ['add', '--', path]);

				await new Promise((settle) => setTimeout(settle, 200));
				await rm(lock);
				await staging;

				expect(await git(root, ['ls-files', '--', path])).toBe(`${relative(root, path)}\n`);
			});
		},
		TIMEOUT,
	);

	it(
		'names the lock when the index never comes free',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				const path = join(root, 'a', canaryName('.ts'));

				await writeFile(path, MESSY['.ts']);
				await writeFile(join(root, '.git', 'index.lock'), '');

				await expect(writeIndex(root, ['add', '--', path], 300)).rejects.toThrow(
					/index\.lock still held after 300ms/,
				);
			});
		},
		TIMEOUT,
	);

	it(
		'unstages once a peer lets go of the index',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				const committed = await indexed(root);
				const lock = join(root, '.git', 'index.lock');
				const failures = await formatGuard(root, ['.ts'], {
					beforeUnstage: async () => {
						await writeFile(lock, '');
						setTimeout(() => void rm(lock, { force: true }), 200);
					},
				});

				expect(failures).toEqual([]);
				expect(await indexed(root)).toEqual(committed);
				expect(await readdir(await manifestDirectory(root))).toEqual([]);
			});
		},
		TIMEOUT,
	);

	it(
		'fails the run and keeps the manifest when the index never comes free',
		async () => {
			await inScratch('oxfmt --write', async (root) => {
				const committed = await indexed(root);
				const lock = join(root, '.git', 'index.lock');

				await expect(
					formatGuard(root, ['.ts'], {
						beforeUnstage: () => writeFile(lock, ''),
						unstageCap: 300,
					}),
				).rejects.toThrow(/index\.lock still held after 300ms/);

				await rm(lock);
				expect(await readdir(await manifestDirectory(root))).toHaveLength(1);
				expect((await indexed(root)).length).toBeGreaterThan(committed.length);
			});
		},
		TIMEOUT,
	);

	// `echo` prints no oxfmt file count, so the body throws after staging. The error that caused the
	// failure and the stuck index both have to reach the reader.
	it(
		'reports both a failed run and a stuck index',
		async () => {
			await inScratch('echo', async (root) => {
				const lock = join(root, '.git', 'index.lock');

				try {
					const rejection = await formatGuard(root, ['.ts'], {
						beforeUnstage: () => writeFile(lock, ''),
						unstageCap: 300,
					}).then(
						() => undefined,
						(error: unknown) => error,
					);

					expect(rejection).toBeInstanceOf(AggregateError);
					expect((rejection as AggregateError).errors.map((error: Error) => error.message)).toEqual(
						[
							expect.stringMatching(/^oxfmt printed no file count/),
							expect.stringMatching(/^index\.lock still held after 300ms/),
						],
					);
					expect(await readdir(await manifestDirectory(root))).toHaveLength(1);
				} finally {
					await rm(lock, { force: true });
				}
			});
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
			expect(filesTouched(await runScript(ROOT, 'format:check', import.meta.filename))).toBe(1);
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
			expect(filesTouched(await runScript(ROOT, 'format:check'))).toBeGreaterThan(100);
		},
		TIMEOUT,
	);
});
