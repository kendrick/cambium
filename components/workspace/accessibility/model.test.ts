import { describe, expect, it } from 'vitest';

import photoWindow from '../../../app/demo/fixtures/photo-window.json';
import { BrandSeedSchema } from '../../../core/brand-seed';
import { checkContrast } from '../../../core/contrast/check';
import { withContrastRepairs } from '../../../core/contrast/repair';
import { BALANCED } from '../../../core/interpretation';
import { createOklchScaleEngine } from '../../../core/oklch-scale-engine';
import { repairPinsFor } from '../../../core/seed-pins';
import { buildTokenSet } from '../../../core/semantic-layer';
import { applyOverrides, overrideKey, type TokenOverride } from '../../../core/token-overrides';
import { declineFor, failingRows, repairRows, UNREPAIRED_REASON_TEXT } from './model';

const seed = BrandSeedSchema.parse(photoWindow.versions[0]!.seed);
const generated = createOklchScaleEngine().generate(seed, BALANCED);
if (!generated.ok) throw new Error(`the scale engine rejected the seed: ${generated.error.kind}`);

const base = buildTokenSet(generated.schemes, seed, BALANCED);
const repaired = withContrastRepairs(base, { pinned: repairPinsFor(seed, ['keyColors.0']) });
const applied = repaired.report;

const rowsFor = (overrides: Record<string, TokenOverride> = {}) =>
	repairRows(applied, repaired.tokenSet, overrides);

describe('repairRows on photo-window', () => {
	it('lists the three moved steps in repair order', () => {
		expect(rowsFor().map((row) => row.id)).toEqual([
			'light:brand.1',
			'light:neutral.11',
			'dark:brand.1',
		]);
	});

	it('gives light brand.1 the two pairs it backs', () => {
		const [row] = rowsFor();

		expect(row!.specimens.map((s) => `${s.foreground} on ${s.background}`)).toEqual([
			'primary-foreground on primary',
			'sidebar-primary-foreground on sidebar-primary',
		]);
		expect(row!.specimens.every((s) => s.kind === 'text' && s.target === 4.5)).toBe(true);
	});

	// Figures are the plan's measured Context values for photo-window, not read back from the module.
	it.each([
		['light:brand.1', 4.18, 4.51],
		['light:neutral.11', 4.41, 4.54],
		['dark:brand.1', 4.35, 4.52],
	])('prints %s at %s before and %s after', (id, before, after) => {
		const row = rowsFor().find((r) => r.id === id)!;
		const first = row.specimens[0]!;

		expect(first.before.ratio).toBeCloseTo(before, 2);
		expect(first.after.ratio).toBeCloseTo(after, 2);
	});

	it('reads applied, declined and edited off the override map', () => {
		const entry = applied[0]!;
		const decline = declineFor(entry);
		const key = overrideKey(decline);

		expect(rowsFor()[0]!.status).toBe('applied');
		expect(rowsFor({ [key]: decline })[0]!.status).toBe('declined');
		expect(rowsFor({ [key]: { ...decline, l: 0.5 } as TokenOverride })[0]!.status).toBe('edited');
	});
});

function withLightBrandDeclined() {
	const decline = declineFor(applied[0]!);
	const result = applyOverrides(repaired.tokenSet, [decline]);
	if (!result.ok) throw new Error('decline rejected');

	const overrides = { [overrideKey(decline)]: decline };

	return {
		rows: repairRows(applied, result.tokenSet, overrides),
		report: checkContrast(result.tokenSet),
	};
}

describe('failingRows', () => {
	it('names nothing failing when the repaired set passes', () => {
		expect(
			failingRows({ report: checkContrast(repaired.tokenSet), unrepaired: [] }, rowsFor(), {}),
		).toEqual([]);
	});

	it('blames a declined repair for the two light pairs it backs', () => {
		const { rows, report } = withLightBrandDeclined();
		const failing = failingRows({ report, unrepaired: [] }, rows, {});

		expect(failing.map((f) => f.line)).toEqual([
			'light: primary-foreground on primary: 4.18:1, needs 4.5',
			'light: sidebar-primary-foreground on sidebar-primary: 4.18:1, needs 4.5',
		]);
		expect(failing.map((f) => f.cause)).toEqual([
			'Repair declined: light brand.1',
			'Repair declined: light brand.1',
		]);
	});

	it('falls back to #153 attribution, then to the unrepaired reason, then to null', () => {
		const { report } = withLightBrandDeclined();
		const [first, second] = report.filter((e) => !e.passes);
		const key = JSON.stringify(['alias', 'light', 'primary']);

		const rows = failingRows(
			{ report, unrepaired: [{ ...second!, reason: 'no-lightness-clears' }] },
			[],
			{ [key]: [first!] },
		);

		expect(rows.map((r) => r.cause)).toEqual([
			'Your override of primary',
			UNREPAIRED_REASON_TEXT['no-lightness-clears'],
		]);
		expect(failingRows({ report, unrepaired: [] }, [], {}).map((r) => r.cause)).toEqual([
			null,
			null,
		]);
	});

	it('leaves the AA verdict to WCAG alone, whatever APCA reads', () => {
		const report = checkContrast(repaired.tokenSet);
		const lowLc = report.map((e) => Object.assign({}, e, { apca: 0 }));
		const failingWcag = report.map((e) =>
			Object.assign({}, e, { wcag: 1, passes: false, apca: 108 }),
		);

		expect(failingRows({ report: lowLc, unrepaired: [] }, [], {})).toEqual([]);
		expect(failingRows({ report: failingWcag, unrepaired: [] }, [], {})).toHaveLength(26);
	});
});

describe('UNREPAIRED_REASON_TEXT', () => {
	it('words every reason', () => {
		for (const text of Object.values(UNREPAIRED_REASON_TEXT))
			expect(text.length).toBeGreaterThan(0);
	});
});
