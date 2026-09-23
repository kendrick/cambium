/**
 * Cambium's ramps number their steps 1 through 12 (`core/step-roles.ts`). The ecosystem the CSS
 * adapters export into numbers them by a different, older convention: Tailwind's own default
 * palette stops at eleven names, 50 through 950, one short of what a twelve-step ramp needs.
 * Untitled UI's design tokens are the well-known way Tailwind-adjacent systems close that gap —
 * by adding 25 beneath 50 rather than inventing a name Tailwind has never shipped — so
 * `--color-*-25` through `--color-*-950` is what a Tailwind or shadcn consumer already expects
 * from a twelve-step scale, not a name this module invented for the occasion.
 *
 * Declared as a literal table rather than computed from the step number, because the mapping is
 * not an arithmetic progression: steps 1 through 6 read 25, 50, 100, 200, 300, 400, so a
 * `step * 100`-style formatter would be wrong for exactly the steps nearest the common case. Both
 * CSS adapters read this table to name each ramp's colour namespace entries, so the table — not a
 * formatter buried inside either of them — is the contract they code against.
 */
export type StepNumberEntry = {
	/** Cambium's own ramp step, 1 through 12 (`core/step-roles.ts`). */
	readonly step: number;
	/** The conventional Tailwind/Untitled UI numeric name for that step. */
	readonly name: string;
};

export const STEP_NUMBERS: readonly StepNumberEntry[] = [
	{ step: 1, name: '25' },
	{ step: 2, name: '50' },
	{ step: 3, name: '100' },
	{ step: 4, name: '200' },
	{ step: 5, name: '300' },
	{ step: 6, name: '400' },
	{ step: 7, name: '500' },
	{ step: 8, name: '600' },
	{ step: 9, name: '700' },
	{ step: 10, name: '800' },
	{ step: 11, name: '900' },
	{ step: 12, name: '950' },
];

/**
 * Looks up one step's conventional name in `STEP_NUMBERS` rather than recomputing it, so a caller
 * that only has a step number still goes through the same table a reader auditing the mapping
 * would consult. Throws on a step outside 1–12 instead of returning `undefined`: the result here
 * becomes a colour namespace entry in an exported stylesheet, not a spot where a silent gap is
 * safe to carry forward.
 */
export function stepNumberName(step: number): string {
	const entry = STEP_NUMBERS.find((candidate) => candidate.step === step);
	if (!entry) {
		throw new Error(`No conventional numeric name for step ${step}; expected 1 through 12`);
	}
	return entry.name;
}
