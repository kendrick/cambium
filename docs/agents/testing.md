# Testing

Issue #1's "Testing Decisions" section is the authority. This file is the working summary; where the two disagree, the issue wins.

## What makes a good test here

Tests assert external behavior at a seam, never implementation details. A test should survive a rewrite of the thing it tests.

Assert that a given seed produces a token set whose `border` token resolves to primitive step 6 and passes AA against its surface. Do not assert which function computed it, in what order, or through which intermediate structure.

## Where the seam actually is

The section above says a test asserts behavior at a seam, without saying where the seam sits. Five P2 defects in one wave came from drawing it a layer too early.

| Defect | What the test asserted | Who consumes the value |
|---|---|---|
| #70 quantization straddle | contrast between full-precision OKLCH values | the 8-bit pixel a browser paints |
| #75 invisible shadow | OKLCH lightness interpolated linearly | a compositor blending per channel in sRGB |
| #75 schema version | the shape validates today | v5 code opening a v4 archive |
| #75 divergent mirror | each copy valid on its own | two adapters reading different copies |
| #75 negative dimension | a number carrying a unit | a CSS parser rejecting a negative `border-radius` |

Each value was correct in our representation and wrong the moment something else evaluated it. Every test ran inside the source language.

Where a value crosses into something this repo does not control—a browser compositor, a CSS parser, an archive a later version opens, a second adapter—that crossing is the seam. The assertion protecting it belongs in the consumer's units. Assert the composited pixel, not the declared color. Assert the parsed archive, not the schema that produced it.

The shadow defect is worth walking through. It shipped invisible four times, and every round passed ten specs written test-first, because all ten measured a quantity no browser paints. The first three rounds asserted the color the token file declares and said nothing about what lands on the page. The fourth did composite the shadow over its page, then mixed the two OKLCH lightnesses linearly while a browser composites per channel in sRGB. That gap reaches 88% on a dark page and always errs toward the flattering answer. Four rounds of fixes moved the numbers and left the pixels alone.

The gates already running could not reach that class. The Spec axis of `code-review` compares a diff against its spec, and the spec speaks our language too, so "shadow tinted by the surface" passed with an invisible shadow. The Standards axis reads the source for documented violations and design smells, and never leaves the source to ask what a consumer makes of the output. Test-first only guarantees that the test came first, and says nothing about whose units it measures. An outside reviewer with no stake in our intentions found all five, after three internal passes had missed them. So the check also sits in `AGENTS.md`, which the Standards axis reads as a repo standards source. #76 has the full post-mortem.

## Reaching a branch is not covering it

The coverage minimums below say which behaviors a fixture has to reach, without saying whether reaching one proves anything. A fixture can run a branch while the right answer and a wrong one come out identical.

#79 is the case. A shadow with no stated `shadowCharacter` takes its provenance from the page surface rather than naming a seed field outright, because that surface traces to `neutralTemperature` when the seed stated one and to `keyColors` when it did not. The code named `keyColors` outright, and it stayed wrong through five review rounds. Both arms of the branch ran the whole time: `STATED_SEED` states a shadow character and takes the stated arm, `KEYLESS_SEED` states none and takes the fallback. `KEYLESS_SEED` also leaves `neutralTemperature` null, so its surface traces to `keyColors` as well, and inheriting that field produces the same payload as hard-coding it. `KEYLESS_SEED` reached the broken line and had no way to fail on it.

A coverage tool reports that a line ran. It cannot report whether the test could have failed there. Those are different measurements, and branch coverage reports only the first.

Cover each branch in a configuration where a wrong answer differs from a right one. A fixture that reaches a branch and cannot tell its outcomes apart has not covered it.

Verify that with a mutation: break the branch, then confirm a test fails. Swapping `inheritedFrom(surface.provenance, …)` back to `derived('keyColors', …)` in `core/shadow-scale.ts` and running `pnpm test` leaves 1128 of 1131 tests passing, and all three failures arrived with the fix in #79. One of them is the `it.each` in `core/shadow-scale.test.ts` whose `keyColors` leg passes against the broken code while its `neutralTemperature` leg fails—one parameterized test, two legs, one of which can tell right from wrong. That run takes seconds and settles what those five review rounds did not, because a fixture that cannot fail looks exactly like one that can.

`MIXED_SEED` in `core/provenance.test.ts` is the worked example in the tree: the one seed shape that states a neutral temperature and no shadow character, so the surface it builds traces somewhere the hard-coded answer cannot reach. Its docblock carries the rest of the story.

