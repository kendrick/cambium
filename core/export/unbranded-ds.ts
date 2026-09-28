import { boxShadow, length } from '../css/globals-css';
import { formatCssNumber, toOklchCss } from '../css/oklch-css';
import { contrastFromOklch, type Oklch, readOklch } from '../oklch';
import { resolveScheme } from '../resolve-scheme';
import {
	type CubicBezierValue,
	type DurationValue,
	type TokenSet,
	TokenSetSchema,
} from '../token-set';
import vendored from './unbranded-ds.vendor.json';

export type UnbrandedDsScheme = 'light' | 'dark';

/** `tokens.<category>.<key> = string`, the two-level shape unbranded-ds's runtime layer iterates. */
export type UnbrandedDsTokens = Record<string, Record<string, string>>;

/** What unbranded-ds's `registerTheme` takes: its `themeSchema`, one colour scheme's values. */
export type UnbrandedDsTheme = { name: string; displayName: string; tokens: UnbrandedDsTokens };

export type UnbrandedDsReport = {
	/** Target keys Cambium has no source for, filled with the vendored default. */
	defaulted: string[];
	/** Cambium tokens the target declares no key for, so they reach neither output. */
	unmapped: string[];
};

/**
 * One DTCG leaf the way the target's own source files write it: a string `$value` even for a
 * number or a weight, and no `$extensions`. That differs from Cambium's `DtcgToken`, whose values
 * are typed, so this document doesn't reuse `DtcgDocument`.
 */
export type UnbrandedDsSourceToken = { $value: string; $type: string };

export type UnbrandedDsSourceDocument = {
	[name: string]: UnbrandedDsSourceDocument | UnbrandedDsSourceToken;
};

const VENDORED_TOKENS: Readonly<UnbrandedDsTokens> = vendored.tokens;

/**
 * The target's dark colour-scheme layer. `canonicalDefaultTokens` holds light values only, and the
 * target paints dark by layering this file's colours over them, so a dark document that defaulted
 * from the light set would put a pale `destructive-subtle` surface on a dark page.
 */
const DARK_COLOR_DEFAULTS: Readonly<Record<string, string>> = vendored.darkColorDefaults.color;

/**
 * `$type` by source path, off the target's `packages/tokens/src/tokens/*.json`. A type the target
 * changes shows up as a diff in the vendored file when #49 refreshes it.
 */
const SOURCE_TYPES: Readonly<Record<string, string>> = vendored.sourceTypes.types;

const COLOR_KEYS = [
	'background',
	'foreground',
	'primary',
	'primary-foreground',
	'muted',
	'muted-foreground',
	'border',
	'ring',
	'popover',
	'popover-foreground',
	'destructive',
] as const;

export type UnbrandedDsMappingRow =
	| { target: string; source: string }
	| { target: string; contrastAgainst: string; candidates: readonly string[] };

/**
 * Target key → Cambium token path, or for one key a contrast pick between two colours. Both
 * adapters and {@link unbrandedDsReport} read this one table: `defaulted` is every vendored key with
 * no row, `unmapped` is every Cambium path no row reads. So the report can't disagree with what was
 * emitted, and adding a row is the only way to move a key off either list.
 *
 * Cambium paths follow `TokenSet`'s own field names, except that semantic colours sit under
 * `color.` since that's the name both vocabularies share.
 *
 * Exported for the test that checks every `target` is a key the target declares. The adapters only
 * emit vendored keys, so a row naming anything else would never fire and nothing else would notice.
 */
