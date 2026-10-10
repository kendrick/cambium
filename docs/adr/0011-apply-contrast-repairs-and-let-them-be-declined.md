# Apply Contrast Repairs and Let Them Be Declined

#8 settled four design decisions on 2026-09-25, and the third one set how repair reaches the user: "Repairs apply automatically, before the user's overrides. The store builds the token set in three steps: the derived set, then contrast repairs, then user overrides. Exports and the preview are AA by default." It ended with "#27 adds a way to view and decline repairs." That decision lived only in an issue comment. #27 as first written pulled the other way, with "nothing applies automatically" and one decision per pair. Meanwhile repair ran silently. The token list marks only user overrides, so a repaired step looked like any other generated value. In `photo-window`'s light scheme, repair moves `brand.1` from L 0.994 to 0.170, which flips `primary-foreground` from near-white to near-black. Until this change, nothing on screen said so.

Kendrick ruled on 2026-09-29 for option A of the wave-2 rulings. #8's decision 3 stays: repair applies automatically, and exports and the preview stay AA by default. The Accessibility tab shows every repair the pass applied and lets the user decline each one, individually or all at once. #27's criteria now match it: "every applied repair is shown and can be declined, per repair (one moved step), individually and in bulk."

#27 counts repairs by moved step, since repair keys its overrides per step in `core/contrast/repair.ts`, and one step can back several pairs. On `photo-window` today, light `brand.1` backs both `primary-foreground` and `sidebar-primary-foreground`, so declining it leaves both pairs failing at 4.18:1. The tab shows every pair a moved step backs on that step's card. The pair that triggered the move is only one of them.

Declining a repair writes a user `primitive` override that puts the step back at the colour it had before repair, the entry's `from`, through the store's existing `setOverride`. Restoring it calls `clearOverride` with that override's key. Both are ordinary draft edits that persist on the version at the next Save, like any other override. That's why this needs no schema change. The contrast report runs on the final set, overrides included, so a declined pair shows as failing. The tab then names the declined step as the cause.

The store already exposes the repair pass's report as `ContrastState.repairs`, filtered by `repairsStillHeld`. That filter drops any entry whose moved step or either operand a user override changed, and a decline is exactly such an override. So `ContrastState` gains `applied`, the pass's full report before user overrides, and `repairs` keeps its filter. The tab reads `applied`, and a declined repair stays on screen with a Restore button. A repair whose step the user changed to some other colour by hand reads as "Edited by you" and offers neither Decline nor Restore.

## Considered Options

### Make Repair Opt-In

This is #27 as first written. The store would stop applying `withContrastRepairs` by default and compute proposals only. Accepting a proposal would write it as a user override through `setOverride`. That needs no schema change either, but it reverses #8's decision 3. The preview, exports and #40's demo would ship failing pairs until someone clicked. `e2e/export.spec.ts`, which checks that the export holds the repaired set, would fail. An accepted repair would also freeze into a literal override and stop tracking the seed.

### Show Repairs Without a Way to Decline

The tab would list each repair with its before and after previews and offer no decline. This costs the least. It drops #27's premise that "the decision to accept a repair is visual". The user would see the change and have no way to refuse it.

## Consequences

A declined step holds a literal colour, the one it had before repair at the moment of the decline. It doesn't follow later seed edits, the same as every user override. If the user changes the seed after declining, the repair pass may move the step somewhere new while the decline still holds the old colour.

The token list shows a decline as an ordinary override, with the same "overridden" label as a hand edit. Only the Accessibility tab tells a declined repair apart from a hand edit.

The export's DESIGN.md doesn't document a declined repair. It reads `repairs`, and `repairsStillHeld` drops the declined entry, so the archive never claims a move its own tokens don't hold.

The "both pinned" explanation stays parked. ADR-0010 covers why `both-pinned` can't be reached from seed pins. The tab has a sentence for it because a `Record` over `UnrepairedReason` makes every reason need one, but no test drives it.
