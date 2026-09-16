# Testing

Issue #1's "Testing Decisions" section is the authority. This file is the working summary; where the two disagree, the issue wins.

## What makes a good test here

Tests assert external behavior at a seam, never implementation details. A test should survive a rewrite of the thing it tests.

Assert that a given seed produces a token set whose `border` token resolves to primitive step 6 and passes AA against its surface. Do not assert which function computed it, in what order, or through which intermediate structure.

The seam count is kept deliberately low. Two seams, one of them four methods wide.

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

## Deliberately not tested automatically

Reader implementations. Once seed parsing moved into the core, they are I/O shells with no logic left to test.

The UI. Verify it by hand against the five demonstrable runs in issue #1's completion criteria. There is no e2e tier and Playwright is not a dependency. Component tests against a prototype interface that is still moving cost more than they return, and speed matters more here.

Both are tradeoffs the spec makes on purpose. Leave them alone rather than filing them as missing coverage.

## Tooling

`pnpm test` runs once, `pnpm test:watch` watches. `vitest.config.ts` sets the node environment and matches `**/*.test.ts`. Co-locating a test beside the code it covers is convention rather than configuration, so follow what `core/` does.

Contrast assertions are plain Vitest against the math, because the generator is a pure function. Routing them through axe instead would mean mounting and styling DOM nodes to divide two luminance numbers, and it answers the question far more slowly.

Rendered-component accessibility is a real need that arrives with the UI tickets. axe-core measures *rendered* accessibility, and jsdom resolves no cascade and does no layout, so those checks belong in Vitest browser mode with axe-core called directly. None of it exists today: `@vitest/browser`, `@vitest/browser-playwright`, `playwright`, and `axe-core` all still need adding when those tickets land. Call `axe.run()` and assert on the result; a ten-line local matcher replaces the wrapper.

Reach for axe-core directly. Its popular wrapper `vitest-axe` is abandoned—the `latest` tag points at a 2022 build, and the maintainer has not answered since early 2025—so do not install it, or `@types/jest-axe`.

## Undefined

Two things the project has not decided. Don't infer either one.

No coverage thresholds are configured, and no target is written down anywhere. Nothing in this repo requires writing tests before implementation either, so TDD is not a documented convention here.