export const UNBRANDED_DS_MAPPING: readonly UnbrandedDsMappingRow[] = [
	...COLOR_KEYS.map((key) => ({ target: `color.${key}`, source: `color.${key}` })),
	// Cambium has no destructive-foreground, and no fixed default fits both schemes. The target's
	// own dark scheme keeps `destructive` dark (L 0.577), so its near-white default works there.
	// Cambium's repaired dark `destructive` can be light (L 0.785 in the seed fixture), and the same
	// near-white measures 1.98:1 against it. So each scheme takes whichever of its own foreground and
	// background reads better on its own `destructive`.
	{
		target: 'color.destructive-foreground',
		contrastAgainst: 'destructive',
		candidates: ['foreground', 'background'],
	},
	...['sm', 'md', 'lg', 'xl', '2xl', '3xl'].map((key) => ({
		target: `radius.${key}`,
		source: `radius.${key}`,
	})),
	...['sm', 'md', 'lg'].map((key) => ({ target: `shadow.${key}`, source: `shadow.${key}` })),
	...['tighter', 'tight', 'normal', 'wide', 'wider'].map((key) => ({
		target: `tracking.${key}`,
		source: `tracking.${key}`,
	})),
	...['sm', 'base', 'lg', 'xl', '2xl', '3xl'].map((key) => ({
		target: `typography.size-${key}`,
		source: `typography.size.${key}`,
	})),
	{ target: 'typography.weight-normal', source: 'typography.weight.regular' },
	...['medium', 'semibold', 'bold'].map((key) => ({
		target: `typography.weight-${key}`,
		source: `typography.weight.${key}`,
	})),
	...['normal', 'tight', 'relaxed'].map((key) => ({
		target: `typography.leading-${key}`,
		source: `typography.lineHeight.${key}`,
	})),
	{ target: 'opacity.disabled', source: 'opacity.disabled' },
	{ target: 'motion.duration-fast', source: 'motion.duration.fast' },
	{ target: 'motion.duration-base', source: 'motion.duration.normal' },
	{ target: 'motion.duration-slow', source: 'motion.duration.slow' },
	{ target: 'motion.easing-standard', source: 'motion.easing.standard' },
	{ target: 'motion.easing-decelerate', source: 'motion.easing.enter' },
	{ target: 'motion.easing-accelerate', source: 'motion.easing.exit' },
	{ target: 'ring.width', source: 'focusRing.width' },
	...['overlay', 'popover', 'tooltip'].map((key) => ({
		target: `z-index.${key}`,
		source: `zIndex.${key}`,
	})),
];

/**
 * What each scheme's documents default and leave out, as {@link toUnbrandedDsTheme} returns it for
 * one scheme and {@link toUnbrandedDsSource} would for both. The source adapter's return type is
 * the file map #15 consumes, so its report lives here instead.
 */
export function unbrandedDsReport(tokens: TokenSet): Record<UnbrandedDsScheme, UnbrandedDsReport> {
	const parsed = TokenSetSchema.parse(tokens);

	return { light: mapScheme(parsed, 'light').report, dark: mapScheme(parsed, 'dark').report };
}

/**
 * The runtime theme unbranded-ds's `registerTheme` takes, for one colour scheme. The target keeps
 * scheme on its own axis, so a document carries one scheme's values and a caller registers two.
 *
 * Every key the target requires is present, so the document doesn't depend on the target merging it
 * onto its defaults, and `report.defaulted` names each value Cambium didn't supply. The same report
 * is available for both schemes from {@link unbrandedDsReport}.
 *
 * Pass the contrast-repaired set, `withContrastRepairs(...).tokenSet`, which is what the app
 * exports. The target's `validateTheme` checks WCAG pairs, and the unrepaired seed fixture fails its
 * light scheme at 3.66:1 on primary-foreground/primary and 4.42:1 on muted-foreground/muted.
 *
 * Pure: parses its own copy of `tokens` the way `serializeDtcg` does, and reads nothing else.
 */
export function toUnbrandedDsTheme(
	tokens: TokenSet,
	options: { name: string; displayName: string; scheme: UnbrandedDsScheme },
): { theme: UnbrandedDsTheme; report: UnbrandedDsReport } {
	// The target's schema requires both non-empty; failing here names the cause, where
	// `registerTheme` would fail later with a zod path nobody at this end can act on.
	if (options.name === '' || options.displayName === '') {
		throw new Error('an unbranded-ds theme needs a non-empty name and displayName');
	}

	const { values, report } = mapScheme(TokenSetSchema.parse(tokens), options.scheme);
	const theme: UnbrandedDsTheme = {
		name: options.name,
		displayName: options.displayName,
		tokens: {},
	};

	for (const [category, keys] of Object.entries(VENDORED_TOKENS)) {
		theme.tokens[category] = Object.fromEntries(
			Object.keys(keys).map((key) => [key, values.get(`${category}.${key}`)!]),
		);
	}

	return { theme, report };
}

