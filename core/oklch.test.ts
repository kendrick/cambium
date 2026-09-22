/**
 * Only `toSrgbHex` is covered here, and deliberately so. The rest of `core/oklch.ts` is exercised
 * through the engines that call it, where a wrong answer shows up as a ramp that misses its step
 * role or a pair that misses its floor. `toSrgbHex` has no such downstream: it writes a value
 * straight into a DTCG document for a tool Cambium never heard of, so nothing but a test here
 * stands between a rounding bug and the artifact a user keeps.
 *
 * culori's `formatHex` is the ruler throughout, and the test has to reach for it because the
 * implementation may not. `toSrgbHex` takes its bytes off the rounding the contrast gate uses, or
 * #72 happens again, so grading it with that same rounding would prove only that the code agrees
 * with itself. Each of the five defects in #76's post-mortem had a test that stayed inside the
 * source language and passed.
 */
import * as culori from 'culori/fn';
import { describe, expect, it } from 'vitest';

import { type Oklch, readOklch, renderedContrast, toSrgbHex } from './oklch';

/**
 * `core/culori-fn.d.ts` declares only the culori surface the product calls, and `formatHex` is
 * deliberately not on that list: `toSrgbHex` is forbidden from reaching for it. It is declared here
 * instead of widened there so the shared file keeps doubling as the list of modes `core/oklch.ts`
 * has to register. A test-only ruler on that list would read as a product call site.
 *
 * Reached through the namespace import rather than a named one because an augmented name and an
 * imported name of the same spelling read as a shadow to the linter.
 */
declare module 'culori/fn' {
	export function formatHex(color: CuloriColor): string;
}

/**
 * The grid every sweep walks: coarse enough to run in milliseconds, fine enough to cross a channel
 * boundary thousands of times over. 6,615 samples, no sample depending on any other, and the
 * chroma axis deliberately running past the sRGB boundary so the clamp is exercised too.
 */
const LIGHTNESSES = Array.from({ length: 21 }, (_, i) => i / 20);
const CHROMAS = Array.from({ length: 21 }, (_, i) => (i * 0.4) / 20);
const HUES = Array.from({ length: 15 }, (_, i) => i * 24);

const sweep: Oklch[] = LIGHTNESSES.flatMap((l) =>
	CHROMAS.flatMap((c) => HUES.map((h) => ({ l, c, h }))),
);

/**
 * Hex back to the three bytes it spells, by hand.
 *
 * Reading the hex through culori's parser would put culori on both sides of the comparison, which
 * turns an assertion about bytes into an assertion that culori agrees with culori.
 */
function bytesOf(hex: string): { mode: 'rgb'; r: number; g: number; b: number } {
	const digits = hex.slice(1);

	return {
		mode: 'rgb',
		r: Number.parseInt(digits.slice(0, 2), 16) / 255,
		g: Number.parseInt(digits.slice(2, 4), 16) / 255,
		b: Number.parseInt(digits.slice(4, 6), 16) / 255,
	};
}

const WHITE: Oklch = { l: 1, c: 0, h: 0 };

describe('toSrgbHex', () => {
	it('spells every sample as six lowercase digits', () => {
		const wrong = sweep.filter((color) => !/^#[0-9a-f]{6}$/.test(toSrgbHex(color)));

		expect(wrong).toEqual([]);
	});

	it('lands on the same bytes culori does across lightness, chroma and hue', () => {
		const disagreements = sweep
			.map((color) => ({
				color,
				ours: toSrgbHex(color),
				culori: culori.formatHex({ mode: 'oklch', ...color }),
			}))
			.filter((row) => row.ours !== row.culori);

		expect(disagreements).toEqual([]);
	});

	/**
	 * The one that #72 is about. A hex rounded independently of the contrast gate can differ from
	 * the byte pair the gate measured, which puts a step below a floor it declares it clears. So the
	 * assertion is in the consumer's units: take the bytes a browser would read out of the emitted
	 * hex, run WCAG over them, and demand the figure `renderedContrast` gated on. The comparison is
	 * exact, because a tolerance would swallow the one-byte drift it exists to catch.
	 */
	it('carries the bytes the contrast gate measured', () => {
		const drifted = sweep
			.map((color) => ({
				color,
				fromHex: culori.wcagContrast(bytesOf(toSrgbHex(color)), bytesOf(toSrgbHex(WHITE))),
				gated: renderedContrast(color, WHITE),
			}))
			.filter((row) => row.fromHex !== row.gated);

		expect(drifted).toEqual([]);
	});

	it('is a fixed point for a colour that came from eight-bit sRGB', () => {
		expect(toSrgbHex(readOklch('#0090ff'))).toBe('#0090ff');
		expect(toSrgbHex(readOklch('#ffffff'))).toBe('#ffffff');
		expect(toSrgbHex(readOklch('#000000'))).toBe('#000000');
	});

	/**
	 * No ramp step reaches here out of gamut, because `fitToSrgbGamut` and `quantizeToSrgb` run
	 * first, so this pins the answer for a colour that arrives some other way. Clamping is the
	 * honest answer. A browser clamps an out-of-range channel too, and this is the same clamp
	 * `renderedContrast` applies, so the hex cannot contradict the gate even here.
	 */
	it('clamps a colour outside sRGB rather than inventing digits', () => {
		const tooSaturated: Oklch = { l: 0.6, c: 0.37, h: 145 };
		const hex = toSrgbHex(tooSaturated);

		expect(hex).toMatch(/^#[0-9a-f]{6}$/);
		expect(hex).toBe(culori.formatHex({ mode: 'oklch', ...tooSaturated }));
	});

	it('is pure and deterministic', () => {
		const color: Oklch = { l: 0.6231, c: 0.188, h: 259.8 };
		const before = { ...color };

		expect(toSrgbHex(color)).toBe(toSrgbHex(color));
		expect(color).toEqual(before);
	});
});
