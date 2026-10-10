import { describe, expect, it } from 'vitest';

import photoWindow from '../../../app/demo/fixtures/photo-window.json';
import { BrandSeedSchema } from '../../../core/brand-seed';
import { type ContrastEntry, checkContrast } from '../../../core/contrast/check';
import { withContrastRepairs } from '../../../core/contrast/repair';
import { BALANCED } from '../../../core/interpretation';
import { createOklchScaleEngine } from '../../../core/oklch-scale-engine';
import { repairPinsFor } from '../../../core/seed-pins';
import { buildTokenSet } from '../../../core/semantic-layer';
import { stepForAlias } from '../../../core/token-set';
import { applyOverrides, overrideKey, type TokenOverride } from '../../../core/token-overrides';
import {
	COMBINED_CAUSE,
	declineFor,
	failingRows,
	repairRows,
	UNREPAIRED_REASON_TEXT,
} from './model';

const seed = BrandSeedSchema.parse(photoWindow.versions[0]!.seed);
const generated = createOklchScaleEngine().generate(seed, BALANCED);
if (!generated.ok) throw new Error(`the scale engine rejected the seed: ${generated.error.kind}`);
const ramps = generated.schemes;

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
		context: { attributed: {}, overrides, tokenSet: result.tokenSet, ramps },
	};
}

const NOTHING = {
	attributed: {},
	overrides: {},
	tokenSet: repaired.tokenSet,
	ramps,
};

const same = (a: ContrastEntry, b: ContrastEntry) =>
	a.scheme === b.scheme && a.foreground === b.foreground && a.background === b.background;

/**
 * A light-scheme step nudged off its repaired lightness. The nudges here are small, so none lands on
 * a pre-repair colour and reads as a decline.
 */
function primitiveEdit(ramp: string, step: number, dl: number): TokenOverride {
	const colour = stepForAlias(repaired.tokenSet.schemes.light.primitives, `${ramp}.${step}`)!;

	return {
		kind: 'primitive',
		scheme: 'light',
		ramp,
		step,
		l: colour.l + dl,
		c: colour.c,
		h: colour.h,
	};
}

function failingWith(edits: TokenOverride[]) {
	const result = applyOverrides(repaired.tokenSet, edits);
	if (!result.ok) throw new Error('edit rejected');

	const overrides = Object.fromEntries(edits.map((edit) => [overrideKey(edit), edit]));

	return {
		report: checkContrast(result.tokenSet),
		rows: repairRows(applied, result.tokenSet, overrides),
		context: { attributed: {}, overrides, tokenSet: result.tokenSet, ramps },
	};
}

