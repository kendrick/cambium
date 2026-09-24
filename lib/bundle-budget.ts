/**
 * The ceiling on what a visitor downloads.
 *
 * Measured baseline when these numbers were set: the scaffold build shipped 176.0 kB gzipped JS
 * across seven chunks plus 5.8 kB of CSS, and every chunk was first-load because there was one
 * route.
 *
 * First-load applies to each exported route on its own, since any of them can be somebody's first
 * visit. At #24, `/` measured 196.6 kB and `/workspace` 193.2 kB, the latter only after its shell
 * moved behind a dynamic import. Shipped with the page, the shell put it at 205.1 kB.
 *
 * First-load sits at 200 kB against that 176 kB, and the 24 kB of headroom is the point. The
 * research notes project the full library set at roughly 185 kB gzipped if everything were
 * imported eagerly, so the budget forces every pipeline library behind a dynamic import. The
 * landing route is an upload screen that needs none of them.
 *
 * Total is the backstop. Code-splitting moves weight out of first-load rather than removing it,
 * and without a second number the lazy chunks grow unwatched.
 *
 * These live in TypeScript rather than JSON so they are typechecked, greppable, and can carry
 * this comment.
 */
export const FIRST_LOAD_BUDGET_BYTES = 200_000;

export const TOTAL_JS_BUDGET_BYTES = 400_000;
