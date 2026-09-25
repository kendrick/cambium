/**
 * The app's own stylesheet, compiled through the `@tailwindcss/postcss` plugin that
 * `postcss.config.mjs` hands Next, and read back utility by utility.
 *
 * `app/globals.css` points every radius, shadow, type size, font weight, leading and tracking entry
 * at the `--cmb-*` property the preview declares, with a fallback for everywhere else. Two things can
 * go wrong there, and both parse cleanly. A utility can miss its `--cmb-*` property, so the preview
 * paints the app's value instead of the brand's. Or a fallback can drift from what the utility used
 * to compile to, so every page outside the preview quietly changes. The consumer that decides both
 * is Tailwind's compiler, so the assertion reads what it emits rather than the stylesheet's source.
 *
 * `source(none)` keeps the compile hermetic, as `core/css/stylesheet.test.ts` does: Tailwind scans
 * no files and the candidates come from the `@source inline(...)` line alone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import tailwindcss from '@tailwindcss/postcss';
import postcss, { parse, type Root } from 'postcss';
import { describe, expect, it } from 'vitest';

import { cssNaming, GENERATED_VOCABULARY, type VocabularyCategory } from '../core/css/globals-css';

type Declarations = ReadonlyArray<readonly [property: string, value: string]>;

const BOX_SHADOW =
	'var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)';

/**
 * What each utility compiled to on 4ce449a, before this stylesheet named any `--cmb-*` property.
 * These are the expectations for the fallbacks, so they come from compiling that commit's
 * `app/globals.css` (`git show 4ce449a:app/globals.css`) over the same candidates, never from the
 * file under test. A theme reference such as `var(--text-base)` is written out as the value
 * Tailwind's theme layer declared for it in that compile, because the edited stylesheet inlines the
 * entry and no longer declares the property.
 *
 * `--radius` stays a reference: it's the app's own `:root` property, not a theme entry.
 */