/**
 * The build-time theme source: one DTCG file per scheme at the path unbranded-ds's Style Dictionary
 * config walks, `themes/theme/<identity>/<scheme>.json`. Same values as {@link toUnbrandedDsTheme},
 * and the same contrast-repaired input. Which keys defaulted and which Cambium tokens have no key
 * comes from {@link unbrandedDsReport}.
 *
 * Motion nests here where the runtime document flattens it. The build merges a theme file onto
 * `src/tokens/**` by path, and the source spells motion `motion.duration.fast`, so the flat runtime
 * spelling would add a stray `--motion-duration-fast` and leave `--duration-fast` at the base value.
 *
 * `identity` becomes a directory name, so anything that could climb out of `themes/theme/` throws.
 */
export function toUnbrandedDsSource(
	tokens: TokenSet,
	identity: string,
): Record<string, UnbrandedDsSourceDocument> {
	if (identity === '' || /[/\\]/.test(identity) || identity.includes('..')) {
		throw new Error(`"${identity}" can't name a theme directory under themes/theme/`);
	}

	const parsed = TokenSetSchema.parse(tokens);
	const files: Record<string, UnbrandedDsSourceDocument> = {};

	for (const scheme of ['light', 'dark'] as const) {
		const { values } = mapScheme(parsed, scheme);
		const document: Record<string, UnbrandedDsSourceDocument> = {};

		for (const [category, keys] of Object.entries(VENDORED_TOKENS)) {
			const group: Record<string, UnbrandedDsSourceDocument | UnbrandedDsSourceToken> = {};

			for (const key of Object.keys(keys)) {
				const nested = category === 'motion' ? /^(duration|easing)-(.+)$/.exec(key) : null;
				const sourcePath = nested ? `${category}.${nested[1]}.${nested[2]}` : `${category}.${key}`;
				const $type = SOURCE_TYPES[sourcePath];

				if ($type === undefined) {
					throw new Error(`the vendored unbranded-ds source declares no $type for ${sourcePath}`);
				}

				const token = { $value: values.get(`${category}.${key}`)!, $type };

				if (nested) {
					const [, subgroup, name] = nested as unknown as [string, string, string];
					const inner = (group[subgroup] ??= {}) as Record<string, UnbrandedDsSourceToken>;
					inner[name] = token;
				} else {
					group[key] = token;
				}
			}

			document[category] = group;
		}

		files[`themes/theme/${identity}/${scheme}.json`] = document;
	}

	return files;
}

/**
 * Every target key's value for one scheme, and the two report lists, all off
 * {@link UNBRANDED_DS_MAPPING}. A row
 * whose Cambium source this set happens not to hold falls back to the default and is reported
 * defaulted, so a sparse hand-built set can't leave a hole the target fills silently.
 */
function mapScheme(
	tokenSet: TokenSet,
	scheme: UnbrandedDsScheme,
): { values: Map<string, string>; report: UnbrandedDsReport } {
	const cambium = cambiumLeaves(tokenSet, scheme);
	const resolved = resolveScheme(tokenSet.schemes[scheme]);
	const values = new Map<string, string>();
	const consumed = new Set<string>();
	const defaulted: string[] = [];

	for (const [category, keys] of Object.entries(VENDORED_TOKENS)) {
		for (const [key, lightDefault] of Object.entries(keys)) {
			const target = `${category}.${key}`;
			const row = UNBRANDED_DS_MAPPING.find((entry) => entry.target === target);
			const mapped = row ? readRow(row, cambium, resolved) : undefined;

			if (mapped) {
				values.set(target, mapped.value);
				for (const source of mapped.sources) consumed.add(source);
			} else {
				const darkDefault = category === 'color' ? DARK_COLOR_DEFAULTS[key] : undefined;
				values.set(target, scheme === 'dark' ? (darkDefault ?? lightDefault) : lightDefault);
				defaulted.push(target);
			}
		}
	}

	const unmapped = [...cambium.keys()].filter((path) => !consumed.has(path));

	return { values, report: { defaulted, unmapped } };
}

