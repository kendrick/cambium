import { fitToSrgbGamut, isInSrgb, type Oklch, renderedContrast, toSrgbHex } from '../oklch';
import { CAMBIUM_NAMESPACE } from '../provenance';
import { SCHEME_NAMES, type SchemeName } from '../scale-engine';
import { applyOverrides, overrideKey, type TokenOverride } from '../token-overrides';
import type { TokenSet } from '../token-set';
import { type ContrastEntry, checkContrast } from './check';

/** `${scheme}:${ramp}.${step}`, the one spelling a pin takes wherever a caller supplies one. */
export type PinKey = `${SchemeName}:${string}.${number}`;

export function pinKey(scheme: SchemeName, ramp: string, step: number): PinKey {
	return `${scheme}:${ramp}.${step}`;
}

/**
 * Steps whose provenance is `observed`, in both schemes. Those are the colours read out of the
 * reference images, the one thing a consumer can hold up against the image, so a repair that moved
 * one would quietly undo the read. Keyed on provenance rather than on "brand step 9" so a later
 * producer that observes a different step gets it protected without a second list here.
 */
export function defaultPins(tokenSet: TokenSet): Set<PinKey> {
	const pins = new Set<PinKey>();

	for (const scheme of SCHEME_NAMES) {
		for (const [ramp, steps] of Object.entries(tokenSet.schemes[scheme].primitives)) {
			for (const step of steps) {
				if (step.$extensions[CAMBIUM_NAMESPACE].provenance === 'observed') {
					pins.add(pinKey(scheme, ramp, step.step));
				}
			}
		}
	}

	return pins;
}

/** One step a repair moved, with what it measured before and after, so a UI needn't recompute. */
export type RepairEntry = {
	scheme: SchemeName;
	foreground: string;
	background: string;
	target: number;
	/** `renderedContrast` of the pair when the repair found it failing. */
	measured: number;
	/** Which side of the pair the moved step sits on. */
	moved: 'foreground' | 'background';
	ramp: string;
	step: number;
	from: Oklch;
	to: Oklch;
	/** The 8-bit sRGB hex `to` paints as, the same bytes `achieved` was measured on. */
	hex: string;
	/** `renderedContrast` of the pair right after this move. */
	achieved: number;
	/** True when `to.c` sits below `from.c` because the new lightness can't hold it in sRGB. */
	chromaReduced: boolean;
	/** True when the moved step no longer sits between its neighbours' lightnesses. */
	outOfOrder: boolean;
};

export type UnrepairedReason = 'both-pinned' | 'no-lightness-clears' | 'did-not-converge';

export type UnrepairedEntry = ContrastEntry & { reason: UnrepairedReason };

export type RepairResult = {
	overrides: TokenOverride[];
	unrepaired: UnrepairedEntry[];
	report: RepairEntry[];
};

export type RepairOptions = {
	/** Replaces the default rather than adding to it, so a caller extending it spreads `defaultPins`. */
	pinned?: ReadonlySet<PinKey>;
};

/** Lightness is searched on the six-decimal grid every ramp step is quantized to. */
const L_UNITS = 1_000_000;

/**
 * Outward stride of the coarse search, in grid units. Contrast against a fixed colour bottoms out
 * near that colour's luminance and climbs toward either end, so the passing region on each side
 * runs out to 0 or 1 and a stride can't skip it. The stride only sets how wide a bracket the
 * bisection starts from. Byte rounding makes the climb a staircase rather than a slope, which is
 * why the result is measured, not assumed.
 */
const COARSE_STRIDE = 10_000;

/**
 * The stated tolerance from #8: hue 0, chroma 0 unless the new lightness can't hold the original
 * chroma inside sRGB, and then reduced to the sRGB boundary at that lightness and hue, and no
 * further. `fitToSrgbGamut` bisects chroma at fixed l and h and returns the in-gamut side, so the
 * result is always displayable and `renderedContrast` measures exactly what gets painted, with no
 * clamp between the token and the pixel.
 */
function colourAt(units: number, original: Oklch): Oklch {
	const candidate = { l: units / L_UNITS, c: original.c, h: original.h };

	return isInSrgb(candidate) ? candidate : fitToSrgbGamut(candidate);
}

/**
 * The passing lightness nearest `start` in one direction, or null. `renderedContrast` rounds to
 * bytes and the chroma clamp bends the curve, so the refinement keeps `pass` on a unit it has
 * actually measured passing rather than trusting monotonicity to hand one back.
 */
