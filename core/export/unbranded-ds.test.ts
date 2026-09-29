import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BrandSeedSchema } from '../brand-seed';
import { withContrastRepairs } from '../contrast/repair';
import { BALANCED } from '../interpretation';
import { type Oklch, renderedContrast } from '../oklch';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { buildTokenSet } from '../semantic-layer';
import type { TokenSet } from '../token-set';
import {
	toUnbrandedDsSource,
	toUnbrandedDsTheme,
	UNBRANDED_DS_MAPPING,
	unbrandedDsReport,
} from './unbranded-ds';
import vendored from './unbranded-ds.vendor.json';

/**
 * unbranded-ds's contrast arithmetic, transcribed from `packages/tokens/src/color.ts` at the
 * vendored SHA: `parseOklch`, `oklchToOklab`, `oklabToLinearRgb`, `relativeLuminance` and
 * `contrastRatio`, with no 8-bit rounding and no gamut clamp. Transcribing it keeps each contrast
 * assertion here in the units `validateTheme` measures. Importing Cambium's colour math would let
 * the test agree with the adapter by sharing its code.
 */
function targetContrast(foreground: string, background: string): number {
	const [one, two] = [targetLuminance(foreground), targetLuminance(background)];

	return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

function targetLuminance(color: string): number {
	const match = TARGET_OKLCH.exec(color.trim());

	if (!match) throw new Error(`the target can't parse ${color}`);

	const lightness = Number.parseFloat(match[1]!) / (match[2] === '%' ? 100 : 1);
	const chroma = Number.parseFloat(match[3]!);
	const hue = (Number.parseFloat(match[4]!) * Math.PI) / 180;
	const a = chroma * Math.cos(hue);
	const b = chroma * Math.sin(hue);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const seedPath = fileURLToPath(new URL('../../scripts/fixtures/seed.json', import.meta.url));
const seed = BrandSeedSchema.parse(JSON.parse(readFileSync(seedPath, 'utf8')));
const generated = createOklchScaleEngine().generate(seed, BALANCED);

if (!generated.ok) throw new Error(`the seed fixture no longer generates: ${generated.error.kind}`);

/**
 * The contrast-repaired set, which is what the app exports and what the adapters document as their
 * input. The unrepaired set fails the target's own light-scheme pairs before any mapping happens.
 */
const tokenSet = withContrastRepairs(buildTokenSet(generated.schemes, seed)).tokenSet;
const identity = { name: 'acme', displayName: 'Acme' };

const vendoredTokens = vendored.tokens as Record<string, Record<string, string>>;
const optionalCategories = new Set<string>(vendored.optionalCategories);

/**
 * A mirror of unbranded-ds's `themeSchema` (`packages/tokens/src/schema.ts`) built from the vendored
 * key list, but strict where the original is lenient. The target merges a partial theme onto its
 * defaults before validating, so a missing key there passes silently by inheriting; here it fails,
 * which is the only way to see whether Cambium actually supplied it. Strict also fails a document
 * carrying a key the target never declared. A mapping row naming such a key never reaches the
 * document at all, so the test over `UNBRANDED_DS_MAPPING` below covers that case.
 */
const StrictThemeMirror = z.strictObject({
	name: z.string().min(1),
	displayName: z.string().min(1),
	tokens: z.strictObject(
		Object.fromEntries(
			Object.entries(vendoredTokens).map(([category, keys]) => {
				const shape = z.strictObject(
					Object.fromEntries(Object.keys(keys).map((key) => [key, z.string().min(1)])),
				);

				return [category, optionalCategories.has(category) ? shape.optional() : shape];
			}),
		),
	),
});

/**
 * unbranded-ds's own OKLCH pattern (`packages/tokens/src/color.ts`, `OKLCH_RE`), copied verbatim.
 * Its `parseColor` returns null for a string this pattern doesn't match, and its contrast loop skips
 * a null pair without a word. A bare `^oklch\(` check would let a colour one space out of spec pass
 * `validateTheme` with its contrast never measured.
 */
const TARGET_OKLCH =
	/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+(?:deg)?)\s*(?:\/\s*[\d.]+%?\s*)?\)$/i;

/**
 * Required keys Cambium has no source for, from the #12 decision
 * (https://github.com/kendrick/cambium/issues/12#issuecomment-5858594179). That list also names
 * `color.destructive-foreground`, which the adapter now maps from Cambium instead: no fixed default
 * clears contrast in both schemes. The `UNBRANDED_DS_MAPPING` row for it records why.
 */
