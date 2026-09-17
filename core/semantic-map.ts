import type { RampName } from './scale-engine';

/**
 * Which ramp step every shadcn colour variable takes.
 *
 * One table, because these assignments are worth arguing with. A reader who disagrees that a
 * border is step 6 should find the line rather than trace it through a generator.
 *
 * Keys are the custom property names in `app/globals.css` with the `--` dropped, so the shadcn
 * adapter copies them straight across. Values are `ramp.step`, the one alias form
 * `SemanticLayerSchema` accepts, and never a literal colour: a token holding its own copy of a
 * colour goes stale the moment the ramp under it moves.
 *
 * Two entries declare a rule rather than a step, so this table alone does not say what they come
 * out as. The answer is still data: `buildTokenSet` writes one plain alias per token into each
 * scheme's semantic layer, and that layer is what an adapter and a reader inspect.
 *
 * Issue #6 says a border takes step 6. `core/step-roles.ts` calls step 6 "subtle border" and keeps
 * the name "border" for step 7. Both names are Radix's published prose rather than anything
 * measured, so a name that matches the token is not evidence, and the tie breaks on what shadcn
 * does with the variable.
 *
 * shadcn ships three border tokens and this table has three border steps. That fit is what decides
 * it. `--border` is the global default: `app/globals.css` puts it on every element through
 * `* { @apply border-border }`, which is the separator role. `--input` is shadcn's edge for a form
 * control, and this repo has no form control yet, so `components/ui/button.tsx` is its only
 * consumer here and reaches for it only in the dark `outline` variant. So `border` takes 6 and
 * `input` takes 7. `--ring` is the focus indicator and wants a step above both, which step 8 turns
 * out not to supply; see the focus ring note below.
 *
 * shadcn ranks the three only in dark, where `--input` sits at white 15% against `--border`'s 10%
 * and `--ring` runs well past either. Its light defaults give `--border` and `--input` the same
 * value, so what shadcn supplies is a floor rather than a full ordering: `--input` never sits below
 * `--border`. Cambium separates the two by one step where shadcn left them tied, which is what
 * having a separate token for the role is for. Splitting a tie shadcn never broke is a judgement
 * rather than a reading of the contract, and it is the weakest joint in this argument.
 *
 * Reading the shipped values instead would argue for neither step. shadcn's light `--border`
 * measures 1.26:1 against its page background, under Cambium's step 6 at 1.51:1. Those greys are a
 * taste choice, so they set the ordering here and leave the contrast to the step roles.
 *
 * `border` and `input` sit below 3:1 against the page deliberately: 1.51:1 and 1.80:1 in the light
 * scheme, 1.92:1 and 2.50:1 in dark. SC 1.4.11 asks 3:1 only of visual information required to
 * identify a component or its state, and neither token carries that. A separator identifies no
 * component, and a control's resting edge is not what identifies the control, which its fill, its
 * label and its focus ring do. Raising steps 6 and 7 to clear 3:1 would rewrite the ramp's
 * lightness curve and every palette generated so far, so `ring` moved off step 8 instead of step
 * 8's target moving. See #66.
 *
 * `docs/images/border-step-6.png` and `docs/images/border-step-7.png` render both candidates
 * against the same mock console in both schemes.
 *
 * `ring` breaks the pattern and takes step 11 rather than the step 8 Radix names for a focus ring.
 * A focus ring is visual information identifying a component's state, so WCAG 2.2 SC 1.4.11 asks
 * 3:1 of it against what sits beside it, and `components/ui/button.tsx` paints the focused boundary
 * with `border-ring` at full opacity against the page. Step 8 is a border measured against step 2,
 * not against step 1, so it reaches only 2.22:1 to 2.49:1 against the page in the light scheme for
 * every seed in the sweep. Step 11 is the lowest step that clears 3:1 on all twenty seed-and-scheme
 * combinations, worst case 4.65:1. Step 9 would keep the ring on the brand colour itself and misses
 * on seven of the twenty, because step 9 floats with the seed and a light brand disappears into a
 * light page. Stock shadcn has the same gap: its own `--ring` measures 2.59:1 against white.
 *
 * Step 11's own role name is "low-contrast text", which does not cover a focus ring, so this one
 * assignment is a measurement rather than a role lookup. #6 records the deviation alongside the
 * foreground pair, because a step role that lost an argument to a number is worth arguing with.
 *
 * Four findings arrived from review as accessibility failures in the rendered theme. Two were fixed
 * here and two were recorded instead. The rule that separates them, stated once so the next one
 * does not need arguing from scratch: fix it in this table when a different step clears the failure
 * without costing the token the job its name describes, and record it when no step clears it at
 * that price.
 *
 * The price is what does the work in both branches, because a step that clears the number almost
 * always exists. `ring` moved, since a focus ring owes nothing to any one step. `destructive` moved
 * too, since the contract this repo vendors already uses it as text. `primary` stayed, because step
 * 9 is the brand colour itself. The destructive hover state stayed for the same kind of reason
 * rather than for want of a step: step 12 clears it and turns the token a dark maroon, which stops
 * it looking like danger.
 *
 * Whether some other project ships the same failure is evidence about where a defect lives. It is
 * never the reason to leave one alone.
 *
 * Step roles assign the rest. Surfaces climb 1, 2, 3, 4 as they lift off the page: `background`,
 * then `card` and `popover` and `sidebar`, then `muted` and `secondary` at rest, then `accent`,
 * which shadcn uses for the highlighted menu item. That pulls `muted`, `secondary` and `accent`
 * apart, where shadcn's own defaults ship three names for one grey. Solid fills take step 9, so
 * `primary` is the brand colour itself. `destructive` is the one solid-fill name that does not,
 * for the reason set out below. Text takes 11 for `muted-foreground` and 12 everywhere else.
 *
 * A `-foreground` on a neutral surface takes step 12, and every one of them clears AA across a
 * ten-seed sweep, worst case 9.92:1. The two that sit on a step 9 cannot use a fixed step at all.
 * The scale engine anchors step 9 to the seed in both schemes while step 1 runs near-white in light
 * and near-black in dark, so one alias means near-black text on a mid-tone fill: a navy seed
 * measures 1.01:1 that way, and a fixed `brand.1` failed AA in ten of twenty seed-and-scheme
 * combinations. Those two are declared as a `ContrastingPair` instead, and the layer keeps the end
 * of the ramp that contrasts more.
 *
 * Measuring contrast to choose between two declared steps sits on the edge of #6's "no contrast
 * repair" non-goal. Nothing here moves a colour, which is what repair means and what #8 owns, but
 * the non-goal does not draw that line itself, so #6 carries an amendment recording the exception
 * rather than this file claiming the rule always allowed it. It is also not enough on its own. A brand at mid lightness has no step in
 * its own ramp that clears 4.5:1 against step 9, so four of the same twenty combinations still miss
 * AA: blue at 3.62:1 and orange at 4.37:1 in light, red at 3.89:1 and magenta at 4.18:1 in dark.
 * All four clear 3:1, which is the floor `core/semantic-layer.test.ts` pins, and closing the gap
 * needs a colour moved rather than a step chosen.
 *
 * `destructive` takes step 11 rather than the step 9 every other solid fill takes, because the
 * contract this repo vendors, `shadcn` 4.21.0, declares no `--destructive-foreground`, and
 * `components/ui/button.tsx` builds its destructive control from `text-destructive` over a tint of
 * the same colour. So the token has to work as body text here. That is a claim about the files in
 * this repo, checked against them; upstream shadcn may since have moved.
 * `components/ui/button.tsx` paints it at full opacity twice, as that text and as
 * `aria-invalid:border-destructive`, and every other use is a tint or a translucent ring. It never
 * paints an opaque `bg-destructive`. Step 9 reaches 3.85:1 against the page in the light scheme,
 * the same figure for every seed, because the danger ramp's step 9 does not move with the brand
 * hue. So the shortfall is in every generated theme rather than in some of them. The dark scheme
 * clears at 4.74:1. Stock shadcn's own `--destructive` clears AA at 4.91:1 against white, so step 9
 * falls short of a bar the contract already meets. Step 11 reaches 5.25:1 in light and 8.95:1 in
 * dark, clearing 4.5:1 on all twenty seed-and-scheme combinations. A shadcn component
 * that paints an opaque `bg-destructive` would want step 9 back and a foreground token with it;
 * none exists in this contract today.
 *
 * One destructive state still misses AA, and the step that would fix it costs too much. `components/ui/button.tsx` paints the
 * label over a tint of the same token, so the surface moves toward the text as the tint deepens.
 * At step 11 the resting state clears at 4.57:1 in light and 6.11:1 in dark at worst, and the dark hover
 * clears at 4.78:1 at worst, but the light hover over `bg-destructive/20` reaches only 3.95:1. Step 12 would
 * clear all four, and it would equally turn `--destructive` into a dark maroon and paint
 * `aria-invalid:border-destructive` in it, which stops the token doing the one job its name
 * describes. Stock shadcn misses three of the same four states with its own hand-picked value, at
 * 4.05:1 and 3.31:1 in light and 4.38:1 on dark hover, so compositing a colour with itself is the
 * defect rather than the step chosen. Step 11 beats stock shadcn in every state and clears three of
 * the four. Fixing the fourth means changing the tint, which lives in a component this ticket does
 * not own.
 *
 * `muted-foreground` on `muted` measures 4.40 to 4.44:1 in light for every seed, a fixed shortfall
 * in the neutral ramp's step 3 to step 11 spacing rather than a mapping choice. That one belongs to
 * #8.
 *
 * `primary` stays on step 9 even though `components/ui/button.tsx` renders its `link` variant as
 * `text-primary` on the page, which measures 1.01:1 to 18.07:1 across the sweep and fails AA on ten
 * of twenty combinations. Step 9 is the brand colour the seed asked for, anchored there in both
 * schemes by #4 and required there by #6, so moving it would break the one promise the token set
 * exists to keep. The fix belongs to whoever owns the `link` variant or to a scheme-aware text
 * token the shadcn contract does not declare yet, and no open ticket covers it.
 *
 * `chart-1` through `chart-5` are the one part of the contract this table does not cover; #69 owns
 * them. Five categorical series have to stay distinguishable and visible for
 * any seed, and the arrangement that manages both leans on `harmonization` sitting at zero:
 * `statusAnchor` rotates each canonical status hue toward the brand by that amount, so a preset
 * that harmonises pulls the status ramps toward the brand and toward each other until two slots
 * land on one colour. #37 adds exactly such a preset. That makes the palette a derivation problem
 * rather than a step lookup, and it does not belong in a table of aliases. #69 carries the
 * measurements and the pathological seed.
 *
 * `destructive` carries no foreground because the contract declares none. The vendored
 * `app/globals.css` has no `--destructive-foreground`, and this repo's button tints the text with
 * `text-destructive` instead, so deriving one would put a token in the export that nothing reads.
 */

