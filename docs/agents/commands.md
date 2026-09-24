# Commands

What every `package.json` script does with a path argument. The answers differ from script to script, and the dangerous ones are silent: two scripts rewrite every file they can reach when called bare, and one test invocation reports a full-suite pass while looking like it ran a single file.

`AGENTS.md` carries the rule this page serves. Read that first; this is the lookup table behind it.

## How an argument reaches a script

pnpm appends what you type to the end of the script string. There are no positionals, so `"$@"` inside a script expands to nothing, and a script that already names its own target leaves your argument nowhere useful to land.

Every `pnpm run` echoes the command it is about to run, which is the fastest answer whenever a script surprises you. `pnpm verify core/purity.test.ts` prints:

```
> pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm test:bundle core/purity.test.ts
```

`--` is not an argument separator here. pnpm forwards it as a literal argument and whatever receives it has to cope. `pnpm test -- core/purity.test.ts` hands Vitest a `--` and Vitest stops filtering; `pnpm generate -- scripts/fixtures/seed.json` hands the script `--` as its seed path.

## What each script does with a path

Listed in `package.json` order.

| Script | A path argument | Detail |
|---|---|---|
| `dev` | fails loudly | Next reads the positional as its project root: `No such directory exists as the project root: <repo>/core/purity.test.ts`. |
| `build` | fails quietly | Same positional. Exits 1 after printing `Time: 14ms \| Errors: 6` and no error detail at all. |
| `postbuild` | is ignored | `scripts/write-nojekyll.mjs` reads no `argv`. |
| `typecheck` | fails loudly | tsc reads it as a file list and refuses: `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline.` Exit 1. |
| `lint` | scopes | The script is just `oxlint`, so the path reaches it as a target. |
| `lint:fix` | scopes | Called bare, it rewrites every file it can fix. |
| `format` | scopes | Called bare, it rewrites the tree. |
| `format:check` | scopes | Reads only, so it is safe either way. |
| `test` | scopes | Reaches Vitest as a filter. A `--` in front of the path defeats it and runs the whole unit project, which then reports a full-suite pass that reads exactly like the scoped one. |
| `test:watch` | scopes | The same filter as `test`, and the same `--` trap. |
| `test:bundle` | scopes, to the `bundle` project | That project is `**/*.bundle.test.ts` alone, so an ordinary test path matches nothing and exits 1. |
| `test:e2e` | scopes | Reaches Playwright as a regex matched against each spec file's path, the same `--` trap as `test`: `pnpm test:e2e smoke` runs only `e2e/smoke.spec.ts`, `pnpm test:e2e -- smoke` runs the whole suite instead. A path matching nothing exits 1: `Error: No tests found`. Runs against `out/`, the export `pnpm build` writes; `scripts/serve-out.mjs` exits 1 naming `out/`, before a browser opens, if the export is missing. |
| `dtcg:refresh` | is ignored | Reads no `argv`. Fetches over the network and overwrites `core/dtcg/format.2025.10.json`. |
| `dtcg:build` | is the output target | `process.argv[2]`, at `scripts/build-dtcg-validator.mjs:23`. Called bare, it overwrites the committed `core/dtcg/format-validator.generated.mjs`. |
| `swatches` | is ignored | `scripts/swatches.mjs` reads no `argv`. |
| `generate` | is the seed file | `process.argv[2]`, through `runCli` in `scripts/lib/cli.mjs`. Called bare, it prints `usage: generate <seed-file.json>` and exits 1. |
| `evaluate` | is the seed file | The same `runCli`. Writes `swatches/seed.html`, which is gitignored. |
| `verify` | reaches only `test:bundle` | pnpm appends the argument to the end of an `&&` chain, so the first five links run unscoped and the last one runs filtered. |

## The browser `test:e2e` needs first

`pnpm install` puts `@playwright/test` in `node_modules`; it does not put a browser anywhere. Playwright keeps browser binaries in a cache outside the repo (`~/Library/Caches/ms-playwright` on macOS), versioned per Playwright release, so a checkout that has run `pnpm install` still fails the first `test:e2e` on a missing binary rather than a missing package.

Install one with:

```
pnpm exec playwright install chromium
```

`playwright.config.ts` declares a single project, `chromium`, so that is the only browser the suite ever launches. The bare `playwright install`, with no browser named, downloads Chromium, Firefox, and WebKit — two of which `test:e2e` never opens.

`pnpm exec` over a bare `npx playwright install`: both resolve to the same local binary here, because `pnpm install` already placed it in `node_modules/.bin`, but that is the only reason they agree. Point `pnpm exec` at a binary that is not there and it fails loudly, `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`; `npx` without `--no-install` falls back to fetching whatever the registry calls that package and running that instead. The rest of this table already runs everything through `pnpm exec` or a `pnpm` script for the same reason — this is not a special case for Playwright.

## The scripts that write

`format` and `lint:fix` write across the whole tree when called bare, and both take a path, so give them one. `dtcg:build` and `dtcg:refresh` overwrite committed files, `dtcg:refresh` from the network, and neither belongs inside a task that did not ask for it. `evaluate` writes `swatches/seed.html`, which git ignores.