const DECIDED_DEFAULTS = [
	'typography.font-sans',
	'typography.font-mono',
	'typography.font-serif',
	'spacing.px',
	...Array.from({ length: 16 }, (_, i) => `spacing.${i + 1}`),
	'color.destructive-subtle',
	'color.destructive-subtle-foreground',
	'radius.full',
	'tracking.widest',
	'opacity.hover',
	'z-index.max',
];

function leaves(document: Record<string, Record<string, string>>): [string, string][] {
	return Object.entries(document).flatMap(([category, keys]) =>
		Object.entries(keys).map(([key, value]): [string, string] => [`${category}.${key}`, value]),
	);
}

/** A sorted copy. `toSorted` would say it better, but it's ES2023 and tsconfig targets ES2022. */
function sorted(values: Iterable<string>): string[] {
	// oxlint-disable-next-line unicorn/no-array-sort
	return [...values].sort();
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('toUnbrandedDsTheme', () => {
	const light = toUnbrandedDsTheme(tokenSet, { ...identity, scheme: 'light' });
	const dark = toUnbrandedDsTheme(tokenSet, { ...identity, scheme: 'dark' });

	it.each([
		['light', light],
		['dark', dark],
	])(
		'emits a %s document carrying every key the target declares, and nothing else',
		(_, result) => {
			expect(() => StrictThemeMirror.parse(result.theme)).not.toThrow();
			// Optional categories too: both have a Cambium source, and #12 asks for every declared token.
			expect(sorted(Object.keys(result.theme.tokens))).toEqual(sorted(Object.keys(vendoredTokens)));
		},
	);

	it('carries the name and display name it was given', () => {
		expect(light.theme.name).toBe('acme');
		expect(light.theme.displayName).toBe('Acme');
	});

	it.each([
		['light', light],
		['dark', dark],
	])('writes %s values as literals, with no alias or var() left to resolve', (_, result) => {
		const unresolved = leaves(result.theme.tokens).filter(
			([, value]) => value.includes('{') || value.includes('var('),
		);

		expect(unresolved).toEqual([]);
	});

	it.each([
		['light', light],
		['dark', dark],
	])('writes every %s colour in the OKLCH form the target parses', (_, result) => {
		const unparseable = Object.entries(result.theme.tokens.color!).filter(
			([, value]) => !TARGET_OKLCH.test(value),
		);

		expect(unparseable).toEqual([]);
	});

	it('reports exactly the decided defaults, and fills each with the vendored value', () => {
		expect(sorted(light.report.defaulted)).toEqual(sorted(DECIDED_DEFAULTS));
		expect(sorted(dark.report.defaulted)).toEqual(sorted(DECIDED_DEFAULTS));

		const notVendored = DECIDED_DEFAULTS.filter((path) => {
			const [category, key] = splitPath(path);

			return light.theme.tokens[category]![key] !== vendoredTokens[category]![key];
		});

		expect(notVendored).toEqual([]);
	});

	it('vendors a dark default for every colour key the target declares', () => {
		// The adapter falls back to the light default when a dark entry is missing, so a refresh that
		// adds a colour key without its dark value would ship a light colour on a dark page silently.
		expect(sorted(Object.keys(vendored.darkColorDefaults.color))).toEqual(
			sorted(Object.keys(vendoredTokens.color!)),
		);
	});

	it('takes dark colour defaults from the target dark scheme, not the light defaults', () => {
		const defaults = vendored.darkColorDefaults.color;

		expect(dark.theme.tokens.color!['destructive-subtle']).toBe(defaults['destructive-subtle']);
		expect(dark.theme.tokens.color!['destructive-subtle-foreground']).toBe(
			defaults['destructive-subtle-foreground'],
		);
		// The two layers differ on these keys, so the assertion can't pass on the light values.
		expect(defaults['destructive-subtle']).not.toBe(vendoredTokens.color!['destructive-subtle']);
	});

	it.each([
		['light', light],
		['dark', dark],
	])(
		'maps %s destructive-foreground to a Cambium colour that clears AA on destructive',
		(_, result) => {
			const { color } = result.theme.tokens;
			const picked = color!['destructive-foreground']!;
			const other = picked === color!.foreground ? color!.background! : color!.foreground!;

			expect([color!.foreground, color!.background]).toContain(picked);
			expect(targetContrast(picked, color!.destructive!)).toBeGreaterThanOrEqual(
				targetContrast(other, color!.destructive!),
			);
			expect(targetContrast(picked, color!.destructive!)).toBeGreaterThanOrEqual(4.5);
		},
	);

	it('reports Cambium tokens the target has no key for', () => {
		expect(light.report.unmapped).toEqual(
			expect.arrayContaining([
				'color.card',
				'color.secondary',
				'color.accent',
				'color.input',
				'typography.size.xs',
				'radius.4xl',
				'shadow.xs',
			]),
		);
	});

	it('does not report a token it mapped as unmapped', () => {
		const mapped = [
			'color.background',
			'typography.weight.regular',
			'typography.lineHeight.normal',
			'motion.duration.normal',
			'motion.easing.enter',
			'focusRing.width',
			'zIndex.overlay',
		];

		expect(mapped.filter((path) => light.report.unmapped.includes(path))).toEqual([]);
	});

	it('takes each mapped value from the token set rather than the vendored default', () => {
		const { typography, motion, radius, focusRing, zIndex, opacity, tracking } = tokenSet;
		const tokens = light.theme.tokens;

		// Expected strings written out from the token set's own numbers and units, so a mapping row
		// pointing at the wrong source, or falling through to the default, lands on a different string.
		expect(tokens.radius!.sm).toBe(`${radius.values.sm!.value}rem`);
		expect(tokens.typography!['weight-normal']).toBe(
			String(typography.values.weight.regular!.value),
		);
		expect(tokens.typography!['leading-tight']).toBe(
			String(typography.values.lineHeight.tight!.value),
		);
		expect(tokens.typography!['size-base']).toBe(`${typography.values.size.base!.value}rem`);
		expect(tokens.motion!['duration-base']).toBe(`${motion.values.duration.normal!.value}ms`);
		expect(tokens.motion!['easing-decelerate']).toBe(
			`cubic-bezier(${motion.values.easing.enter!.value.join(', ')})`,
		);
		expect(tokens.motion!['easing-accelerate']).toBe(
			`cubic-bezier(${motion.values.easing.exit!.value.join(', ')})`,
		);
		expect(tokens.ring!.width).toBe(`${focusRing.values.width.value}px`);
		expect(tokens['z-index']!.overlay).toBe(String(zIndex.values.overlay!.value));
		expect(tokens.opacity!.disabled).toBe(String(opacity.values.disabled!.value));
		expect(tokens.tracking!.tighter).toBe(`${tracking.values.tighter!.value}em`);
	});

	it('writes each shadow as one box-shadow value the target can drop into a declaration', () => {
		// Four lengths, then an OKLCH colour with its alpha.
		const boxShadow = /^(-?[\d.]+(px|rem|em)?\s){4}oklch\([^)]*\/\s*[\d.]+%\)$/;
		const malformed = Object.entries(light.theme.tokens.shadow!).filter(
			([, value]) => !boxShadow.test(value),
		);

		expect(malformed).toEqual([]);
	});

	it('gives the two schemes different backgrounds', () => {
		expect(light.theme.tokens.color!.background).not.toBe(dark.theme.tokens.color!.background);
	});

	it.each([
		['light', light],
		['dark', dark],
	])('clears every contrast pair the target validates in the %s document', (_, result) => {
		const failing = vendored.contrastPairs.pairs
			.map((pair) => {
				const [fgCategory, fgKey] = splitPath(pair.foreground);
				const [bgCategory, bgKey] = splitPath(pair.background);
				const ratio = targetContrast(
					result.theme.tokens[fgCategory]![fgKey]!,
					result.theme.tokens[bgCategory]![bgKey]!,
				);

				return { ...pair, ratio };
			})
			.filter((pair) => pair.ratio < pair.threshold);

		expect(failing).toEqual([]);
	});

	it('maps only onto keys the target declares', () => {
		const undeclared = UNBRANDED_DS_MAPPING.map((row) => row.target).filter((target) => {
			const [category, key] = splitPath(target);

			return !Object.hasOwn(vendoredTokens[category] ?? {}, key);
		});

		expect(undeclared).toEqual([]);
	});

	it('gives the same report per scheme as unbrandedDsReport', () => {
		expect(unbrandedDsReport(tokenSet)).toEqual({ light: light.report, dark: dark.report });
	});

	it('picks the destructive-foreground the target measures higher, where byte rounding disagrees', () => {
		// Found by search: the target's unrounded arithmetic puts foreground ahead, 4.500043 to
		// 4.499923, while 8-bit rounding puts background ahead, 4.5098 to 4.4728. The unrounded margin
		// is 1.2e-4, and culori's matrices and the target's differ by under 1e-8 on these colours, so
		// the two agree on the winner. Dark-scheme polarity: light foreground, dark background.
		const foreground = { l: 0.988907, c: 0, h: 0 };
		const background = { l: 0.061, c: 0, h: 0 };
		const destructive = { l: 0.564, c: 0.032, h: 25 };
		const patched = withDarkColours(tokenSet, { foreground, background, destructive });
		const { theme, report } = toUnbrandedDsTheme(patched, { ...identity, scheme: 'dark' });
		const { color } = theme.tokens;

		// The fixture's premise, so a later change to it can't pass by no longer straddling.
		expect(renderedContrast(background, destructive)).toBeGreaterThan(
			renderedContrast(foreground, destructive),
		);
		expect(targetContrast(color!.foreground!, color!.destructive!)).toBeGreaterThan(
			targetContrast(color!.background!, color!.destructive!),
		);

		// 4.500043 sits inside the adapter's clearance margin, so the pick is then nudged. Its
		// adjustment records which colour the pick started from.
		const nudge = report.adjusted.find(
			(entry) => entry.pair === 'color.destructive-foreground / color.destructive',
		);

		expect(nudge?.from ?? color!['destructive-foreground']).toBe(color!.foreground);
		expect(
			targetContrast(color!['destructive-foreground']!, color!.destructive!),
		).toBeGreaterThanOrEqual(4.5);
	});

	it('makes no network call', () => {
		vi.stubGlobal('fetch', () => {
			throw new Error('an unbranded-ds adapter reached the network');
		});

		expect(() => toUnbrandedDsTheme(tokenSet, { ...identity, scheme: 'dark' })).not.toThrow();
		expect(() => toUnbrandedDsSource(tokenSet, 'acme')).not.toThrow();
		expect(() => unbrandedDsReport(tokenSet)).not.toThrow();
	});

	it('refuses an empty name, which the target rejects on registration', () => {
		expect(() =>
			toUnbrandedDsTheme(tokenSet, { name: '', displayName: 'Acme', scheme: 'light' }),
		).toThrow('non-empty name and displayName');
		expect(() =>
			toUnbrandedDsTheme(tokenSet, { name: 'acme', displayName: '', scheme: 'light' }),
		).toThrow('non-empty name and displayName');
	});

	// `registerTheme` interpolates the name into `[data-theme="…"]`, so each of these would either
	// break out of that selector or name a theme the target never uses.
	it.each(['a"]{}body{color:red}/*', 'a]b', 'Acme', 'a b', 'a--b', '-a', '.'])(
		'refuses the name %j, which would land unescaped in the target selector',
		(bad) => {
			expect(() =>
				toUnbrandedDsTheme(tokenSet, { name: bad, displayName: 'Acme', scheme: 'light' }),
			).toThrow("isn't a usable unbranded-ds theme name");
		},
	);
});

