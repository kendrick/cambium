# Testing

Issue #1's "Testing Decisions" section is the authority. This file is the working summary; where the two disagree, the issue wins.

## What makes a good test here

Tests assert external behavior at a seam, never implementation details. A test should survive a rewrite of the thing it tests.

Assert that a given seed produces a token set whose `border` token resolves to primitive step 6 and passes AA against its surface. Do not assert which function computed it, in what order, or through which intermediate structure.

## Seam 1: the pure core

Pure TypeScript, no DOM, no network, no storage:

- `parseSeed(rawResponse) → BrandSeed`
- `generate(seed, options) → ExportBundle`
- `serializeRecord` / `deserializeRecord`, which puts the export-clear-import round trip at the same seam

That purity is itself asserted, not just intended: `core/purity.test.ts` parses each schema with no browser global in scope, so a stray DOM or storage reference fails a test rather than surfacing later in the headless CLI.

This one seam covers everything that can be interestingly wrong: seed schema validation, the 12-step primitive ramp, semantic aliasing, independent light and dark derivation, OKLCH contrast repair, provenance, `$extensions`, interpretation presets, and all six export adapters. Fixture seeds and recorded raw responses drive it, both produced by the fixture generation script.

Coverage here should include, at minimum:

- every generated ramp hits its Radix step role targets within tolerance
- every declared contrast pair passes AA in both schemes after repair
- pinned seed values appear unmodified in output, and repairs adjust the opposite side of the pair
- identical seeds produce identical token sets
- each export adapter produces a document that parses and contains the expected semantic keys
- canonical DTCG validates against the published DTCG JSON Schema
- a serialize-deserialize round trip is lossless

Two patterns are worth borrowing from unbranded-ds, the only prior art the issue names: validate a generated baseline by regenerate-and-diff, and enforce declared contrast pairs at build time.

## Seam 2: RecordStore

One shared contract suite over the four interface methods, run against the IndexedDB implementation under `fake-indexeddb` in Node. The whole point is that a future HTTP implementation runs that suite unchanged, so keep the suite implementation-blind.

## The browser tier

Playwright is the only browser runner, and Vitest keeps the pure core and nothing else. The `cat.color` rule family the interface audit needs is inert under jsdom, which does no layout and resolves no cascade, and run 4 exercises real IndexedDB and real file handling that `fake-indexeddb` cannot prove. Once a browser is running for both, `@axe-core/playwright` covers the audit in the same suite and a second runner earns nothing. Static export keeps the cost down: build, serve `out/` as files, point a browser at it.

The suite automates runs 1, 2, and 4 of issue #1's five demonstrable runs. Run 1 needs no key and no network, run 2 runs with the model call intercepted at the route rather than against a real key, and run 4 needs a browser. Run 3 stays manual, because a person looking at the rendered theme is the step that proves the output is real rather than merely plausible; #49 adds a contract test asserting the generated unbranded-ds theme document against that project's registration input, so shape drift fails on its own. Run 5 is the existing core suite and does not change.

The suite arrives in two parts. #47 stands up the harness and automates the keyed path as far as v1 reaches; #48 extends it to the keyless demo, the round trip, and contrast repair once those features exist. `pnpm install` brings the Playwright client library and no browser binaries, so #47 owns running `npx playwright install`.

## Deliberately not tested automatically

Reader implementations. Once seed parsing moved into the core, they are I/O shells with no logic left to test.

Component tests. The interface is still moving, and tests against a prototype interface cost more than they return. That rejects component tests rather than testing the interface: the five runs are flows against the definition of done, which is the one part of the spec that should not move, and they run in the Playwright suite above.

Both are tradeoffs the spec makes on purpose. Leave them alone rather than filing them as missing coverage.

## Tooling

`pnpm test` runs the unit project once and `pnpm test:watch` watches it. `pnpm test:bundle` measures a real build against the budget in `lib/bundle-budget.ts`, and `pnpm verify` chains typecheck, lint, format, tests, build, and that budget. `vitest.config.ts` holds the rest. Co-locate a test beside the code it covers. That is convention rather than configuration, so the config will not tell you, and `core/` is the pattern to follow.

Vitest runs two projects. `unit` is everything except `**/*.bundle.test.ts`, and `bundle` is that glob alone, which needs a real `out/` and so stays out of the default run. Keep new test files `.ts`, because the include glob does not match `.test.tsx`.

Contrast assertions are plain Vitest against the math, because the generator is a pure function. Routing them through axe instead would mean mounting and styling DOM nodes to divide two luminance numbers, and it answers the question far more slowly.

Rendered-component accessibility goes through `@axe-core/playwright` inside the Playwright suite, never through Vitest. axe-core measures *rendered* accessibility, and jsdom resolves no cascade and does no layout. `@playwright/test` and `@axe-core/playwright` are pinned; `@vitest/browser` and `@vitest/browser-playwright` are not installed and must not be, because one runner already covers both jobs. That supersedes section 8 of `docs/research/oss-landscape.md`, which recommends Vitest browser mode with a provider package: it answered how to run axe, and the tier question changed the answer.

Reach for axe-core directly. Its popular wrapper `vitest-axe` is abandoned—the `latest` tag points at a 2022 build, and the maintainer has not answered since early 2025—so do not install it, or `@types/jest-axe`.

## Test-first

Required for the pure core, and left to the contributor everywhere else.

The core is where behaviour is written down before it is built. The seed schema, the twelve-step ramps, contrast repair, and the export adapters all have their expected output specified in issue #1 before any code exists. The interface does not, and the spec says it is still moving.

## Undefined

One thing the project has not decided. Ask before it becomes an assumption.

No coverage thresholds are configured, and no target is written down anywhere.
