# Let Contrast Repair Move an Unpinned Key Colour

Until #146, a pin on a key colour changed nothing contrast repair produced. Pins protect exactly one step, step 9 of `brand` or `accent`, which is where the engine places a key colour (`repairPinsFor` in `core/seed-pins.ts`). The only declared pairs that reach step 9 put it on the background: `primary-foreground` on `primary`, and `sidebar-primary-foreground` on `sidebar-primary`. `repairContrast` tried the foreground first and always found a `brand.1` or `brand.12` lightness that cleared, because near-black or near-white text clears 4.5:1 on any mid-tone fill. So the background never moved, and pinning it protected a colour nothing would touch. The pin button's tooltip promised more than that ("presets and contrast repair keep the value you set"), and #25 calls pinning the product's fidelity control.

Now, when one side of a failing pair is step 9 of `brand` or `accent`, and neither side is pinned, repair solves both sides and moves the one that needs the smaller lightness change. A tie goes to the foreground. A pinned key colour leaves only the foreground to move, which is the old behaviour. Every other pair still moves its foreground first, and moves its background only when the foreground is pinned or no lightness clears there.

Both sides are solved on every turn of the loop, where the old loop solved the background only after the foreground failed. `solve` is pure, so a pair whose order doesn't change gets the same override as before. The cost is one extra `solve` per move, in a loop bounded at twice the number of pairs.

A prototype of this rule, run against `main` at 090aaf1, measured the effect on the eight demo fixtures in `app/demo/fixtures/` under `BALANCED`. With each record's own pins, and again under `defaultPins`, the overrides are byte-identical to the old rule's in all eight. With no pins, four of the eight differ: `artwork-blocks`, `photo-window`, `ui-devtools` and `ui-wikipedia` each move `brand.9` where the old rule moved `brand.1` or `brand.12` by about 0.8 L. On the seed `core/contrast/repair.test.ts` uses, brand `[0.62, 0.21, 35.2]`, the unpinned move takes `brand.9` down 0.0334 L where the old rule took `brand.1` down 0.79 L.

The repair report changed in the same pass. Codex found on PR #180 (r4146678515) that when the loop moves one step twice, `overrides` keeps only the last colour while the report kept both entries. `DESIGN.md` then printed a `to` and a ratio that no exported file holds. In the forced case the tests build, light `neutral.12` moves to L 0.563641 with 4.529:1 recorded, then to 0.461723, and the shipped `foreground`/`background` ratio is 6.993:1. The report now holds one entry per moved step, the last one, in the same order as `overrides`. Repair recomputes each entry's `achieved` against the set it returns, so the ratio `DESIGN.md` prints is the one the export paints. `measured` stays the failing ratio at the moment repair took the pair. Recomputed against the input set, a pair that only failed after an earlier move would show as passing before repair, and `DESIGN.md` would print a repair that lowered contrast.

The engine id moves from `cambium-oklch-2` to `cambium-oklch-3`, sharing `-2`'s digest. The digest in `core/scale-engine-digest.fixture.ts` hashes the engine's result, and this change leaves that result alone, so the two digests are equal. That fixture's docblock already names a shared digest as the compliant update when a required bump changes nothing the sample sees. The new id marks versions committed under the new repair rule, and that is all it does. Tokens are recomputed on open and never stored, so a version stamped `-2` re-derives under the new rule too, and nothing reproduces the repair it was committed with.

## Considered Options

### The Smaller Move on Every Pair

This is #146's own example, applied to every failing pair. It changes output for records nobody unpinned. In `artwork-dashboard` (light scheme), moving `neutral.3` by +0.006227 beats moving `neutral.11` by −0.006324, so `muted` would move where `muted-foreground` moved before. That record is default-pinned, and the narrow rule leaves default-pinned output unchanged, since a pinned key step leaves one candidate.

### Declare `primary` as Text on `background`

This is the pair #68's `link` variant renders, and it puts `brand.9` on the foreground, where foreground-first moves it whenever it's unpinned. It takes the least code. Pinned, it moves the page background `neutral.1` instead. It also contradicts #68's non-goal of keeping `primary` on step 9, which places the fix in the variant.

### Make the Tooltip Honest and Defer

Change the pin tooltip, close #146 until a declared pair reaches step 9 another way, and drop #48's pin criterion. That costs an hour. It leaves #25's guarantee untestable, because no test can fail when a pin decides nothing, and it keeps the 0.8 L flips for an unpinned brand.

### Leave the Engine Id Where It Is

A repair-only change could move no id and let the ADR say why. Ruling §3 rejected that on 2026-09-29. Once #99 merged with a digest over the engine result alone, a shared digest under a new id became a legal update, so the bump costs nothing and marks which rule committed a version.

## Consequences

A pin on the `brand` key colour now decides what repair moves on the `primary` pairs, and #146's core and e2e tests each assert a different outcome with the pin on and off. `e2e/keyed-path.spec.ts` drives the case at brand lightness 0.62 in the light scheme, where the outcome depends on the pin.

#27 renders this report. It relies on one entry per moved step, with `achieved` taken from the set the export ships.

The `both-pinned` reason still can't be reached. Pins only ever cover step 9 of `brand` or `accent`, and no declared pair holds one of those on each side.

A pin on any field other than a key colour still maps to no step, so it changes nothing repair does.
