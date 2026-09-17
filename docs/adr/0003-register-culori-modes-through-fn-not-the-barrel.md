# Register culori Modes Through `culori/fn`, Not the Barrel

`culori@4.0.2` and `chroma-js@3.2.0` have sat in `package.json` since ADR-0002 pinned the dependency baseline, unused until issue #4 makes the first call into either. The barrel `import { ... } from 'culori'` costs 23.4 kB gzip; the same working set through `culori/fn` with explicit `useMode()` registration costs 8.0 kB. The build's first-load budget measures 175.4 kB against a 200 kB ceiling, so the 24.6 kB of headroom left is barely more than the barrel alone would cost. So Cambium's colour math reaches culori only through `culori/fn`, registers exactly the modes a call site needs, and keeps chroma-js's advisory APCA figure out of every module the browser bundle can reach.

## Considered Options

### Import the Barrel and Trust the Bundler to Tree-Shake It

No registration to get right, and no way to forget a mode. The barrel wires up every converter culori knows, so `wcagContrast` always finds the path it needs, and tree-shaking is real for the parts of culori that stay unused. But "unused" is not what the barrel produces here, because `useMode` registration is a side effect of module evaluation, not a reference a bundler can trace and drop. Importing the barrel pays for the full registry regardless of which functions the code calls, and 23.4 kB against 24.6 kB of headroom leaves no room for anything else that first-load JavaScript will ever need.

### Add a Lint Rule or Import-Boundary Test Instead of an ADR

An import-boundary rule that flags `from 'culori'` and requires `culori/fn` is real, automatable, and worth having alongside this decision. But it enforces a syntax choice, not the semantic one that actually breaks. A call site can satisfy the rule, import from `culori/fn`, and still throw at runtime by registering `modeOklch` and `modeP3` without `modeLrgb`, because `wcagContrast` computes luminance through `converter('lrgb')`. That failure clears both the build and the type checker, so a lint rule that only checks the import path would report success on the exact bug this ADR exists to prevent. The rule belongs beside this decision, not in place of it.

### Ship `chroma.contrastAPCA` in the Engine

ADR-0002 already sanctions chroma-js for this one function, and having the APCA figure available everywhere the WCAG gate runs would keep the two numbers in lockstep. But that ADR settled which package computes APCA, not where the call may run. `contrastAPCA` costs 17.2 kB gzip for a single function, against a budget that has 24.6 kB to give, and nothing in the product surfaces an APCA figure to a user today. WCAG 3's own working draft has not even decided whether APCA survives into the standard it names. Paying full bundle price for a number nobody sees yet, ahead of a spec that might change its formula, is the wrong trade. The advisory figure stays where it costs nothing: dev-only scripts and test code.

## Consequences

Every colour-math call site registers `modeRgb`, `modeLrgb`, `modeOklch`, and `modeP3` before it calls `converter`, `toGamut`, `clampChroma`, or `wcagContrast`, and that registration lives in one module the engine imports first, not scattered across every call site. `modeLrgb` is not optional. `wcagContrast` computes luminance through `converter('lrgb')` internally, so a registration set built by guessing which modes a call site touches builds and typechecks cleanly, then throws `TypeError: converters.rgb[target_mode] is not a function` the first time someone actually calls it. Adding a fifth mode for a new call site is a deliberate line in that registration module, never an incidental import dropped in wherever it happens to compile.

APCA belongs to scripts and tests, never to a module the browser bundle can reach. `chroma.contrastAPCA` computes the figure in dev-only tooling and in the test suite that checks it against culori's WCAG numbers; the production engine gates on WCAG through culori alone, and never imports chroma-js for anything a user's browser downloads.

`pnpm test` runs the `unit` Vitest project only; the bundle budget lives in the separate `bundle` project that `pnpm test:bundle` runs, and only `pnpm verify` chains `build` and `test:bundle` together. A contributor who adds a culori or chroma-js import and runs `pnpm test` alone sees green and has not checked the one thing this decision depends on. Run `pnpm verify` before trusting that a colour-math change stays inside budget.

`docs/research/oss-landscape.md` holds the measurements this ADR relies on: the 23.4 kB barrel cost, the 8.0 kB registered working set, the 1.6 kB floor, and the `chroma-js/light` subpath that resolves nowhere despite appearing in the package's `exports` map. Always import `chroma-js` from its main entry instead. This ADR holds the policy those measurements justify; the research notes hold the evidence. When culori or chroma-js ships a new version, re-measure in the research notes first. This file changes only when the policy itself changes, not when a number does.
