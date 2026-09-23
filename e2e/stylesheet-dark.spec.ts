import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';

import { PINNED_SET } from '../core/css/css.fixture';
import { toStylesheet } from '../core/css/stylesheet';

import { expect, test } from './fixtures';

/**
 * A nested `.dark` wrapper has to repaint everything under it, arbitrary values that name a theme
 * entry included. A Tailwind compile can't see that: it passes a custom property's value through
 * unread, so whether `bg-[var(--color-brand-500)]` follows the wrapper is a question only a browser
 * computing styles can answer. This spec asks one.
 *
 * Each case sits once outside any wrapper and once inside `<div class="dark">`, and the two computed
 * values have to differ. The arbitrary forms must also land on the same value the named utility
 * gets beside them, so "differs" can't pass on a third colour that is neither scheme's.
 *
 * The stylesheet comes straight off `toStylesheet(PINNED_SET)`, compiled by the `@tailwindcss/postcss`
 * this repo pins, and goes in through `setContent`, because no page of the app uses this adapter
 * yet. It still runs under `./fixtures`, whose IndexedDB cleanup visits the served origin, so like
 * every spec here it needs `pnpm build` first.
 */

/**
 * What `getComputedStyle` reports when a utility painted nothing. A class that failed to compile,
 * or a `var()` that went invalid, lands here rather than on an empty string.
 */
const UNPAINTED = { backgroundColor: 'rgba(0, 0, 0, 0)', boxShadow: 'none' } as const;

const CASES = [
	{ id: 'arbitrary-ramp', className: 'bg-[var(--color-brand-500)]', property: 'backgroundColor' },
	{
		id: 'arbitrary-semantic',
		className: 'bg-[var(--color-background)]',
		property: 'backgroundColor',
	},
	{ id: 'arbitrary-shadow', className: 'shadow-[var(--shadow-md)]', property: 'boxShadow' },
	{ id: 'named-ramp', className: 'bg-brand-500', property: 'backgroundColor' },
	{ id: 'named-semantic', className: 'bg-background', property: 'backgroundColor' },
	{ id: 'named-shadow', className: 'shadow-md', property: 'boxShadow' },
] as const;

/** Which named utility each arbitrary form has to agree with under the same wrapper. */
const NAMED_TWIN = {
	'arbitrary-ramp': 'named-ramp',
	'arbitrary-semantic': 'named-semantic',
	'arbitrary-shadow': 'named-shadow',
} as const;

/** `consumerCss` stands in for whatever the project writes after the pasted stylesheet. */
async function compiledStylesheet(
	classNames: readonly string[] = CASES.map(({ className }) => className),
	consumerCss = '',
): Promise<string> {
	const candidates = classNames.join(' ');
	const input = `@import "tailwindcss" source(none);\n@source inline("${candidates}");\n${toStylesheet(PINNED_SET)}\n${consumerCss}`;
	const result = await postcss([tailwindcss({ base: import.meta.dirname })]).process(input, {
		from: undefined,
	});

	return result.css;
}

function markup(css: string): string {
	const elements = (scheme: string) =>
		CASES.map(({ id, className }) => `<div id="${scheme}-${id}" class="${className}">x</div>`).join(
			'',
		);

	return `<!doctype html><html><head><style>${css}</style></head><body><div>${elements('light')}</div><div class="dark">${elements('dark')}</div></body></html>`;
}

test('a nested .dark repaints arbitrary theme-entry values and named utilities alike', async ({
	page,
}) => {
	await page.setContent(markup(await compiledStylesheet()));

	const computed = await page.evaluate(
		(cases) =>
			Object.fromEntries(
				cases.flatMap(({ id, property }) =>
					['light', 'dark'].map((scheme) => {
						const element = document.getElementById(`${scheme}-${id}`);
						if (!element) throw new Error(`no #${scheme}-${id}`);
						return [`${scheme}-${id}`, getComputedStyle(element)[property]];
					}),
				),
			),
		CASES.map(({ id, property }) => ({ id, property })),
	);

	for (const { id, property } of CASES) {
		// Both schemes, because an invalid dark value leaves a utility and its arbitrary twin both
		// unpainted, which differs from light and agrees with the twin, so nothing below would fail.
		for (const scheme of ['light', 'dark']) {
			expect
				.soft(computed[`${scheme}-${id}`], `${id} painted (${scheme})`)
				.not.toBe(UNPAINTED[property]);
		}
		expect
			.soft(computed[`dark-${id}`], `${id} inside .dark vs outside`)
			.not.toBe(computed[`light-${id}`]);
	}

	for (const [arbitrary, named] of Object.entries(NAMED_TWIN)) {
		for (const scheme of ['light', 'dark']) {
			expect
				.soft(computed[`${scheme}-${arbitrary}`], `${arbitrary} vs ${named} (${scheme})`)
				.toBe(computed[`${scheme}-${named}`]);
		}
	}
});

/**
 * A project that overrides one of Cambium's colours in its own `@theme` has to keep that colour on
 * `<html class="dark">`, the way shadcn toggles the scheme. The layered dark rule redeclares every
 * colour entry. Tailwind writes the consumer's entry on `:root` in the same layer, so the layered
 * rule has to sit at zero specificity. At `.dark`'s, it would win on the root, and the named
 * utility and the arbitrary value would both take Cambium's dark colour.
 */
test('a consumer\'s @theme override of a Cambium colour holds on <html class="dark">', async ({
	page,
}) => {
	const override = 'oklch(0.6 0.25 29)';
	const classNames = ['bg-primary', 'bg-[var(--color-primary)]'];
	const css = await compiledStylesheet(classNames, `@theme { --color-primary: ${override}; }`);

	await page.setContent(
		`<!doctype html><html class="dark"><head><style>${css}</style></head><body>${classNames
			.map((className, index) => `<div id="case-${index}" class="${className}">x</div>`)
			.join('')}</body></html>`,
	);

	const computed = await page.evaluate(
		(count) =>
			Array.from({ length: count }, (_, index) => {
				const element = document.getElementById(`case-${index}`);
				if (!element) throw new Error(`no #case-${index}`);
				return getComputedStyle(element).backgroundColor;
			}),
		classNames.length,
	);

	expect(computed).toEqual(classNames.map(() => override));
});