describe('failingRows', () => {
	it('names nothing failing when the repaired set passes', () => {
		expect(
			failingRows({ report: checkContrast(repaired.tokenSet), unrepaired: [] }, rowsFor(), NOTHING),
		).toEqual([]);
	});

	it('blames a declined repair for the two light pairs it backs', () => {
		const { rows, report, context } = withLightBrandDeclined();
		const failing = failingRows({ report, unrepaired: [] }, rows, context);

		expect(failing.map((f) => f.line)).toEqual([
			'light: primary-foreground on primary: 4.18:1, needs 4.5',
			'light: sidebar-primary-foreground on sidebar-primary: 4.18:1, needs 4.5',
		]);
		expect(failing.map((f) => f.cause)).toEqual([
			'Repair declined: light brand.1',
			'Repair declined: light brand.1',
		]);
	});

	it('falls back to #153 attribution, then to the unrepaired reason, then to a combined cause', () => {
		const { report } = withLightBrandDeclined();
		const [first, second] = report.filter((e) => !e.passes);
		const override: TokenOverride = {
			kind: 'alias',
			scheme: 'light',
			token: 'primary',
			alias: 'brand.1',
		};
		const key = overrideKey(override);

		const rows = failingRows(
			{ report, unrepaired: [{ ...second!, reason: 'no-lightness-clears' }] },
			[],
			{
				attributed: { [key]: [first!] },
				overrides: { [key]: override },
				tokenSet: repaired.tokenSet,
				ramps,
			},
		);

		expect(rows.map((r) => r.cause)).toEqual([
			'Your override of primary',
			UNREPAIRED_REASON_TEXT['no-lightness-clears'],
		]);

		const unexplained = failingRows({ report, unrepaired: [] }, [], NOTHING);

		expect(unexplained.map((r) => r.cause)).toEqual([COMBINED_CAUSE, COMBINED_CAUSE]);
	});

	it('names a hand-edited primitive step that breaks a pair', () => {
		const entry = applied.find(
			(e) => e.scheme === 'light' && e.ramp === 'neutral' && e.step === 11,
		)!;
		// Lighter than the pre-repair colour, so not a decline, and further from AA on `muted`.
		const edit: TokenOverride = {
			kind: 'primitive',
			scheme: 'light',
			ramp: 'neutral',
			step: 11,
			...entry.from,
			l: entry.from.l + 0.03,
		};
		const result = applyOverrides(repaired.tokenSet, [edit]);
		if (!result.ok) throw new Error('edit rejected');

		const overrides = { [overrideKey(edit)]: edit };
		const failing = failingRows(
			{ report: checkContrast(result.tokenSet), unrepaired: [] },
			repairRows(applied, result.tokenSet, overrides),
			{ attributed: {}, overrides, tokenSet: result.tokenSet, ramps },
		);
		const muted = failing.find(
			(f) => f.entry.foreground === 'muted-foreground' && f.entry.background === 'muted',
		);

		expect(muted?.entry.scheme).toBe('light');
		expect(muted?.cause).toBe('Your override of light neutral.11');
	});

	it('explains an unrepaired pair by its reason, not by a later edit to one of its steps', () => {
		const edit = primitiveEdit('neutral', 11, +0.03);
		const { report, rows, context } = failingWith([edit]);
		const muted = report.find(
			(e) => e.foreground === 'muted-foreground' && e.background === 'muted',
		)!;

		const failing = failingRows(
			{ report, unrepaired: [{ ...muted, reason: 'no-lightness-clears' }] },
			rows,
			context,
		);

		expect(failing.find((f) => same(f.entry, muted))?.cause).toBe(
			UNREPAIRED_REASON_TEXT['no-lightness-clears'],
		);
	});

	// photo-window's light `muted-foreground on muted` is neutral.11 on neutral.3. Lighter ink and darker
	// fill both pull the ratio down, so reverting either edit alone needn't clear it.
	it('names no single override when both operands are hand-edited', () => {
		const { report, rows, context } = failingWith([
			primitiveEdit('neutral', 11, +0.03),
			primitiveEdit('neutral', 3, -0.05),
		]);
		const failing = failingRows({ report, unrepaired: [] }, rows, context);
		const muted = failing.find(
			(f) => f.entry.scheme === 'light' && f.entry.foreground === 'muted-foreground',
		);

		expect(muted?.cause).toBe(COMBINED_CAUSE);
	});

	// The decline puts back brand.1's near-white ink on brand.9, and Restore brings the dark ink back.
	// A slightly darker brand.9 sits below AA under either ink, so neither step alone clears the pair.
	it('names no single override when a declined step also has an edited partner', () => {
		const { report, rows, context } = failingWith([
			declineFor(applied[0]!),
			primitiveEdit('brand', 9, -0.01),
		]);
		const failing = failingRows({ report, unrepaired: [] }, rows, context);
		const primary = failing.find(
			(f) => f.entry.scheme === 'light' && f.entry.foreground === 'primary-foreground',
		);

		expect(primary?.cause).toBe(COMBINED_CAUSE);
	});

	// A lighter brand.9 pushes the near-white ink further below AA, but Restore's dark ink clears it.
	// So the decline is the override to name, though both steps are edited.
	it('names the one override whose reversal clears the pair when two sit on it', () => {
		const { report, rows, context } = failingWith([
			declineFor(applied[0]!),
			primitiveEdit('brand', 9, +0.05),
		]);
		const failing = failingRows({ report, unrepaired: [] }, rows, context);

		expect(
			failing.find((f) => f.entry.scheme === 'light' && f.entry.foreground === 'primary-foreground')
				?.cause,
		).toBe('Repair declined: light brand.1');
	});

	// The neutral.3 edit is listed first, so a lookup that only checks operands names it. A lighter
	// neutral.3 raises the ratio, though, and reverting it leaves the pair failing.
	it('skips an edit on an operand whose reversal leaves the pair failing', () => {
		const { report, rows, context } = failingWith([
			primitiveEdit('neutral', 3, +0.01),
			primitiveEdit('neutral', 11, +0.03),
		]);
		const failing = failingRows({ report, unrepaired: [] }, rows, context);
		const muted = failing.find(
			(f) => f.entry.scheme === 'light' && f.entry.foreground === 'muted-foreground',
		);

		expect(muted?.cause).toBe('Your override of light neutral.11');
	});

	it('leaves the AA verdict to WCAG alone, whatever APCA reads', () => {
		const report = checkContrast(repaired.tokenSet);
		const lowLc = report.map((e) => Object.assign({}, e, { apca: 0 }));
		const failingWcag = report.map((e) =>
			Object.assign({}, e, { wcag: 1, passes: false, apca: 108 }),
		);

		expect(failingRows({ report: lowLc, unrepaired: [] }, [], NOTHING)).toEqual([]);
		expect(failingRows({ report: failingWcag, unrepaired: [] }, [], NOTHING)).toHaveLength(26);
	});
});

describe('UNREPAIRED_REASON_TEXT', () => {
	it('words every reason', () => {
		for (const text of Object.values(UNREPAIRED_REASON_TEXT))
			expect(text.length).toBeGreaterThan(0);
	});
});