The criterion bites hardest where fixtures are expensive to change and where the output is a classification rather than a number. #105 designs the image fixtures the whole browser tier runs against. Any ticket producing a derived classification—provenance, a contrast verdict, a role assignment—has the shadow's shape: two rules can agree on every input a fixture happens to carry, and only a fixture chosen to separate them says which rule is running.

## Seam 1: the pure core

Pure TypeScript, no DOM, no network, no storage:

- `parseSeed(rawResponse) → BrandSeed`
- `generate(seed, options) → ExportBundle`
- `serializeRecord` / `deserializeRecord`, which puts the export-clear-import round trip at the same seam

That purity is itself asserted, not just intended: `core/purity.test.ts` parses each schema with no browser global in scope, so a stray DOM or storage reference fails a test rather than surfacing later in the headless CLI.

This one seam covers everything that can be interestingly wrong: seed schema validation, the 12-step primitive ramp, semantic aliasing, independent light and dark derivation, OKLCH contrast repair, provenance, `$extensions`, interpretation presets, and all six export adapters. Hand-authored fixtures drive that seam: the `RawReaderResponse` envelopes under `core/fixtures/raw-responses/`, and the shared token-set halves in `core/token-set.fixture.ts`. No script writes either one. #18 adds the first fixture generator, so revisit this line when #18 lands.

Coverage here should include, at minimum:

- every generated ramp hits its Radix step role targets within tolerance
- every declared contrast pair passes AA in both schemes after repair
- pinned seed values appear unmodified in output, and repairs adjust the opposite side of the pair
- identical seeds produce identical token sets
- each export adapter produces a document that parses and contains the expected semantic keys
- canonical DTCG validates against the published DTCG JSON Schema
- a serialize-deserialize round trip is lossless

Reaching each of those is the weaker half of the job. Choose fixtures that also satisfy the criterion above, so that a wrong implementation of any minimum changes what that minimum's consumer reports. Which consumer that is differs from bullet to bullet, and "Where the seam actually is" is how to find it. The token set is the output for some of these and the input to others, and where it is the input a broken implementation leaves it byte-identical while the document it emitted is wrong.

Two patterns are worth borrowing from unbranded-ds, the only prior art the issue names: validate a generated baseline by regenerate-and-diff, and enforce declared contrast pairs at build time.

## Seam 2: RecordStore

One shared contract suite over the four interface methods, in `app/storage/record-store-contract.ts`. Two implementations run it today: the in-memory store, and the IndexedDB store under `fake-indexeddb` in Node. A future HTTP implementation should run the same suite unchanged, so keep the suite implementation-blind.

## The browser tier

Playwright is the only browser runner. Vitest gets no browser tier: it keeps whatever runs Node-side, and more kinds keep arriving. Today that means the pure core, the RecordStore contract under `fake-indexeddb`, the bundle measurement, and `package-scripts.test.ts`, which spawns `pnpm` as a subprocess and costs seconds where the rest cost milliseconds. The `cat.color` rule family the interface audit needs is inert under jsdom, which does no layout and resolves no cascade, and run 4 exercises real IndexedDB and real file handling that `fake-indexeddb` cannot prove. Once a browser is running for both, `@axe-core/playwright` covers the audit in the same suite and a second runner earns nothing. Static export keeps the cost down: build, serve `out/` as files, point a browser at it.

One spec measures a core adapter rather than a route. `e2e/stylesheet-dark.spec.ts` compiles `toStylesheet`'s output with the pinned `@tailwindcss/postcss`, loads it through `page.setContent()`, and reads computed colours and shadows, because a cascade question only a browser answers has no route to drive yet. It rides the same fixtures and server as the rest of the suite, and like the rest it sits outside `pnpm verify`.

The suite automates runs 1, 2, and 4 of issue #1's five demonstrable runs. Run 1 needs no key and no network, run 2 runs with the model call intercepted at the route rather than against a real key, and run 4 needs a browser. Run 3 stays manual, because a person looking at the rendered theme is the step that proves the output is real rather than merely plausible; #49 adds a contract test asserting the generated unbranded-ds theme document against that project's registration input, so shape drift fails on its own. Run 5 is the existing core suite and does not change.

The harness lands before the routes it has to drive. #104 stands one up on its own: serve `out/`, open the route, drive real events, wipe IndexedDB between scenarios, fail a scenario on a console error. #23 and #24 wait on it. #105 builds the image fixtures #106's scenarios need, malformed, renamed, oversized and truncated, and #106 backfills the five defects #22 shipped. #47 then automates the keyed path as far as v1 reaches, and #48 extends it to the keyless demo, the round trip, and contrast repair once those features exist. `pnpm install` brings the Playwright client library and no browser binaries, so #104 owns getting one installed. The form is `pnpm exec playwright install chromium`, for two reasons `docs/agents/commands.md` sets out in full. `npx` without `--no-install` fetches whatever the registry calls that package when the local binary is absent, where `pnpm exec` fails loudly instead. And a bare `playwright install` downloads Chromium, Firefox, and WebKit, two of which this config never opens.

