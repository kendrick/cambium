import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STEP_ROLES } from '../../core/step-roles';
import { loadSchemes } from './cli.mjs';
import { asCulori, measureRamp, renderSwatchPage } from './swatches.mjs';

// scripts/lib/swatches.mjs is plain, untyped JS, so its exports carry no declared return shape
// for a .ts test file to infer. This mirrors what measureStep in that file actually builds, for
// the properties these tests touch.
type MeasuredStep = {
	step: number;
	role: string | null;
	wcag: number;
	failsContrast: boolean;
	straddlesFloor: boolean;
};

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

describe('measureRamp against a real ramp', () => {
	// The step-11 success ramp for scripts/fixtures/seed.json under BALANCED clears its 4.5 WCAG
	// floor at full precision (4.5159) but drops under it once quantized to the 8-bit hex the cell
	// actually paints (4.4997). core/oklch-scale-engine.ts's FLOOR_MARGIN (1.0005, a 0.00225 floor
	// cushion at 4.5) was sized to absorb six-decimal rounding, not sRGB byte quantization, so this
	// straddle is a real gap rather than a fixture artifact. Deterministic: harmonization is 0 in
	// BALANCED, so the success ramp's hue never depends on the seed's own brand colour.
	it('flags light/success step 11 as failing its rendered floor while its exact colour clears it', async () => {
		const seedPath = fileURLToPath(new URL('../fixtures/seed.json', import.meta.url));
		const schemes = await loadSchemes(seedPath);
		const steps = measureRamp(schemes.light.success.map(asCulori), STEP_ROLES) as MeasuredStep[];
		const step11 = steps[10]!;

		expect(step11.step).toBe(11);
		expect(step11.wcag).toBeCloseTo(4.4997, 3);
		expect(step11.failsContrast).toBe(true);
		expect(step11.straddlesFloor).toBe(true);
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

	// A straddling step that still clears its rendered floor has to read differently from one that
	// misses it outright, or the marker meant to flag fragility would just look like a second way
	// to say "fail". Both orderings of the two independent flags get their own class string.
	it('marks a straddling step distinctly from an outright failure', () => {
		const base = {
			hex: '#37815a',
			l: 0.544,
			c: 0.096,
			h: 157.7,
			apca: 69,
			inSrgb: true,
			role: 'low-contrast text',
		};
		const passingStraddle = {
			...base,
			step: 11,
			wcag: 4.51,
			failsContrast: false,
			straddlesFloor: true,
		};
		const failingStraddle = {
			...base,
			step: 11,
			wcag: 4.4997,
			failsContrast: true,
			straddlesFloor: true,
		};

		const html = renderSwatchPage([
			{ title: 'probe', rows: [{ label: 'row', steps: [passingStraddle, failingStraddle] }] },
		]);

		expect(html.match(/class="cell straddle"/g)).toHaveLength(1);
		expect(html.match(/class="cell fail straddle"/g)).toHaveLength(1);
		// One "quantization-sensitive" mention per straddling cell, plus one in the page's own legend
		// paragraph explaining what the marker means.
		expect(html.match(/quantization-sensitive/g)).toHaveLength(3);
	});

	// toFixed(2) rounds 4.4997 up to "4.50", which reads as clearing a 4.5 floor on a cell the
	// floor check already marked failing: a self-contradicting cell that reads as a bug in the
	// tool even though the verdict is right. The printed figure has to stay on the same side of
	// the floor as the mark.
	it('never prints a ratio that reads as clearing a floor the mark says it missed', () => {
		const failingStraddle = {
			step: 11,
			hex: '#37815a',
			l: 0.544,
			c: 0.096,
			h: 157.7,
			apca: 69,
			inSrgb: true,
			role: 'low-contrast text',
			wcag: 4.4997,
			failsContrast: true,
			straddlesFloor: true,
		};

		const html = renderSwatchPage([
			{ title: 'probe', rows: [{ label: 'row', steps: [failingStraddle] }] },
		]);

		expect(html).toContain('4.49:1');
		expect(html).not.toContain('4.50:1');
	});
});
