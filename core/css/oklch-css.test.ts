/**
 * `toOklchCss` never gets string-matched here: an expected literal like `'oklch(0.205 0 0)'`
 * would pass on output no browser can parse just as readily as on output that renders. Every
 * assertion below runs the emitted declaration through postcss, walks to the declaration node
 * postcss actually parsed, and checks the numbers it found against a value rounded by
 * `toFixed`/`Number` — a decimal-string technique that shares no scale-multiply step with the
 * implementation's own `roundTo`, so a bug in one has nothing to hide behind agreement with the
 * other.
 */
import { parse } from 'postcss';
import { describe, expect, it } from 'vitest';

import type { Oklch } from '../oklch';
import { toOklchCss } from './oklch-css';

/** `oklch(<l> <c> <h>)`: three space-separated numbers, no comma, no alpha slot. */
const OKLCH_TRIPLE = /^oklch\(([^\s]+) ([^\s]+) ([^\s]+)\)$/;

/** The same triple with CSS Color 4's alpha slot behind the slash: `oklch(1 0 0 / 10%)`. */
const OKLCH_WITH_ALPHA = /^oklch\((\S+) (\S+) (\S+) \/ (\S+)\)$/;

/** Parses `--x: <css>;` inside a rule and hands back the one declaration postcss found there. */
function parseDeclaration(css: string) {
	const root = parse(`:root { --x: ${css}; }`);
	const rule = root.first;
	if (rule?.type !== 'rule') throw new Error(`expected a rule, got ${rule?.type}`);
	const decl = rule.first;
	if (decl?.type !== 'decl') throw new Error(`expected a declaration, got ${decl?.type}`);
	return decl;
}

function channels(value: string): [number, number, number] {
	const match = OKLCH_TRIPLE.exec(value);
	if (!match) throw new Error(`not an oklch() triple: ${value}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Independent ruler: JS's own decimal-string rounding, not the implementation's scale-multiply. */
function expectedChannel(raw: number, places: number): number {
	return Number(raw.toFixed(places));
}

describe('toOklchCss', () => {
	it('parses as a valid CSS custom property declaration holding an oklch() triple', () => {
		const decl = parseDeclaration(toOklchCss({ l: 0.65, c: 0.12, h: 250 }));

		expect(decl.prop).toBe('--x');
		expect(OKLCH_TRIPLE.test(decl.value)).toBe(true);
	});

	it('round-trips each channel through the parser at the default 6-place precision', () => {
		const input: Oklch = { l: 0.6512345678, c: 0.10987654321, h: 245.123456789 };
		const decl = parseDeclaration(toOklchCss(input));
		const [l, c, h] = channels(decl.value);

		expect(l).toBeCloseTo(expectedChannel(input.l, 6), 9);
		expect(c).toBeCloseTo(expectedChannel(input.c, 6), 9);
		expect(h).toBeCloseTo(expectedChannel(input.h, 6), 9);
	});

	it('honors a caller-supplied rounding precision', () => {
		const input: Oklch = { l: 0.123456, c: 0.654321, h: 45.6789 };
		const decl = parseDeclaration(toOklchCss(input, { places: 2 }));
		const [l, c, h] = channels(decl.value);

		expect(l).toBeCloseTo(expectedChannel(input.l, 2), 9);
		expect(c).toBeCloseTo(expectedChannel(input.c, 2), 9);
		expect(h).toBeCloseTo(expectedChannel(input.h, 2), 9);
	});

	it('trims trailing zeros so whole and round values print compactly', () => {
		// Matches the compact style `app/globals.css` already uses — `oklch(1 0 0)`, never
		// `oklch(1.000000 0.000000 0.000000)`.
		const decl = parseDeclaration(toOklchCss({ l: 1, c: 0, h: 0 }));
		const match = OKLCH_TRIPLE.exec(decl.value);

		expect(match?.slice(1)).toEqual(['1', '0', '0']);
	});

	it('folds a channel that rounds to negative zero back to the bare digit 0', () => {
		const decl = parseDeclaration(toOklchCss({ l: 1, c: -0.0000001, h: 0 }));
		const match = OKLCH_TRIPLE.exec(decl.value);

		expect(match?.[2]).toBe('0');
		expect(Object.is(channels(decl.value)[1], -0)).toBe(false);
	});

	it('never emits an alpha slot for a plain triple', () => {
		const decl = parseDeclaration(toOklchCss({ l: 0.205, c: 0, h: 0 }));

		expect(decl.value).not.toMatch(/\//);
	});

	it('prints a supplied alpha as a percentage in the slash slot', () => {
		// `app/globals.css` writes a translucent colour as `oklch(1 0 0 / 10%)`, and `SHADOW_FIXTURE`
		// carries `alpha: 0.1`. So the required reading of 0.1 is `10%`, settled off the stylesheet
		// this adapter has to look like rather than off whatever arithmetic the emitter does.
		const decl = parseDeclaration(toOklchCss({ l: 0.15, c: 0.02, h: 259.8, alpha: 0.1 }));
		const match = OKLCH_WITH_ALPHA.exec(decl.value);

		expect(match?.[4]).toBe('10%');
	});

	it('treats a fully transparent alpha as a value rather than as an absence', () => {
		// Zero is falsy, so an emitter that tests `if (color.alpha)` prints an opaque triple for a
		// colour meant to disappear, and the stylesheet renders with no error anywhere.
		const decl = parseDeclaration(toOklchCss({ l: 0.5, c: 0.1, h: 180, alpha: 0 }));
		const match = OKLCH_WITH_ALPHA.exec(decl.value);

		expect(match?.[4]).toBe('0%');
	});

	it('rounds the alpha percentage, not the 0-to-1 fraction, at the caller-supplied precision', () => {
		// An alpha of 0.123456 is 12.3456% of opacity; two places of a percent keeps 12.35%. Rounding
		// the fraction first would keep 12.35% only by accident and 0.12 -> 12% at three places.
		const decl = parseDeclaration(
			toOklchCss({ l: 0.5, c: 0.1, h: 180, alpha: 0.123456 }, { places: 2 }),
		);
		const match = OKLCH_WITH_ALPHA.exec(decl.value);

		expect(match?.[4]).toBe('12.35%');
	});

	it('is a pure function: same triple in yields the same string, and the input is untouched', () => {
		const input: Oklch = Object.freeze({ l: 0.5, c: 0.1, h: 180 });

		expect(toOklchCss(input)).toBe(toOklchCss(input));
		expect(() => toOklchCss(input)).not.toThrow();
		expect(input).toEqual({ l: 0.5, c: 0.1, h: 180 });
	});
});