function nearestOnSide(
	start: number,
	direction: -1 | 1,
	passes: (units: number) => boolean,
): number | null {
	const limit = direction < 0 ? 0 : L_UNITS;
	let fail = start;
	let pass: number | null = null;

	for (let units = start; ; units += direction * COARSE_STRIDE) {
		const clamped = direction < 0 ? Math.max(units, limit) : Math.min(units, limit);

		if (passes(clamped)) {
			pass = clamped;
			break;
		}

		fail = clamped;

		if (clamped === limit) return null;
	}

	while (Math.abs(pass - fail) > 1) {
		const mid = Math.trunc((pass + fail) / 2);

		if (passes(mid)) pass = mid;
		else fail = mid;
	}

	return pass;
}

/**
 * The lightness closest to the step's own that clears `target` against `other`, on either side.
 * A repair may cross the other colour's lightness: a mid-tone fill can leave no passing value on
 * the side a step started on (blue's `brand.1` in light), and that crossing is reported as
 * `outOfOrder` rather than refused.
 */
function solve(original: Oklch, other: Oklch, target: number): Oklch | null {
	const start = Math.round(original.l * L_UNITS);
	const passes = (units: number) => renderedContrast(colourAt(units, original), other) >= target;
	const down = nearestOnSide(start, -1, passes);
	const up = nearestOnSide(start, 1, passes);

	if (down === null && up === null) return null;

	// Ties go down so the choice never depends on anything but the two distances.
	const units =
		up === null || (down !== null && start - down <= up - start) ? down! : (up as number);

	return colourAt(units, original);
}

type Side = { alias: string; ramp: string; step: number; key: PinKey };

function sideOf(tokenSet: TokenSet, scheme: SchemeName, token: string): Side {
	const alias = tokenSet.schemes[scheme].semantic[token]?.alias;

	if (!alias) throw new Error(`"${token}" has no alias in the ${scheme} scheme`);

	const dot = alias.lastIndexOf('.');
	const ramp = alias.slice(0, dot);
	const step = Number(alias.slice(dot + 1));

	return { alias, ramp, step, key: pinKey(scheme, ramp, step) };
}

function channels(tokenSet: TokenSet, scheme: SchemeName, side: Side): Oklch {
	const entry = tokenSet.schemes[scheme].primitives[side.ramp]?.[side.step - 1];

	if (!entry) throw new Error(`${scheme} ${side.alias} resolves to nothing`);

	return { l: entry.l, c: entry.c, h: entry.h };
}

/** Step 1 is the page end of every ramp: lightest in light, darkest in dark. */
function isOutOfOrder(tokenSet: TokenSet, scheme: SchemeName, ramp: string, step: number) {
	const steps = tokenSet.schemes[scheme].primitives[ramp]!;
	const l = steps[step - 1]!.l;
	const before = steps[step - 2]?.l;
	const after = steps[step]?.l;
	const sign = scheme === 'light' ? 1 : -1;
	const beforeOk = before === undefined || sign * (before - l) >= 0;
	const afterOk = after === undefined || sign * (l - after) >= 0;

	return !(beforeOk && afterOk);
}

function pairId(entry: ContrastEntry): string {
	return JSON.stringify([entry.scheme, entry.foreground, entry.background]);
}

/**
 * Proposes `primitive` overrides that lift every declared pair to its AA target, measured with
 * `renderedContrast`, moving lightness only (and chroma only as far as sRGB forces; see
 * `colourAt`).
 *
 * Moves the foreground's step first. When that step is pinned, or no lightness clears there, the
 * background's step moves instead. When neither can move, the pair is reported unrepaired and
 * nothing is touched.
 *
 * A step moved for one pair moves every token aliased to it, which can break a pair that passed.
 * So each move is followed by a fresh check of every pair, always taking the first failure in
 * `checkContrast`'s order (scheme, then `SEMANTIC_MAP` key order), which keeps the output
 * deterministic. The loop is bounded so two pairs pulling one step in opposite directions end up
 * in `unrepaired` rather than spinning.
 *
 * Each new colour is solved from the step's colour in `tokenSet`, never from a colour an earlier
 * move left behind, so the hue and chroma tolerance is measured against what the generator made.
 */