That order is a decision, and #86 carries the argument for it. #47 owned the harness and the first tests written against it. Its acceptance criteria drive flows that #23, #24, #25 and #29 build, so it waits on all of them, and the harness waited with it. Those #22 defects had already shipped with nothing in this repo able to reach them, and #23 and #24 were queued behind the same gap. The harness itself depends on nothing, which is why it split out into #104 and went first.

The rule for the next tier: where one ticket owns both a harness and the first tests written against it, and those tests drive features nobody has built yet, the harness arrives after the work it was meant to protect. Give the harness a ticket of its own.

## Deliberately not tested automatically

Reader implementations, to the extent they stay I/O shells. Moving seed parsing into the core was supposed to leave nothing behind worth testing, and for a reader that only builds a request and hands back a string, it does.

The Anthropic reader turned out not to be one. #17 gave it a status-to-kind error taxonomy, a normalizer that has to read two different response envelopes, and a JSON Schema that has to agree with `BrandSeedSchema` or every generation fails at the trust boundary. That is logic, and #17's acceptance criteria ask for it to be covered: "every error path has a test", against recorded responses with no live call. So `app/readers/` has a Vitest suite, driven by the fixtures in `app/readers/fixtures/` through an injected `fetch`.

Test whatever logic a reader has accumulated. Being able to make an HTTP request is not logic, so a reader that only builds a request and hands back a string still gets no tests.

Component tests. The interface is still moving, and tests against a prototype interface cost more than they return. That rejects component tests rather than testing the interface: the five runs are flows against the definition of done, which is the one part of the spec that should not move, and three of them are automated in the Playwright suite above.

Both exclusions are tradeoffs the spec makes on purpose. Leave them alone rather than filing them as missing coverage, and read the reader carve-out above as narrowing the first one rather than reopening it.

## Tooling

`pnpm test` runs the unit project once and `pnpm test:watch` watches it. `pnpm test:bundle` measures a real build against the budget in `lib/bundle-budget.ts`, and `pnpm verify` chains typecheck, lint, format, tests, build, and that budget. `vitest.config.ts` holds the rest. Co-locate a test beside the code it covers. That is convention rather than configuration, so the config will not tell you, and `core/` is the pattern to follow.

`pnpm test:e2e` runs the browser suite, and it is not one of `verify`'s links. That follows from the browser tier above: `pnpm install` brings no browser, so a `verify` that ran the suite would fail on a fresh checkout for want of a binary rather than for anything in the diff. Run it yourself, after `pnpm build`, since it serves `out/`. It writes `test-results/`, which is gitignored and has to stay gitignored, or `verify` starts failing on the leftovers. `docs/agents/commands.md` has that mechanism.

Vitest runs two projects. `unit` is everything except `**/*.bundle.test.ts`, and `bundle` is that glob alone, which needs a real `out/` and so stays out of the default run. Keep new test files `.ts`, because the include glob does not match `.test.tsx`.

Contrast assertions are plain Vitest against the math, because the generator is a pure function. Routing them through axe instead would mean mounting and styling DOM nodes to divide two luminance numbers, and it answers the question far more slowly.

Rendered-component accessibility goes through `@axe-core/playwright` inside the Playwright suite, never through Vitest. axe-core measures *rendered* accessibility, and jsdom resolves no cascade and does no layout. `@playwright/test` and `@axe-core/playwright` are pinned; `@vitest/browser` and `@vitest/browser-playwright` are not installed and must not be, because one runner already covers both jobs. That supersedes section 8 of `docs/research/oss-landscape.md`, which recommends Vitest browser mode with a provider package: it answered how to run axe, and the tier question changed the answer.

`@axe-core/playwright` is the only axe wrapper here. Its Vitest counterpart `vitest-axe` is abandoned—the `latest` tag points at a 2022 build, and the maintainer has not answered since early 2025—so do not install it, or `@types/jest-axe`.

## Test-first

Required for the pure core, and left to the contributor everywhere else.

The core is where behaviour is written down before it is built. The seed schema, the twelve-step ramps, contrast repair, and the export adapters all have their expected output specified in issue #1 before any code exists. The interface does not, and the spec says it is still moving.

## Undefined

One thing the project has not decided. Ask before it becomes an assumption.

No coverage thresholds are configured, and no target is written down anywhere.
