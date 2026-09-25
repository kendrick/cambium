/**
 * The preview sets these maps as inline custom properties on its container, and the exported
 * stylesheet declares the same names under `:root` and `.dark`. Two readers of one token set, so
 * the assertion that matters is that they agree, and the side it reads is the stylesheet as a CSS
 * parser sees it. Comparing each map against `toGlobalsCss`'s return string would pass on output no
 * parser accepts, the reason `globals-css.test.ts` gives for never string-matching.
 *
 * Agreement alone can't catch both readers going wrong together, so a few values are pinned from
 * the fixture's construction rather than read out of either: `ramp()` puts light step 1 at
 * lightness 0.01 and dark step 1 at 0.51, and `NON_COLOR_FIXTURE` holds a `0.625rem` radius.
 */
import { describe, expect, it } from 'vitest';

import {
	declarationsBySelector,
	GENERATED_SET,
	OUT_OF_BOUNDS,
	PINNED_SET,
	setWithName,
	zodIssuePaths,
} from './css.fixture';
import { cssNaming, toGlobalsCss } from './globals-css';
import { scalarDeclarations, schemeDeclarations } from './scheme-declarations';

/** One selector's declarations as postcss parsed them, refusing a property that repeats. */
function parsedBlock(css: string, selector: string): Record<string, string> {
	const declarations = declarationsBySelector(css).get(selector);
	if (!declarations) throw new Error(`no ${selector} rule`);

	const block = Object.fromEntries(declarations.map(({ prop, value }) => [prop, value]));
	expect(Object.keys(block)).toHaveLength(declarations.length);
	return block;
}

const CASES = [
	{ label: 'the pinned set, default prefix', set: PINNED_SET, prefix: undefined },
	{ label: 'the generated set, default prefix', set: GENERATED_SET, prefix: undefined },
	{ label: 'the pinned set, prefix foo--bar', set: PINNED_SET, prefix: 'foo--bar' },
];

describe('schemeDeclarations and scalarDeclarations', () => {
	it.each(CASES)('match what the stylesheet declares, for $label', ({ set, prefix }) => {
		const naming = cssNaming({ prefix });
		const css = toGlobalsCss(set, naming);

		expect(parsedBlock(css, ':root')).toEqual({
			...schemeDeclarations(set, 'light', naming),
			...scalarDeclarations(set, naming),
		});
		expect(parsedBlock(css, '.dark')).toEqual(schemeDeclarations(set, 'dark', naming));
	});

	it('keeps the scalars out of both scheme maps, so merging one in overwrites nothing', () => {
		const naming = cssNaming();
		const scalars = Object.keys(scalarDeclarations(GENERATED_SET, naming));

		for (const scheme of ['light', 'dark'] as const) {
			const held = Object.keys(schemeDeclarations(GENERATED_SET, scheme, naming));
			expect(held.filter((property) => scalars.includes(property))).toEqual([]);
		}
	});

	it("reads each scheme's own values and carries the scalars once", () => {
		const naming = cssNaming();
		const light = schemeDeclarations(PINNED_SET, 'light', naming);
		const dark = schemeDeclarations(PINNED_SET, 'dark', naming);
		const scalars = scalarDeclarations(PINNED_SET, naming);

		expect(light['--cmb-color-brand-25']).toBe('oklch(0.01 0.02 260)');
		expect(dark['--cmb-color-brand-25']).toBe('oklch(0.51 0.03 260)');
		expect(scalars['--cmb-radius-lg']).toBe('0.625rem');
		expect(light).not.toHaveProperty('--cmb-radius-lg');
		expect(dark).not.toHaveProperty('--cmb-radius-lg');
	});

	it('refuses a name outside the vocabulary, the way the stylesheet does', () => {
		const naming = cssNaming();
		const foreign = setWithName('radius step', 'huge');

		expect(() => toGlobalsCss(foreign, naming)).toThrow(/radius step "huge"/);
		expect(() => schemeDeclarations(foreign, 'dark', naming)).toThrow(/radius step "huge"/);
		expect(() => scalarDeclarations(foreign, naming)).toThrow(/radius step "huge"/);
	});

	it.each(OUT_OF_BOUNDS)('refuses a $bound, the way the stylesheet does', ({ path, set }) => {
		const naming = cssNaming();

		expect(zodIssuePaths(() => schemeDeclarations(set, 'light', naming))).toContain(path);
		expect(zodIssuePaths(() => schemeDeclarations(set, 'dark', naming))).toContain(path);
		expect(zodIssuePaths(() => scalarDeclarations(set, naming))).toContain(path);
	});
});