const BASE_COMPILE: Record<string, Declarations> = {
	'rounded-sm': [['border-radius', 'calc(var(--radius) * 0.6)']],
	'rounded-md': [['border-radius', 'calc(var(--radius) * 0.8)']],
	'rounded-lg': [['border-radius', 'var(--radius)']],
	'rounded-xl': [['border-radius', 'calc(var(--radius) * 1.4)']],
	'rounded-2xl': [['border-radius', 'calc(var(--radius) * 1.8)']],
	'rounded-3xl': [['border-radius', 'calc(var(--radius) * 2.2)']],
	'rounded-4xl': [['border-radius', 'calc(var(--radius) * 2.6)']],
	'shadow-xs': [
		['--tw-shadow', '0 1px 2px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.05))'],
		['box-shadow', BOX_SHADOW],
	],
	'shadow-sm': [
		[
			'--tw-shadow',
			'0 1px 3px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 1px 2px -1px var(--tw-shadow-color, rgb(0 0 0 / 0.1))',
		],
		['box-shadow', BOX_SHADOW],
	],
	'shadow-md': [
		[
			'--tw-shadow',
			'0 4px 6px -1px var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 2px 4px -2px var(--tw-shadow-color, rgb(0 0 0 / 0.1))',
		],
		['box-shadow', BOX_SHADOW],
	],
	'shadow-lg': [
		[
			'--tw-shadow',
			'0 10px 15px -3px var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 4px 6px -4px var(--tw-shadow-color, rgb(0 0 0 / 0.1))',
		],
		['box-shadow', BOX_SHADOW],
	],
	'shadow-xl': [
		[
			'--tw-shadow',
			'0 20px 25px -5px var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 8px 10px -6px var(--tw-shadow-color, rgb(0 0 0 / 0.1))',
		],
		['box-shadow', BOX_SHADOW],
	],
	'text-xs': [
		['font-size', '0.75rem'],
		['line-height', 'var(--tw-leading, calc(1 / 0.75))'],
	],
	'text-sm': [
		['font-size', '0.875rem'],
		['line-height', 'var(--tw-leading, calc(1.25 / 0.875))'],
	],
	'text-base': [
		['font-size', '1rem'],
		['line-height', 'var(--tw-leading, calc(1.5 / 1))'],
	],
	'text-lg': [
		['font-size', '1.125rem'],
		['line-height', 'var(--tw-leading, calc(1.75 / 1.125))'],
	],
	'text-xl': [
		['font-size', '1.25rem'],
		['line-height', 'var(--tw-leading, calc(1.75 / 1.25))'],
	],
	'text-2xl': [
		['font-size', '1.5rem'],
		['line-height', 'var(--tw-leading, calc(2 / 1.5))'],
	],
	'text-3xl': [
		['font-size', '1.875rem'],
		['line-height', 'var(--tw-leading, calc(2.25 / 1.875))'],
	],
	'text-4xl': [
		['font-size', '2.25rem'],
		['line-height', 'var(--tw-leading, calc(2.5 / 2.25))'],
	],
	// Tailwind has no `regular` weight, so on 4ce449a `font-regular` compiled to nothing at all. These
	// are `font-normal`'s declarations from that compile: 400 is the weight the name means.
	'font-regular': [
		['--tw-font-weight', '400'],
		['font-weight', '400'],
	],
	'font-medium': [
		['--tw-font-weight', '500'],
		['font-weight', '500'],
	],
	'font-semibold': [
		['--tw-font-weight', '600'],
		['font-weight', '600'],
	],
	'font-bold': [
		['--tw-font-weight', '700'],
		['font-weight', '700'],
	],
	'leading-tight': [
		['--tw-leading', '1.25'],
		['line-height', '1.25'],
	],
	'leading-snug': [
		['--tw-leading', '1.375'],
		['line-height', '1.375'],
	],
	'leading-normal': [
		['--tw-leading', '1.5'],
		['line-height', '1.5'],
	],
	'leading-relaxed': [
		['--tw-leading', '1.625'],
		['line-height', '1.625'],
	],
	'tracking-tighter': [
		['--tw-tracking', '-0.05em'],
		['letter-spacing', '-0.05em'],
	],
	'tracking-tight': [
		['--tw-tracking', '-0.025em'],
		['letter-spacing', '-0.025em'],
	],
	'tracking-normal': [
		['--tw-tracking', '0em'],
		['letter-spacing', '0em'],
	],
	'tracking-wide': [
		['--tw-tracking', '0.025em'],
		['letter-spacing', '0.025em'],
	],
	'tracking-wider': [
		['--tw-tracking', '0.05em'],
		['letter-spacing', '0.05em'],
	],
};

/**
 * How a vocabulary name becomes a utility and a theme entry, and which of the utility's
 * declarations carry the token. The rest, such as `text-*`'s line height, must come through
 * untouched.
 */
const CATEGORIES: ReadonlyArray<{
	category: VocabularyCategory;
	utility: string;
	entry: string;
	carries: readonly string[];
}> = [
	{ category: 'radius step', utility: 'rounded-', entry: 'radius-', carries: ['border-radius'] },
	{ category: 'shadow step', utility: 'shadow-', entry: 'shadow-', carries: ['--tw-shadow'] },
	{ category: 'type size', utility: 'text-', entry: 'text-', carries: ['font-size'] },
	{
		category: 'font weight',
		utility: 'font-',
		entry: 'font-weight-',
		carries: ['--tw-font-weight', 'font-weight'],
	},
	{
		category: 'line height',
		utility: 'leading-',
		entry: 'leading-',
		carries: ['--tw-leading', 'line-height'],
	},
	{
		category: 'tracking step',
		utility: 'tracking-',
		entry: 'tracking-',
		carries: ['--tw-tracking', 'letter-spacing'],
	},
];