/** The `ramp.step` form `SemanticLayerSchema` accepts, narrowed to the ramps the engine emits. */
export type SemanticAlias = `${RampName}.${number}`;

/**
 * Two candidate steps and the fill they are measured against. The layer keeps whichever candidate
 * contrasts more with `on`, per scheme, and writes that one alias into the scheme's semantic layer.
 *
 * Only foregrounds that sit on step 9 need this, because step 9 is the one step the scale engine
 * holds identical in both schemes. Every other surface in the contract moves with its scheme, so a
 * single alias tracks it.
 */
export type ContrastingPair = {
	on: SemanticAlias;
	candidates: readonly [SemanticAlias, SemanticAlias];
};

export type SemanticAssignment = SemanticAlias | ContrastingPair;

export const SEMANTIC_MAP = {
	background: 'neutral.1',
	foreground: 'neutral.12',
	card: 'neutral.2',
	'card-foreground': 'neutral.12',
	popover: 'neutral.2',
	'popover-foreground': 'neutral.12',
	primary: 'brand.9',
	'primary-foreground': { on: 'brand.9', candidates: ['brand.1', 'brand.12'] },
	secondary: 'neutral.3',
	'secondary-foreground': 'neutral.12',
	muted: 'neutral.3',
	'muted-foreground': 'neutral.11',
	accent: 'neutral.4',
	'accent-foreground': 'neutral.12',
	destructive: 'danger.11',
	border: 'neutral.6',
	input: 'neutral.7',
	ring: 'brand.11',
	sidebar: 'neutral.2',
	'sidebar-foreground': 'neutral.12',
	'sidebar-primary': 'brand.9',
	'sidebar-primary-foreground': { on: 'brand.9', candidates: ['brand.1', 'brand.12'] },
	'sidebar-accent': 'neutral.4',
	'sidebar-accent-foreground': 'neutral.12',
	'sidebar-border': 'neutral.6',
	'sidebar-ring': 'brand.11',
} as const satisfies Readonly<Record<string, SemanticAssignment>>;

export type SemanticToken = keyof typeof SEMANTIC_MAP;