`test:e2e` writes `test-results/` at the repo root. That is Playwright's `outputDir`, and the `list` reporter does not switch it off: `.last-run.json` lands on every run, and an `error-context.md` lands under a per-scenario directory for every scenario that fails. A fully green run writes both, because `e2e/console-gate.spec.ts` is marked `test.fail()` and a scenario that fails on purpose still leaves its error context behind.

`.gitignore` covers that directory and has to keep covering it. oxfmt reads `.gitignore`, `verify` chains `format:check`, and `.last-run.json` is JSON that oxfmt formats. Drop the rule and the next `pnpm format:check` after any browser run reports `test-results/.last-run.json (13ms)` and exits 1, taking `pnpm verify` down with it over a file no diff produced. `error-context.md` is quieter: `.oxfmtrc.json` ignores markdown, so it never reaches `format:check` and shows up only as untracked noise in `git status`.

## Working forms worth memorising

```
pnpm format core/token-set.ts
pnpm format:check core/token-set.ts
pnpm test core/purity.test.ts
pnpm exec vitest run --project unit core/purity.test.ts
pnpm exec oxlint core/purity.test.ts
pnpm exec playwright install chromium
pnpm build && pnpm test:e2e e2e/smoke.spec.ts
```

`package-scripts.test.ts` at the repo root holds both `format` and `format:check` to these forms. It spawns the real command, because what reads a script string is pnpm's runner and then oxfmt, and neither reads `package.json` the way a test asserting on `package.json` would assume. It then reads the working tree rather than the summary oxfmt prints, because a script can rewrite every file in the repo and still report `on 1 files`. The writing form runs against a temp file outside the repo, and nothing in the suite runs a bare `pnpm format`, because a test run is no better placed to rewrite the tree than a dispatched task is.

Reading the tree means planting something to read. The test writes a deliberately mis-formatted fixture into every directory oxfmt walks, one for each extension oxfmt formats, and deletes them all when it finishes. Close to five hundred files, for about a second. It finds those directories by asking oxfmt rather than git: one probe file per directory, a level at a time, and `oxfmt --list-different` says which ones it reached. Git's ignore rules differ from oxfmt's in ways that are hard to predict, `core.ignorecase` among them, and a directory git prunes but oxfmt formats would otherwise get no fixture.

Every fixture names the test that wrote it on its first line, in a comment or, for JSON, a key, so a stray one left behind by a killed run explains itself. Before writing anything, a run lists every path it is about to create in a manifest under the git directory (`git rev-parse --git-path package-scripts-canaries`), which `git status` never shows. A later run deletes what a dead run's manifest lists and nothing else. A file no manifest names is safe whatever it is called or holds, which is what stops the sweep from taking a staged file that only looks like a fixture. The sweep runs on a later run, not necessarily the next one: a manifest younger than the test's own timeout is left alone, so that two runs sharing a checkout cannot delete each other's fixtures. If a killed run has left `pnpm format:check` red, rerunning the suite inside the next thirty seconds will not clear it. Wait, or delete the files by hand. Fixtures from runs older than the manifest have no manifest at all, so those are always yours to delete by hand.

The guard samples rather than proves. It catches evasions that have been demonstrated against it, and a script selecting files by any predicate that tells a canary from a real file still gets through. Excluding the canary name shape is enough to do it. `package-scripts.test.ts` lists the known escapes beside the test, and that list is open by construction, because a canary has to be tellable from a real file to work at all. What keeps the guard worth running is that oxfmt skips a file already matching its output, so the writes it cannot see are writes that change nothing.

For the length of that test the checkout fails `format:check`. Start `pnpm test` while a separate `pnpm verify` or `pnpm format:check` is running and you can fail that other process on fixtures that were never its business. It runs the other way too. A bare `pnpm format` alongside the test tidies the fixtures and fails the test instead.

Inside that window sits a shorter one. The fixtures go into the git index for the length of a single `pnpm format` run, which is how the guard catches a script that formats the output of `git ls-files` or `git diff --cached` instead of walking the tree. Most go in with `--intent-to-add`, which `git ls-files` sees and `git diff --cached` does not, so one goes in fully. While they sit there, a `git commit -a` in the same checkout carries all of them into your commit, and a plain `git commit` carries the one. That is the reason to let `pnpm test` finish rather than committing over the top of it. The test waits up to five seconds for another git's `index.lock` before unstaging them. If the lock is still there after that, the test fails with an error naming the lock and keeps its manifest, and the staged fixture stays put until a later run sweeps it. A lock that never clears is usually left behind by a crashed git: delete `index.lock` if no git is running, and rerun the suite once the thirty-second window has passed.

All of this would go away if the fixtures lived somewhere private, and neither cure is worth its price. A sandbox the bare tree walk cannot see is one the write under test cannot see either, so it disarms the guard. A separate worktree keeps the guard working and pays for it with an install of its own before `pnpm format` will run there at all.
