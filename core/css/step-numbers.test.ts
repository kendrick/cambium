import { describe, expect, it } from 'vitest';

import { STEP_NUMBERS, stepNumberName } from './step-numbers';

/**
 * The conventional name a Tailwind (and shadcn) user expects for a twelve-step ramp, settled
 * independently of `step-numbers.ts` rather than read off it: Tailwind's own default palette
 * stops at eleven names, 50 through 950, one short of Cambium's twelve steps. Untitled UI's
 * design tokens are the well-known extension that closes that gap, by adding 25 beneath 50 rather
 * than inventing a name Tailwind has never shipped, and that 25-through-950 scale is what a
 * Tailwind or shadcn consumer already recognises from other twelve-step palettes. Asserting
 * against this list, rather than re-deriving it from `STEP_NUMBERS`, is what keeps this test from
 * merely checking that the table agrees with itself.
 */
const EXPECTED_NAMES = [
	'25',
	'50',
	'100',
	'200',
	'300',
	'400',
	'500',
	'600',
	'700',
	'800',
	'900',
	'950',
];

describe('STEP_NUMBERS', () => {
	it('covers every step 1 through 12 exactly once', () => {
		// `map` already returned a fresh array, so this sort mutates nothing anyone else can see.
		// `toSorted` would say it directly and is ES2023 against an ES2022 target, the same trade
		// core/dtcg/deserialize.ts makes.
		// oxlint-disable-next-line unicorn/no-array-sort
		const steps = STEP_NUMBERS.map((entry) => entry.step).sort((a, b) => a - b);

		expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	});

	it('produces no duplicate output names', () => {
		const names = STEP_NUMBERS.map((entry) => entry.name);

		expect(new Set(names).size).toBe(names.length);
	});

	it('maps each step onto the conventional Tailwind/Untitled UI numeric name, in ascending order', () => {
		// `[...STEP_NUMBERS]` copies first, so this sort mutates nothing the exported table holds.
		const copy = [...STEP_NUMBERS];
		// oxlint-disable-next-line unicorn/no-array-sort
		const ordered = copy.sort((a, b) => a.step - b.step).map((entry) => entry.name);

		expect(ordered).toEqual(EXPECTED_NAMES);
	});
});

describe('stepNumberName', () => {
	it('looks up the conventional name for a given step', () => {
		expect(stepNumberName(1)).toBe('25');
		expect(stepNumberName(7)).toBe('500');
		expect(stepNumberName(12)).toBe('950');
	});

	it('throws on a step outside the 1-12 range instead of returning an unresolved name', () => {
		expect(() => stepNumberName(0)).toThrow(/No conventional numeric name for step 0/);
		expect(() => stepNumberName(13)).toThrow(/No conventional numeric name for step 13/);
	});
});
