import { describe, expect, it } from 'vitest';
import { STEP_ROLES } from '../../core/step-roles';
import { measureRamp, renderSwatchPage } from './swatches.mjs';

// scripts/lib/swatches.mjs is plain, untyped JS, so its exports carry no declared return shape
// for a .ts test file to infer. This mirrors what measureStep in that file actually builds, for
// the properties these tests touch.
type MeasuredStep = { step: number; role: string | null; failsContrast: boolean };

// Twelve identical colours contrast 1:1 against their own step 2, which is below every floor
// STEP_ROLES states, so every floor-carrying step fails deterministically and every step with no
// floor (1, 2, 9, 10 — backgrounds and the seed anchor) cannot.
const IDENTICAL_RAMP: string[] = Array.from({ length: 12 }, () => '#808080');

describe('measureRamp with stepRoles', () => {
	it('flags every floor-carrying step, and only those, when contrast never clears the floor', () => {
		const steps = measureRamp(IDENTICAL_RAMP, STEP_ROLES) as MeasuredStep[];
		const floorSteps = STEP_ROLES.filter((role) => role.minWcagVsStep2 != null).map(
			(role) => role.step,
		);

		expect(floorSteps).toEqual([3, 4, 5, 6, 7, 8, 11, 12]);

		for (const step of steps) {
			expect(step.failsContrast).toBe(floorSteps.includes(step.step));
		}
	});

	it('never flags a step when no stepRoles table is supplied', () => {
		const steps = measureRamp(IDENTICAL_RAMP) as MeasuredStep[];

		expect(steps.every((step) => step.failsContrast === false)).toBe(true);
	});
});

describe('renderSwatchPage', () => {
	// This is the harness's whole reason to exist: a swatch that misses its floor has to be
	// visibly different from one that doesn't. Counting the marker rather than checking it's
	// merely present is what stops a regression that marks every cell "fail" (or none of them)
	// from still passing a substring check.
	it("marks a failing step's cell and leaves a step with no floor unmarked", () => {
		const steps = measureRamp(IDENTICAL_RAMP, STEP_ROLES);
		const html = renderSwatchPage([{ title: 'probe', rows: [{ label: 'flat', steps }] }]);

		expect(html.match(/class="cell fail"/g)).toHaveLength(8);
		expect(html.match(/fails floor/g)).toHaveLength(8);
	});
});