/** One row's value for this scheme and the Cambium paths it read, or undefined if a source is absent. */
function readRow(
	row: UnbrandedDsMappingRow,
	cambium: Map<string, string>,
	resolved: Record<string, Oklch>,
): { value: string; sources: string[] } | undefined {
	if ('source' in row) {
		const value = cambium.get(row.source);

		return value === undefined ? undefined : { value, sources: [row.source] };
	}

	const against = resolved[row.contrastAgainst];
	const candidates = row.candidates.filter((name) => resolved[name] !== undefined);

	if (!against || candidates.length !== row.candidates.length) return undefined;

	// Measured on the printed strings the target parses, with unrounded WCAG 2 as its
	// `contrastRatio` computes it: no 8-bit rounding and no gamut clamp. `renderedContrast` rounds
	// to bytes first, and near 4.5:1 that can pick the candidate the target then fails. The test
	// fixture for that case has a winning margin of 1.2e-4. culori's OKLab matrices differ from the
	// target's there by under 1e-8, so they only disagree on a near-exact tie. Ties go to the first
	// candidate.
	const ratio = (name: string) =>
		contrastFromOklch(readOklch(toOklchCss(resolved[name]!)), readOklch(toOklchCss(against)));
	const best = candidates.reduce((winner, name) => (ratio(name) > ratio(winner) ? name : winner));

	return { value: toOklchCss(resolved[best]!), sources: candidates.map((name) => `color.${name}`) };
}

/**
 * Every token Cambium generates for one scheme, keyed by path and already formatted as the CSS
 * literal the target stores. Enumerated from the set rather than from {@link UNBRANDED_DS_MAPPING}, so a token
 * no row reads still shows up, and lands in `unmapped`.
 */
function cambiumLeaves(tokenSet: TokenSet, scheme: UnbrandedDsScheme): Map<string, string> {
	const colorScheme = tokenSet.schemes[scheme];
	const { size, weight, lineHeight } = tokenSet.typography.values;
	const leaves = new Map<string, string>();
	const add = <T>(prefix: string, record: Record<string, T>, format: (value: T) => string) => {
		for (const [key, value] of Object.entries(record))
			leaves.set(`${prefix}.${key}`, format(value));
	};

	add('color', resolveScheme(colorScheme), (color) => toOklchCss(color));

	for (const [ramp, steps] of Object.entries(colorScheme.primitives)) {
		for (const step of steps) leaves.set(`primitives.${ramp}.${step.step}`, toOklchCss(step));
	}

	add('radius', tokenSet.radius.values, length);
	add('tracking', tokenSet.tracking.values, length);
	add('typography.size', size, length);
	add('typography.weight', weight, (token) => formatCssNumber(token.value));
	add('typography.lineHeight', lineHeight, (token) => formatCssNumber(token.value));
	// Per scheme, not the top-level copy: a shadow tinted for a white page vanishes on a dark one.
	add('shadow', colorScheme.shadow.values, boxShadow);
	add('spacing', tokenSet.spacing.values, length);
	add('opacity', tokenSet.opacity.values, (token) => formatCssNumber(token.value));
	add('motion.duration', tokenSet.motion.values.duration, duration);
	add('motion.easing', tokenSet.motion.values.easing, (token) => cubicBezier(token.value));
	add('focusRing', tokenSet.focusRing.values, length);
	add('zIndex', tokenSet.zIndex.values, (token) => formatCssNumber(token.value));

	return leaves;
}

function duration(token: DurationValue): string {
	return `${formatCssNumber(token.value)}${token.unit}`;
}

function cubicBezier(points: CubicBezierValue): string {
	return `cubic-bezier(${points.map((point) => formatCssNumber(point)).join(', ')})`;
}
