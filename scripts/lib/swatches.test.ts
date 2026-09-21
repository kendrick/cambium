import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STEP_ROLES } from '../../core/step-roles';
import { loadSchemes } from './cli.mjs';
import { contrastFromOklch, readOklch } from '../../core/oklch';
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

describe('measureRamp agrees with the hex it paints', () => {
	// measureStep paints `hex` and reports `wcag` from `renderedContrast`, which builds its bytes
	// from the rgb converter rather than from the hex string. Two paths to one byte triple, and a
	// cell whose number describes a different colour from the one it shows is the exact failure this
	// harness exists to catch, so the agreement is asserted rather than assumed. It also backs the
	// claim in `renderedContrast`'s docblock that skipping the `formatHex` import costs nothing.
	it('reports the ratio the painted hex pair actually has', () => {
		const background = { mode: 'oklch', l: 0.982, c: 0.006911, h: 157.7 };
		const drift: string[] = [];

		for (let l = 0; l <= 1.0001; l += 0.05) {
			for (let c = 0; c <= 0.3001; c += 0.05) {
				for (let h = 0; h < 360; h += 15) {
					const [measured, painted] = measureRamp([
						{ mode: 'oklch', l, c, h },
						background,
					]) as Array<{ hex: string; wcag: number }>;
					// Both hex strings come from measureStep itself, so the comparison is against the
					// colours the page paints rather than against a second opinion computed here.
					const viaHex = contrastFromOklch(readOklch(measured!.hex), readOklch(painted!.hex));

					if (Math.abs(measured!.wcag - viaHex) > 1e-9) {
						drift.push(`${l}/${c}/${h}: reported ${measured!.wcag}, hex pair ${viaHex}`);
					}
				}
			}
		}

		expect(drift).toEqual([]);
	});
});

describe('measureRamp against a real ramp', () => {
	// The light/success ramp core/oklch-scale-engine.ts produced for scripts/fixtures/seed.json
	// before #72, frozen here rather than generated. Step 11 clears its 4.5 WCAG floor at full
	// precision (4.5159) and drops under it as the 8-bit hex the cell paints (4.4997), which is
	// exactly the straddle this harness exists to make visible. #72 stopped the engine emitting a
	// ramp like this, so these twelve triples are retained precisely because nothing generates them
	// any more. Delete them and the straddle path has no real case to run on.
	const PRE_72_LIGHT_SUCCESS = [
		[0.994, 0.002525, 157.7],
		[0.982, 0.006911, 157.7],
		[0.959, 0.01648, 157.7],
		[0.932, 0.029238, 157.7],
		[0.9, 0.039471, 157.7],
		[0.859, 0.050635, 157.7],
		[0.806, 0.064722, 157.7],
		[0.734, 0.084126, 157.7],
		[0.6406, 0.1329, 157.7],
		[0.6136, 0.131704, 157.7],
		[0.544, 0.096087, 157.7],
		[0.332, 0.042528, 157.7],
	].map(([l, c, h]) => ({ mode: 'oklch', l, c, h }));

	it('flags a step as failing its rendered floor while its exact colour clears it', () => {
		const steps = measureRamp(PRE_72_LIGHT_SUCCESS, STEP_ROLES) as MeasuredStep[];
		const step11 = steps[10]!;

		expect(step11.step).toBe(11);
		expect(step11.wcag).toBeCloseTo(4.4997, 3);
		expect(step11.failsContrast).toBe(true);
		expect(step11.straddlesFloor).toBe(true);
	});

	// The other half of the same claim, and the one that would have caught #72 from this side: a
	// ramp the current engine generates has to come back clean, or the harness is reporting a
	// defect the engine already fixed.
	it('flags nothing on the ramp the engine generates today', async () => {
		const seedPath = fileURLToPath(new URL('../fixtures/seed.json', import.meta.url));
		const { schemes } = await loadSchemes(seedPath);
		const steps = measureRamp(schemes.light.success.map(asCulori), STEP_ROLES) as MeasuredStep[];

		expect(steps.filter((step) => step.failsContrast)).toEqual([]);
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