const CASES = CATEGORIES.flatMap(({ category, utility, entry, carries }) =>
	GENERATED_VOCABULARY[category].map((name) => ({
		utility: `${utility}${name}`,
		property: cssNaming().prefixedProperty(`${entry}${name}`),
		carries,
	})),
);

const TAILWIND_IMPORT = "@import 'tailwindcss';";

async function compileAppStylesheet(candidates: readonly string[]): Promise<Root> {
	const path = join(import.meta.dirname, 'globals.css');
	const source = readFileSync(path, 'utf8');
	if (!source.includes(TAILWIND_IMPORT)) {
		throw new Error(
			`app/globals.css no longer carries ${TAILWIND_IMPORT}, so the compile can't be made hermetic`,
		);
	}

	const hermetic = source.replace(
		TAILWIND_IMPORT,
		`@import 'tailwindcss' source(none);\n@source inline("${candidates.join(' ')}");`,
	);
	const result = await postcss([tailwindcss({ base: import.meta.dirname })]).process(hermetic, {
		from: path,
	});

	return parse(result.css);
}

/** Every property Tailwind's theme layer declares in this compile, with its value. */
function themeLayer(root: Root): Map<string, string> {
	const declared = new Map<string, string>();
	root.walkAtRules('layer', (layer) => {
		if (layer.params !== 'theme') return;
		layer.walkDecls((declaration) => {
			declared.set(declaration.prop, declaration.value);
		});
	});

	return declared;
}

/** Writes each fallback-less `var()` of a theme-layer property out as the value the layer holds. */
function resolveTheme(value: string, theme: Map<string, string>): string {
	const resolved = value.replaceAll(
		/var\((--[\w-]+)\)/g,
		(reference, property: string) => theme.get(property) ?? reference,
	);

	return resolved === value ? value : resolveTheme(resolved, theme);
}

/**
 * Collapses whitespace the way a CSS tokenizer does. Tailwind copies a theme value into the utility
 * byte for byte, line breaks included, and oxfmt wraps a long shadow fallback across lines, so the
 * compiled bytes carry indentation a browser ignores and a string comparison doesn't.
 */
function collapseWhitespace(value: string): string {
	return value.replaceAll(/\s+/g, ' ').replaceAll('( ', '(').replaceAll(' )', ')');
}

function compiledUtility(root: Root, utility: string, theme: Map<string, string>): Declarations {
	const declarations: Array<readonly [string, string]> = [];
	let rules = 0;
	root.walkRules((rule) => {
		if (rule.selector !== `.${utility}`) return;
		rules += 1;
		rule.walkDecls((declaration) => {
			declarations.push([
				declaration.prop,
				collapseWhitespace(resolveTheme(declaration.value, theme)),
			]);
		});
	});

	if (rules !== 1) throw new Error(`expected one rule for .${utility}, found ${rules}`);

	return declarations;
}

let compiled: Promise<Root> | undefined;

/** One compile shared by every case, started on first use so a failure lands inside a test. */
function appCompile(): Promise<Root> {
	compiled ??= compileAppStylesheet(CASES.map(({ utility }) => utility));
	return compiled;
}

describe('app/globals.css', () => {
	it('pins a base-commit compile for exactly the utilities the vocabulary names', () => {
		expect(new Set(Object.keys(BASE_COMPILE))).toEqual(
			new Set(CASES.map(({ utility }) => utility)),
		);
	});

	it.each(CASES)(
		'compiles $utility onto $property, falling back to what it compiled to on 4ce449a',
		async ({ utility, property, carries }) => {
			const root = await appCompile();
			const base = BASE_COMPILE[utility] ?? [];

			const expected = base.map(([name, value]) =>
				carries.includes(name) ? [name, `var(${property}, ${value})`] : [name, value],
			);

			expect(compiledUtility(root, utility, themeLayer(root))).toEqual(expected);
		},
	);
});