/**
 * `$type` by source path, vendored from the target's `packages/tokens/src/tokens/*.json`. Its keys
 * are the target's own source paths, so motion appears nested (`motion.duration.fast`) because Style
 * Dictionary merges a theme file onto those files by path.
 */
const targetSourceTypes: Record<string, string> = vendored.sourceTypes.types;

type SourceLeaf = { path: string; token: { $value: unknown; $type: unknown } };

function sourceLeaves(node: unknown, path: string[] = []): SourceLeaf[] {
	if (typeof node !== 'object' || node === null) return [];
	if ('$value' in node) return [{ path: path.join('.'), token: node as SourceLeaf['token'] }];

	return Object.entries(node).flatMap(([name, child]) => sourceLeaves(child, [...path, name]));
}

describe('toUnbrandedDsSource', () => {
	const files = toUnbrandedDsSource(tokenSet, 'acme');
	const lightPath = 'themes/theme/acme/light.json';
	const darkPath = 'themes/theme/acme/dark.json';

	it('writes exactly two files, one per scheme, under the identity', () => {
		expect(sorted(Object.keys(files))).toEqual([darkPath, lightPath]);
	});

	it.each([lightPath, darkPath])('gives %s every source path the target declares', (path) => {
		expect(sorted(sourceLeaves(files[path]).map((leaf) => leaf.path))).toEqual(
			sorted(Object.keys(targetSourceTypes)),
		);
	});

	it.each([lightPath, darkPath])(
		'writes %s as literal values typed the way the target types them',
		(path) => {
			const wrong = sourceLeaves(files[path]).filter(({ path: leaf, token }) => {
				const literal = typeof token.$value === 'string' && !token.$value.includes('{');
				const parses = token.$type !== 'color' || TARGET_OKLCH.test(String(token.$value));

				return !literal || !parses || token.$type !== targetSourceTypes[leaf];
			});

			expect(wrong).toEqual([]);
		},
	);

	it('writes the same values the runtime document carries for that scheme', () => {
		for (const scheme of ['light', 'dark'] as const) {
			const { theme } = toUnbrandedDsTheme(tokenSet, { ...identity, scheme });
			const file = files[`themes/theme/acme/${scheme}.json`] as Record<
				string,
				Record<string, { $value: string }>
			>;

			expect(file.color!.background!.$value).toBe(theme.tokens.color!.background);
			expect(
				(file.motion!.duration as unknown as Record<string, { $value: string }>).base!.$value,
			).toBe(theme.tokens.motion!['duration-base']);
		}
	});

	it('accepts a lowercase kebab identity', () => {
		expect(Object.keys(toUnbrandedDsSource(tokenSet, 'acme-brand-2'))).toContain(
			'themes/theme/acme-brand-2/light.json',
		);
	});

	// "." writes a loose themes/theme/light.json the target's build never reads, and a quote or
	// bracket breaks its `[data-theme="…"]` selector.
	it.each(['../escape', 'a/b', 'a..b', '..', '.', '', 'a\\b', 'a"]{}b', 'Acme', 'a--b', '-a'])(
		'refuses the identity %j',
		(bad) => {
			expect(() => toUnbrandedDsSource(tokenSet, bad)).toThrow(
				"isn't a usable unbranded-ds theme identity",
			);
		},
	);
});

