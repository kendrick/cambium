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

async function compiledStylesheet(): Promise<string> {
	const candidates = CASES.map(({ className }) => className).join(' ');
	const input = `@import "tailwindcss" source(none);\n@source inline("${candidates}");\n${toStylesheet(PINNED_SET)}`;
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
		expect.soft(computed[`light-${id}`], `${id} outside .dark`).not.toBe(UNPAINTED[property]);
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
