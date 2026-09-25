# Ship the APCA Figure in the Workspace Chunk

ADR-0003 kept chroma-js's `contrastAPCA` out of every module the browser bundle can reach, because it cost 17.2 kB gzip of first-load budget for a number no user saw. Issue #8 changes the second half of that. Its contrast report carries an APCA Lc beside every WCAG ratio, as data an interface renders without recomputing, and the workspace store builds that report on every derivation. So `core/contrast/check.ts` now imports APCA, and the store carries it to the browser. This ADR supersedes ADR-0003's APCA clause and its rule to import chroma-js only from its main entry. The culori policy in ADR-0003 stands unchanged.

The cost moved too. The store loads only through the dynamic `import()` in `components/workspace/workspace-route.tsx`, so APCA rides the lazy workspace chunk, and first load on `/` and `/workspace` stays at 198.0 kB and 193.9 kB. The total-JS budget is where it lands. Through chroma-js's package index, #8 put the build at 460.2 kB against the 450 kB budget in `lib/bundle-budget.ts`, because the index evaluates the whole library. Through the deep module `chroma-js/src/utils/contrastAPCA.js`, the build measures 449.0 kB, against 442.6 kB on `main` before #8.

## Considered Options

### Keep APCA Out of the Browser and Inject It

`checkContrast` could take the APCA function as an optional argument that `scripts/` and tests supply, so the store checks WCAG alone and chroma-js never reaches a browser chunk. That honours ADR-0003 and frees the bytes. It also leaves the store's `contrast` report without the figure #8 asks it to carry, so every interface that shows Lc (#27, and #29's downloads) would have to load chroma-js on its own path to compute what the report was meant to hold.

### Import the Package Index and Raise the Budget

This takes the least code and keeps ADR-0003's main-entry rule. It also spends about 11 kB of total budget on chroma-js modules the check never calls, and it raises a ceiling that exists to catch exactly that.

## Consequences

`core/contrast/check.ts` imports `chroma-js/src/utils/contrastAPCA.js`, which is in chroma-js's own `exports` map. It also imports three side-effect modules that register hex parsing, `rgb()`, and `alpha()` on chroma-js's `Color` class. Without them, `contrastAPCA` throws `unknown format` on its first hex argument. Unlike the `chroma-js/light` subpath ADR-0003 found resolving nowhere, these resolve and run: `core/contrast/check.test.ts` asserts the published Lc 106 for black on white through them. `.oxlintrc.json` allows exactly those three paths past `import/no-unassigned-import`. A chroma-js upgrade that moves its `src/` layout breaks this import loudly at build time, so re-measure then, as ADR-0003 already asks.

APCA stays advisory. `passes` reads the WCAG ratio alone, which is what ADR-0003's gate and #8's decisions both require.

The total-JS budget has 1.0 kB left after #8. #25 and #29 both add to the workspace chunk, so the next contrast-adjacent change should expect to meet that ceiling.