/**
 * A deterministic grid of brand colours, run the way the app runs them: generate, build, repair,
 * export. Cambium's repair gates on 8-bit-rounded contrast and the target validates unrounded, so a
 * repaired pair can land at 4.49 in the target's units. A 648-seed grid like this one shipped 364
 * documents the target rejected before the adapter adjusted for it.
 */
describe('contrast across seeds', () => {
	const engine = createOklchScaleEngine();
	const failing: string[] = [];
	let exported = 0;

	for (let hue = 0; hue < 360; hue += 30) {
		for (const lightness of [0.35, 0.45, 0.55, 0.62, 0.7, 0.8]) {
			for (const chroma of [0.05, 0.12, 0.19]) {
				const raw = JSON.parse(readFileSync(seedPath, 'utf8'));
				raw.keyColors[0].oklch = [lightness, chroma, hue];
				raw.neutralTemperature.hue = hue;

				const variant = BrandSeedSchema.parse(raw);
				const result = engine.generate(variant, BALANCED);

				if (!result.ok) continue;

				const set = withContrastRepairs(buildTokenSet(result.schemes, variant)).tokenSet;

				for (const scheme of ['light', 'dark'] as const) {
					const { color } = toUnbrandedDsTheme(set, { ...identity, scheme }).theme.tokens;

					exported += 1;

					for (const pair of vendored.contrastPairs.pairs) {
						const ratio = targetContrast(
							color![splitPath(pair.foreground)[1]]!,
							color![splitPath(pair.background)[1]]!,
						);

						if (ratio < pair.threshold) {
							failing.push(`${lightness} ${chroma} ${hue} ${scheme} ${pair.foreground}: ${ratio}`);
						}
					}
				}
			}
		}
	}

	it('exports documents for most of the grid', () => {
		expect(exported).toBeGreaterThan(300);
	});

	it('clears every vendored pair in the target arithmetic, in both schemes', () => {
		expect(failing).toEqual([]);
	});
});

/**
 * A copy of `set` with three dark semantic colours moved, by rewriting the primitive step each one
 * aliases. Moving the step keeps the set schema-valid, where editing a resolved value can't.
 */
function withDarkColours(
	set: TokenSet,
	colours: Record<'foreground' | 'background' | 'destructive', Oklch>,
): TokenSet {
	const patched = structuredClone(set);
	const dark = patched.schemes.dark;

	for (const [token, colour] of Object.entries(colours)) {
		const [ramp, step] = dark.semantic[token]!.alias.split('.');
		const target = dark.primitives[ramp!]!.find((entry) => entry.step === Number(step))!;

		Object.assign(target, colour);
	}

	return patched;
}

function splitPath(path: string): [string, string] {
	const dot = path.indexOf('.');

	return [path.slice(0, dot), path.slice(dot + 1)];
}
