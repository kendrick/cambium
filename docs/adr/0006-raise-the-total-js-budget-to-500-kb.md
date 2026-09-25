# Raise the Total-JS Budget to 500 kB

After #8 the static export measures 449.0 kB of JavaScript against the 450 kB total budget in `lib/bundle-budget.ts`, and ADR-0005 flagged that the next two workspace features would meet that ceiling. Both do. #29 brings `serializeDtcg` and `toStylesheet` into the workspace chunk, which loads neither today because the preview uses the lighter `scheme-declarations` builders. #25 replaces the read-only seed rail with an editor for every seed field, a pin per field, and a reference-image viewer. So the total rises to 500 kB, in its own change ahead of both, and first-load stays at 200 kB.

The first-load budget is the one a visitor feels, and nothing here touches it. Every added byte rides the workspace chunk that `components/workspace/workspace-route.tsx` loads through a dynamic `import()`. The total is the backstop ADR-0002 describes, and it exists so lazy chunks don't grow unwatched. It stays watched, because each of #25 and #29 states its measured delta against `main` in its PR, and a change that would pass 500 kB meets the same test that stopped #8 at 460.2 kB.

## Considered Options

### Raise the Budget in Each PR by Its Own Delta

This is tighter, since each raise would match a measured need exactly. But #25 and #29 would both edit `lib/bundle-budget.ts`, and the two lanes would then have to run one after the other on that file alone. One raise ahead of both keeps the constant out of either diff.

### Hold 450 kB and Find Savings First

One known item in the workspace chunk is the 25 kB of Floating UI that #28's popover brought in, per the `bundle-budget.ts` docblock. Replacing it is its own piece of work with its own trade-offs, and it would hold both features until it landed.

## Consequences

`TOTAL_JS_BUDGET_BYTES` is `500_000`, and the `bundle-budget.ts` docblock records the rise beside the last one. ADR-0005's closing note about 1.0 kB of headroom describes the build as it stood after #8. The headroom is now about 51 kB before #25 and #29.
