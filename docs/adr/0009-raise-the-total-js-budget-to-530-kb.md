# Raise the Total-JS Budget to 530 kB

On `main` at `1bebbdd` the static export measures 476.3 kB of JavaScript against the 500 kB total budget in `lib/bundle-budget.ts`. Wave 2 adds two features to it. #40 adds 19.2 kB: 16.0 kB for the export pane and 3.1 kB for the demo picker. #158 adds 17.9 kB by rendering `GeneratePanel` in the workspace for a record with no versions. Merged, the two measure 513.4 kB (`.git/work-wave/wave-40-158/merge-test/2.md`). So the total rises to 530 kB on #158's branch, and first-load stays at 200 kB.

Most of #158's cost is a second copy of code the landing route already ships. Turbopack builds one async chunk tree per dynamic-import path. It leaves out of each tree only the modules already loaded on that path. Two paths share a chunk file only when their module sets come out identical. `components/landing/landing-route.tsx` and `components/workspace/first-version.tsx` each reach `generate-panel` through their own `lazy()`, one under `/`'s first load and one under the workspace shell's chunk. The build therefore emits the panel twice. It also emits a second copy of each nested `import()` under the panel: `describe-failure` (3.5 kB), the generate module with its seed tool and font loader (10.0 kB), and the key dialog (1.2 kB). The cost estimate is the only nested chunk whose module set matches, and it ships once.

## Considered Options

### Link the Workspace to `/?record=`

The workspace could link a record with no versions to `/?record=<id>`. The landing route already renders `GeneratePanel` there and pushes to `/workspace` on success. That would add little beyond the link itself, but the person would leave the workspace to generate. The landing's copy around the panel assumes the person just saved their images, which isn't true of someone arriving from a record they opened. #158's acceptance criterion asks for a Generate control in the workspace, so it would have to be weakened to accept a link. #157 and #174 in wave 3 are planned against the embedded panel and would need planning again.

### Dedupe Within the Build

Each attempt was built and measured on #158 alone, against its 494.3 kB:

- A static import of `GeneratePanel` in `first-version.tsx` measures 493.9 kB. The panel moves into the shell chunk and its nested chunks still ship twice.
- One shared module holding the `lazy()` for both routes measures 494.3 kB. Turbopack scopes the chunk tree by the path to the importing module, so sharing the import site changes nothing.
- `experimental.turbopackClientSideNestedAsyncChunking: false` takes `main` to 484.7 kB and #158 to 504.6 kB. Async chunks across the app grow by more than the duplicate costs.
- Importing `core/brand-url` and `core/image-tag` into `first-version.tsx` puts those modules on the workspace path. The `describe-failure` chunk then matches the landing's and ships once, for 490.9 kB. Those imports exist only to steer the chunker, and 490.9 kB still leaves the merged tree over 500 kB.

### Hold 500 kB and Find Savings First

The known candidate is the 25 kB of Floating UI that #28's popover brought into the workspace chunk. Replacing it is its own piece of work with its own trade-offs, and it would hold both wave 2 features until it landed.

## Consequences

`TOTAL_JS_BUDGET_BYTES` is `530_000`, and the `bundle-budget.ts` docblock records the rise beside the last one. That leaves about 16.6 kB of headroom after wave 2. First-load stays at 200 kB. Each PR still states its measured delta against `main`, and a change that would pass 530 kB fails the same test that stopped this wave at 513.4 kB.