export function repairContrast(tokenSet: TokenSet, options: RepairOptions = {}): RepairResult {
	const pinned: ReadonlySet<PinKey> = options.pinned ?? defaultPins(tokenSet);
	const moves = new Map<string, TokenOverride>();
	const report: RepairEntry[] = [];
	const stuck = new Map<string, UnrepairedReason>();
	const maxMoves = checkContrast(tokenSet).length * 2;
	let current = tokenSet;
	let converged = false;

	for (let attempt = 0; attempt <= maxMoves; attempt += 1) {
		const failing = checkContrast(current).find(
			(entry) => !entry.passes && !stuck.has(pairId(entry)),
		);

		if (!failing) {
			converged = true;
			break;
		}

		if (attempt === maxMoves) break;

		const scheme = failing.scheme;
		const foreground = sideOf(current, scheme, failing.foreground);
		const background = sideOf(current, scheme, failing.background);
		const candidates = (
			[
				['foreground', foreground, background],
				['background', background, foreground],
			] as const
		).filter(([, side]) => !pinned.has(side.key));

		if (candidates.length === 0 || foreground.key === background.key) {
			stuck.set(pairId(failing), candidates.length === 0 ? 'both-pinned' : 'no-lightness-clears');
			continue;
		}

		let moved = false;

		for (const [role, side, other] of candidates) {
			const original = channels(tokenSet, scheme, side);
			const to = solve(original, channels(current, scheme, other), failing.target);

			if (!to) continue;

			const override: TokenOverride = {
				kind: 'primitive',
				scheme,
				ramp: side.ramp,
				step: side.step,
				...to,
			};
			const result = applyOverrides(current, [override]);

			if (!result.ok) {
				throw new Error(`a repair produced an override applyOverrides refused: ${result.key}`);
			}

			current = result.tokenSet;
			// Keyed like the store keys user edits, so a step moved twice keeps only its last colour.
			moves.delete(overrideKey(override));
			moves.set(overrideKey(override), override);
			report.push({
				scheme,
				foreground: failing.foreground,
				background: failing.background,
				target: failing.target,
				measured: failing.wcag,
				moved: role,
				ramp: side.ramp,
				step: side.step,
				from: original,
				to,
				hex: toSrgbHex(to),
				// WCAG's ratio puts the lighter colour on top either way, so argument order doesn't matter.
				achieved: renderedContrast(to, channels(current, scheme, other)),
				chromaReduced: to.c < original.c,
				outOfOrder: isOutOfOrder(current, scheme, side.ramp, side.step),
			});
			moved = true;
			break;
		}

		if (!moved) stuck.set(pairId(failing), 'no-lightness-clears');
	}

	const unrepaired = checkContrast(current)
		.filter((entry) => !entry.passes)
		.map((entry): UnrepairedEntry => ({
			...entry,
			reason: stuck.get(pairId(entry)) ?? (converged ? 'no-lightness-clears' : 'did-not-converge'),
		}));

	// Recomputed against the final `current` rather than trusted from the moment of each move: a
	// later move can shift a step's neighbours, which changes what "in order" means for an earlier
	// entry, and a reader of the report only ever sees the set this returns, not the set as it stood
	// mid-loop.
	const finalReport = report.map((entry) => ({
		...entry,
		outOfOrder: isOutOfOrder(current, entry.scheme, entry.ramp, entry.step),
	}));

	return { overrides: [...moves.values()], unrepaired, report: finalReport };
}

export type ContrastRepairedTokenSet = { tokenSet: TokenSet; unrepaired: UnrepairedEntry[] };

/**
 * Runs `repairContrast` and applies its overrides in one call, so every caller that wants the
 * repaired set itself—rather than the moves that produce it—builds it the same way. The workspace
 * store and both e2e fixtures go through here for that reason: a fixture that composed the two
 * calls on its own could drift from what the store actually paints.
 *
 * `repairContrast` only ever proposes overrides it has already applied to its own working copy of
 * `tokenSet` (see the loop above), so a rejection here would mean the two disagree about what the
 * base can take.
 */
export function withContrastRepairs(tokenSet: TokenSet): ContrastRepairedTokenSet {
	const { overrides, unrepaired } = repairContrast(tokenSet);
	const applied = applyOverrides(tokenSet, overrides);

	if (!applied.ok) {
		throw new Error(`contrast repair produced an override the base could not take: ${applied.key}`);
	}

	return { tokenSet: applied.tokenSet, unrepaired };
}
