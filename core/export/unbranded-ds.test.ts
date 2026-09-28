import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { wcagContrast } from 'culori/fn';
import { z } from 'zod';

import { BrandSeedSchema } from '../brand-seed';
import { BALANCED } from '../interpretation';
import { createOklchScaleEngine } from '../oklch-scale-engine';
import { buildTokenSet } from '../semantic-layer';
import { toUnbrandedDsSource, toUnbrandedDsTheme } from './unbranded-ds';
import vendored from './unbranded-ds.vendor.json';

/**
 * WCAG 2 contrast between two `oklch(L C H)` strings, through culori rather than Cambium's own
 * `renderedContrast`, so the check doesn't agree with the adapter just by sharing its code. It
 * parses the strings the target parses, no byte rounding, as the target's `contrastRatio` does.
 */
function wcagRatio(foreground: string, background: string): number {
	return wcagContrast(foreground, background);
}

const seedPath = fileURLToPath(new URL('../../scripts/fixtures/seed.json', import.meta.url));
const seed = BrandSeedSchema.parse(JSON.parse(readFileSync(seedPath, 'utf8')));
const generated = createOklchScaleEngine().generate(seed, BALANCED);

if (!generated.ok) throw new Error(`the seed fixture no longer generates: ${generated.error.kind}`);

const tokenSet = buildTokenSet(generated.schemes, seed);
const identity = { name: 'acme', displayName: 'Acme' };

const vendoredTokens = vendored.tokens as Record<string, Record<string, string>>;
const optionalCategories = new Set<string>(vendored.optionalCategories);

/**
 * A mirror of unbranded-ds's `themeSchema` (`packages/tokens/src/schema.ts`) built from the vendored
 * key list, but strict where the original is lenient. The target merges a partial theme onto its
 * defaults before validating, so a missing key there passes silently by inheriting; here it fails,
 * which is the only way to see whether Cambium actually supplied it. Strict also catches a mapping
 * row whose target key the target never declared, which the target would carry along unread.
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
 * The #12 decision posted 2026-09-27, less `color.destructive-foreground`, which the orchestrator's
 * later ruling maps from Cambium: required keys Cambium has no source for.
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
			const ratio = wcagRatio(color!['destructive-foreground']!, color!.destructive!);

			expect([color!.foreground, color!.background]).toContain(color!['destructive-foreground']);
			expect(ratio).toBeGreaterThanOrEqual(4.5);
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

	it('makes no network call', () => {
		vi.stubGlobal('fetch', () => {
			throw new Error('toUnbrandedDsTheme reached the network');
		});

		expect(() => toUnbrandedDsTheme(tokenSet, { ...identity, scheme: 'dark' })).not.toThrow();
	});

	it('refuses an empty name, which the target rejects on registration', () => {
		expect(() =>
			toUnbrandedDsTheme(tokenSet, { name: '', displayName: 'Acme', scheme: 'light' }),
		).toThrow('non-empty name and displayName');
		expect(() =>
			toUnbrandedDsTheme(tokenSet, { name: 'acme', displayName: '', scheme: 'light' }),
		).toThrow('non-empty name and displayName');
	});
});

/**
 * The target's build-time source nests motion (`motion.duration.fast`) where its runtime document
 * flattens it (`motion.duration-fast`), because Style Dictionary merges a theme file onto
 * `src/tokens/**` by path. A theme writing the flat spelling adds a stray `motion-duration-fast`
 * variable and leaves `--duration-fast` at the base value. These are the target's own source paths,
 * read off `packages/tokens/src/tokens/motion.json` at the vendored SHA.
 */
const TARGET_MOTION_SOURCE_PATHS = [
	'motion.duration.fast',
	'motion.duration.base',
	'motion.duration.slow',
	'motion.easing.standard',
	'motion.easing.decelerate',
	'motion.easing.accelerate',
];

/** `$type` by leaf, as the target's `packages/tokens/src/tokens/*.json` declares each at the SHA. */
function targetType(path: string): string {
	const [category, ...rest] = path.split('.');
	const key = rest.join('.');

	switch (category) {
		case 'color':
			return 'color';
		case 'shadow':
			return 'shadow';
		case 'opacity':
		case 'z-index':
			return 'number';
		case 'motion':
			return key.startsWith('duration') ? 'duration' : 'cubicBezier';
		case 'typography':
			if (key.startsWith('font-')) return 'fontFamily';
			if (key.startsWith('weight-')) return 'fontWeight';
			if (key.startsWith('leading-')) return 'number';
			return 'dimension';
		default:
			return 'dimension';
	}
}

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
		const expected = sorted([
			...leaves(vendoredTokens)
				.map(([leaf]) => leaf)
				.filter((leaf) => !leaf.startsWith('motion.')),
			...TARGET_MOTION_SOURCE_PATHS,
		]);

		expect(sorted(sourceLeaves(files[path]).map((leaf) => leaf.path))).toEqual(expected);
	});

	it.each([lightPath, darkPath])(
		'writes %s as literal values typed the way the target types them',
		(path) => {
			const wrong = sourceLeaves(files[path]).filter(({ path: leaf, token }) => {
				const literal = typeof token.$value === 'string' && !token.$value.includes('{');
				const parses = token.$type !== 'color' || TARGET_OKLCH.test(String(token.$value));

				return !literal || !parses || token.$type !== targetType(leaf);
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

	it.each(['../escape', 'a/b', 'a..b', '..', '', 'a\\b'])('refuses the identity %j', (bad) => {
		expect(() => toUnbrandedDsSource(tokenSet, bad)).toThrow("can't name a theme directory");
	});
});

function splitPath(path: string): [string, string] {
	const dot = path.indexOf('.');

	return [path.slice(0, dot), path.slice(dot + 1)];
}
