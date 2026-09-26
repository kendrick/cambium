import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema } from './brand-seed';
import { compositeOver, isInSrgb, type Oklch } from './oklch';
import { BALANCED } from './interpretation';
import { CAMBIUM_NAMESPACE, type SeedField } from './provenance';
import {
	MIN_RENDERED_DARKENING,
	MIN_VISIBLE_SURFACE_LIGHTNESS,
	shadowScale,
	type ShadowSurface,
} from './shadow-scale';

const STEPS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

/**
 * Two synthetic surfaces rather than real ramp steps. `shadow-scale.ts` never learns what a ramp or
 * an alias is, so its seam is a plain OKLCH triple, and a fixture built from the scale engine would
 * couple this file to a module the one under test cannot reach.
 *
 * Both sit at the same hue, so a colour difference between them cannot come from hue alone.
 */
/**
 * A surface carries what reached it as well as what colour it is, because a shadow with no stated
 * character inherits the surface's provenance rather than naming a field of its own. These two
 * stand in for a page whose neutral ramp traced to the brand key colour.
 */
const pageSurface = (color: Oklch, seedField: SeedField = 'keyColors'): ShadowSurface => ({
	color,
	provenance: { provenance: 'derived', seedField, rationale: 'stands in for a resolved page' },
});

const PAGE_LIGHT = pageSurface({ l: 0.99, c: 0.004, h: 259.8 });
const PAGE_DARK = pageSurface({ l: 0.18, c: 0.012, h: 259.8 });

const tinted = { spread: 'diffuse', tintFromSurface: true } as const;

describe('shadowScale', () => {
	it('emits five elevation steps carrying a colour and four dimensions', () => {
		const { source, values } = shadowScale(PAGE_LIGHT, tinted, BALANCED);

		expect(Object.keys(values)).toEqual([...STEPS]);
		expect(source).toBe('derived');

		for (const step of STEPS) {
			const shadow = values[step]!;

			expect(
				[shadow.offsetX, shadow.offsetY, shadow.blur, shadow.spread].every((d) => d.unit === 'px'),
			).toBe(true);
			expect(shadow.color.alpha).toBeGreaterThan(0);
			expect(shadow.color.alpha).toBeLessThanOrEqual(1);
		}
	});

	it('climbs in offset, blur and opacity as the elevation rises', () => {
		const { values } = shadowScale(PAGE_LIGHT, tinted, BALANCED);
		const rising = (read: (step: (typeof STEPS)[number]) => number) =>
			STEPS.map(read).every((n, i, all) => i === 0 || n > all[i - 1]!);

		expect(rising((step) => values[step]!.offsetY.value)).toBe(true);
		expect(rising((step) => values[step]!.blur.value)).toBe(true);
		expect(rising((step) => values[step]!.color.alpha)).toBe(true);
	});

	// The acceptance criterion: a shadow tinted by the surface reads as part of the system, where
	// black at an opacity reads as a default nobody chose.
	it('takes its hue from the surface it sits on', () => {
		const warm = shadowScale(pageSurface({ l: 0.98, c: 0.01, h: 40 }), tinted, BALANCED).values.md!
			.color;
		const cool = shadowScale(pageSurface({ l: 0.98, c: 0.01, h: 240 }), tinted, BALANCED).values.md!
			.color;

		expect(warm.h).toBeCloseTo(40, 6);
		expect(cool.h).toBeCloseTo(240, 6);
	});

	/**
	 * The regression that matters, and the one a chroma read off the surface would pass while
	 * shipping black. `background` aliases `neutral.1`, which is near-achromatic by design: the
	 * page backgrounds this derivation actually receives measure 0.00012 to 0.00106. A shadow that
	 * carried that number forward would satisfy "derives from the surface" and be invisible.
	 *
	 * 0.01 is the floor for a tint anyone can see at a shadow's lightness. Asserting a floor rather
	 * than the constant keeps this a statement about what reaches a stylesheet.
	 */
	it('tints a near-achromatic page with a chroma that can actually be seen', () => {
		const { color } = shadowScale(
			pageSurface({ l: 0.994, c: 0.000223, h: 259.8 }),
			tinted,
			BALANCED,
		).values.md!;

		expect(color.c).toBeGreaterThan(0.01);
		expect(color.h).toBeCloseTo(259.8, 6);
	});

	/**
	 * The tint is a ceiling, not a promise, and a dark page is where that shows. A shadow there sits
	 * near lightness 0.028, and sRGB holds between 0.0048 and 0.0194 of chroma that far down
	 * depending on hue, so the tint all but disappears. Lifting the lightness until 0.02 fits is the tempting fix and it is the wrong one:
	 * the shadow would stop being darker than the page, which the next test is about.
	 */
	it('gives up the tint rather than the darkness on a dark page', () => {
		const shortfall = [27, 86, 162.5, 200, 259.8, 265, 300].map((h) => {
			const dark = shadowScale(pageSurface({ ...PAGE_DARK.color, h }), tinted, BALANCED).values.md!
				.color;
			const light = shadowScale(pageSurface({ ...PAGE_LIGHT.color, h }), tinted, BALANCED).values
				.md!.color;

			return { h, dark: dark.c, light: light.c };
		});

		// Swept rather than measured at one hue. How much chroma survives near black runs from
		// 0.0048 at hue 200 to 0.0194 at hue 265, so a single hue and a fixed ratio would pass or
		// fail on which one the fixture happened to carry.
		expect(shortfall.filter(({ dark, light }) => dark <= 0 || dark >= light)).toEqual([]);
	});

	/**
	 * What makes a shadow a shadow, and the assertion both earlier versions of this module were
	 * missing. The first shipped a tint no display could show; the second fixed that by lifting the
	 * shadow's lightness until it was barely darker than the page it fell on. Neither failed a test,
	 * because every assertion was about the declared colour rather than about what lands on screen.
	 *
	 * So this composites each shadow over its own surface the way a browser does, per channel in
	 * sRGB, and converts back. Mixing the two OKLCH lightnesses instead is the obvious shortcut and
	 * it overstates the darkening by about 1.8x on a dark page. Four rounds of fixing this defect
	 * were tuned against that shortcut, so the numbers moved every round and the pixels did not.
	 *
	 * Every step, because the round before this cleared the bar at `md` while `xs` and `sm` sat
	 * under it, which are the two elevations nobody would think to check.
	 */
	it.each([
		['a light page', PAGE_LIGHT],
		['a dark page', PAGE_DARK],
	])('renders every step visibly darker than %s', (_name, page) => {
		const { values } = shadowScale(page, tinted, BALANCED);
		const rendered = STEPS.map((step) => {
			const { color } = values[step]!;

			return page.color.l - compositeOver(page.color, color, color.alpha).l;
		});

		expect(rendered.filter((delta) => delta <= MIN_RENDERED_DARKENING)).toEqual([]);
		expect(rendered.every((delta, i) => i === 0 || delta > rendered[i - 1]!)).toBe(true);
	});

	/**
	 * #10's falsifiable half. The depth of the tint is an interpretation parameter now, and the test
	 * that proves it reaches this module has to be one a wrong implementation fails: a module still
	 * reading its own constant paints the same pixel whatever the parameter says.
	 *
	 * Asserted on the composited pixel rather than the declared chroma, because a tint survives the
	 * gamut fit and the alpha blend or it never reaches anyone. The four rounds this module already
	 * lost were every one of them spent on declared numbers that moved while the pixels did not.
	 *
	 * On a light page, because sRGB holds almost no chroma near black. `PAGE_DARK` paints nearly the
	 * same near-black at every value of this parameter, so the assertion there could not fail.
	 */
	it('paints more chroma as `surfaceTinting` rises', () => {
		const painted = (surfaceTinting: number) => {
			const { color } = shadowScale(PAGE_LIGHT, tinted, {
				...BALANCED,
				surfaceTinting,
			}).values.md!;

			return compositeOver(PAGE_LIGHT.color, color, color.alpha).c;
		};

		expect(painted(0)).toBeLessThan(painted(BALANCED.surfaceTinting));
		expect(painted(BALANCED.surfaceTinting)).toBeLessThan(painted(0.06));
	});

	/**
	 * Hue is meaningless at zero chroma and `core/oklch.ts` canonicalises it to 0 there, so tinting
	 * from a genuinely achromatic page would paint every shadow red. An interpretation preset that
	 * leaves the neutral ramp untinted is what reaches this.
	 */
	it('leaves a shadow on an achromatic page untinted rather than painting it hue zero', () => {
		const { color } = shadowScale(pageSurface({ l: 0.99, c: 0, h: 0 }), tinted, BALANCED).values
			.md!;

		expect(color.c).toBe(0);
		expect(color.h).toBe(0);
	});

	/**
	 * A seed that reads `tintFromSurface: false` off the reference images gets an untinted shadow.
	 * Overriding an explicit reading would make the field decorative, and issue #7 records the
	 * departure from the criterion above.
	 */
	it('drops hue and chroma when the seed refuses the tint', () => {
		const { color } = shadowScale(
			PAGE_LIGHT,
			{ spread: 'diffuse', tintFromSurface: false },
			BALANCED,
		).values.md!;

		expect(color.c).toBe(0);
		expect(color.h).toBe(0);
	});

	/**
	 * What separates a dark page's shadow from a light one's is mostly opacity, and the ratio is
	 * where the weight belongs. The colours differ too, but only a little: `SHADOW_MIN_LIGHTNESS` is
	 * a gamut floor and a dark page already sits close to it, so most of the lightness the surface
	 * would otherwise carry through is absorbed. Asserting the small difference and calling it the
	 * headline would pass while the large one regressed.
	 */
	it('gives a dark page a different shadow from a light one', () => {
		const light = shadowScale(PAGE_LIGHT, tinted, BALANCED).values.md!;
		const dark = shadowScale(PAGE_DARK, tinted, BALANCED).values.md!;

		expect(dark.color).not.toEqual(light.color);
		expect(dark.color.alpha / light.color.alpha).toBeGreaterThan(3);
	});

	it.each(STEPS)('raises opacity and blur at %s on a dark surface', (step) => {
		const light = shadowScale(PAGE_LIGHT, tinted, BALANCED).values[step]!;
		const dark = shadowScale(PAGE_DARK, tinted, BALANCED).values[step]!;

		expect(dark.color.alpha).toBeGreaterThan(light.color.alpha);
		expect(dark.blur.value).toBeGreaterThan(light.blur.value);
	});

	// `spread` on the character is the seed's word for how far the shadow diffuses, which is the
	// blur. It is not the CSS spread radius the same-named dimension carries.
	it('blurs a diffuse shadow further than a tight one at the same elevation', () => {
		const tight = shadowScale(PAGE_LIGHT, { spread: 'tight', tintFromSurface: true }, BALANCED)
			.values.lg!;
		const diffuse = shadowScale(PAGE_LIGHT, tinted, BALANCED).values.lg!;

		expect(tight.blur.value).toBeLessThan(diffuse.blur.value);
		expect(tight.offsetY.value).toBeCloseTo(diffuse.offsetY.value, 10);
	});

	// The rail's Set writes `{ spread: 'normal', tintFromSurface: true }` into a null field, and Set
	// must not move a single shadow until the person does. The character goes through the seed
	// schema first, so this test also fails if the schema can't hold `normal`. Both surfaces run,
	// because blur gain and opacity climb on the dark one.
	it.each([
		['light', PAGE_LIGHT],
		['dark', PAGE_DARK],
	] as const)(
		'renders a normal-spread, surface-tinted shadow exactly as a null one on the %s surface',
		(_scheme, surface) => {
			const normal = BrandSeedSchema.shape.shadowCharacter.parse({
				spread: 'normal',
				tintFromSurface: true,
			});
			const rendered = (character: BrandSeed['shadowCharacter']) =>
				Object.fromEntries(
					Object.entries(shadowScale(surface, character, BALANCED).values).map(
						([step, { $extensions: _provenance, ...value }]) => [step, value],
					),
				);

			expect(rendered(normal)).toEqual(rendered(null));
			// The fixture can tell spreads apart: `tight` on the same surface renders differently.
			expect(rendered({ spread: 'tight', tintFromSurface: true })).not.toEqual(rendered(null));
		},
	);

	it('tints by default when the seed measured no shadow character', () => {
		expect(shadowScale(PAGE_LIGHT, null, BALANCED).values.md!.color.c).toBeGreaterThan(0);
	});

	/**
	 * A shadow is one DTCG composite token, so it carries exactly one `$extensions` payload, filed
	 * on the shadow itself rather than on each of its four geometry parts — five payloads on one
	 * token would make the count wrong wherever a consumer walks the set. `shadowCharacter` stated
	 * is the row where geometry and diffusion genuinely trace to the seed, so the whole token reads
	 * `derived`.
	 */
	it('carries one derived payload on the shadow, and none on its four dimensions', () => {
		const shadow = shadowScale(PAGE_LIGHT, tinted, BALANCED).values.md!;
		const payload = shadow.$extensions[CAMBIUM_NAMESPACE];

		expect(payload.provenance).toBe('derived');
		expect(payload.seedField).toBe('shadowCharacter');

		for (const dimension of [shadow.offsetX, shadow.offsetY, shadow.blur, shadow.spread]) {
			expect(dimension).not.toHaveProperty('$extensions');
		}
	});

	/**
	 * One token, one provenance, two ancestries. A null `shadowCharacter` still lets the tint come from
	 * the resolved page surface, which rests on the neutral ramp and so traces to whichever seed field
	 * shaped it; only geometry and diffusion fall back to the module constants above. A token names
	 * the field its value traces to rather than the field that was absent, so this is `derived`
	 * from the surface's own trace, `neutralTemperature` when the seed stated one and `keyColors`
	 * when it did not; the rationale carries the geometry caveat.
	 *
	 * `invented` here would assert that no seed field informed the token, and that is false. Neither
	 * value tells the whole story, and only one of them lies.
	 */
	it.each([
		['keyColors' as const, 'keyColors'],
		['neutralTemperature' as const, 'neutralTemperature'],
	])(
		'inherits the surface provenance when no character is stated, tracing to %s',
		(field, expected) => {
			const payload = shadowScale(pageSurface(PAGE_LIGHT.color, field), null, BALANCED).values.md!
				.$extensions[CAMBIUM_NAMESPACE];

			expect(payload.provenance).toBe('derived');
			expect(payload.seedField).toBe(expected);
			// The sentence has to move with the field, or a corrected payload ships a false rationale.
			expect(payload.rationale).toContain(expected);
			expect(payload.rationale.toLowerCase()).toMatch(/depth|blur|constant/);
		},
	);

	/**
	 * A surface nothing in the seed reached hands the shadow the same answer. Unreachable through
	 * `SEMANTIC_MAP` today, because `background` aliases a neutral ramp that always traces
	 * somewhere, and pinned anyway so the inheritance is a rule rather than a two-case lookup.
	 */
	it('inherits an invented surface rather than inventing a field for it', () => {
		const orphan: ShadowSurface = {
			color: PAGE_LIGHT.color,
			provenance: { provenance: 'invented', seedField: null, rationale: 'nothing reached this' },
		};
		const payload = shadowScale(orphan, null, BALANCED).values.md!.$extensions[CAMBIUM_NAMESPACE];

		expect(payload.provenance).toBe('invented');
		expect(payload.seedField).toBeNull();
	});

	/**
	 * The floor under the guarantee, pinned from this end. Whether the generated dark page clears it
	 * is `core/derive-non-color.test.ts`'s half.
	 *
	 * Before this was written down the opacity ramp happened to clear 0.02 down to page lightness
	 * 0.177 while the scale engine happened to emit 0.188, and nothing connected the two numbers. A
	 * change to either would have shipped an invisible shadow at the one lightness no fixture
	 * covered.
	 */
	it('clears the floor at every step on the darkest page it claims to support', () => {
		const darkest = pageSurface({ l: MIN_VISIBLE_SURFACE_LIGHTNESS, c: 0.001, h: 200 });
		const { values } = shadowScale(darkest, tinted, BALANCED);

		const faint = STEPS.filter(
			(step) =>
				darkest.color.l -
					compositeOver(darkest.color, values[step]!.color, values[step]!.color.alpha).l <=
				MIN_RENDERED_DARKENING,
		);

		expect(faint).toEqual([]);
	});

	/**
	 * A shadow is the surface with light taken out of it, so a page with none left cannot show one.
	 * Recorded rather than guarded: this is why the guarantee above needs a floor at all, and a
	 * reader who does not know it will read `MIN_VISIBLE_SURFACE_LIGHTNESS` as arbitrary.
	 */
	it('cannot darken a page that is already black, at any opacity', () => {
		const black = pageSurface({ l: 0, c: 0, h: 0 });
		const { values } = shadowScale(black, tinted, BALANCED);

		for (const step of STEPS) {
			const { color } = values[step]!;

			expect(compositeOver(black.color, color, color.alpha).l).toBeCloseTo(0, 10);
		}
	});

	/**
	 * A page at lightness zero takes the on-black ramp exactly, which is where that table is easiest
	 * to get wrong. Raising it until the smallest step clears on a dark page is the obvious move,
	 * and it turns the largest into an opaque slab. The schema's own 0-to-1 bound is far too loose
	 * to notice.
	 */
	it('keeps the darkest page from stacking opacity into a black box', () => {
		const { values } = shadowScale(pageSurface({ l: 0, c: 0, h: 0 }), tinted, BALANCED);

		expect(values.xl!.color.alpha).toBeLessThan(0.9);
		expect(STEPS.every((step) => values[step]!.color.alpha > 0)).toBe(true);
	});

	/**
	 * A tint outside sRGB is the invisible-tint bug again: the token file reads 0.02 and the browser
	 * paints whatever it can reach, which on a dark page was 0.0048. Yellow and green bind here, so
	 * a hue sweep is what makes this catch a change to either constant rather than to one hue.
	 */
	it.each([PAGE_LIGHT, PAGE_DARK])('emits a colour a display can actually show', (page) => {
		const offGamut = [27, 86, 162.5, 200, 259.8, 300, 340]
			.map((h) => shadowScale(pageSurface({ ...page.color, h }), tinted, BALANCED).values.md!.color)
			.filter((color) => !isInSrgb(color));

		expect(offGamut).toEqual([]);
	});

	it('produces the same scale from the same surface', () => {
		expect(shadowScale(PAGE_LIGHT, tinted, BALANCED)).toEqual(
			shadowScale({ ...PAGE_LIGHT }, tinted, BALANCED),
		);
	});

	/**
	 * Issue #7's out-of-scope line, which no behavioural assertion can reach: this module never
	 * touches the ramps or the semantic colour layer. The surface arrives already resolved, and
	 * `core/derive-non-color.ts` owns the single read-only lookup that resolves it. An import added
	 * here would compile, pass every test above, and quietly undo the split.
	 *
	 * Matches import statements at the start of a line rather than anywhere in the source, so the
	 * docblock stays free to name the modules it is explaining its distance from.
	 *
	 * An allowlist rather than a list of the three forbidden modules. Naming what is banned disarms
	 * itself the day one of those files is renamed, and it has to be kept in step with every module
	 * that ever learns about colour. Naming what is allowed fails on any new import at all, which
	 * is the moment worth stopping at.
	 *
	 * `./provenance` joined the list once #9 required a payload on the shadow token: it hands back
	 * a plain `$extensions` object built from `SeedField` and never touches a ramp or a scheme, so
	 * admitting it does not reopen the door this test exists to keep shut.
	 *
	 * `./interpretation` joined it for #10, and is the reason that module exists apart from the
	 * scale engine. The tint depth is an interpretation parameter, and the engine that first
	 * declared it also exports ramps and schemes, so importing it here is exactly the undoing this
	 * test watches for. `core/interpretation.ts` imports nothing at all, which is the property that
	 * earns it a place rather than any promise about what it means.
	 */
	it('imports only what cannot reach a colour', () => {
		const source = readFileSync(new URL('./shadow-scale.ts', import.meta.url), 'utf8');
		const specifiers = [
			...source.matchAll(/^\s*(?:import|export)\s[^'\n]*from\s*'([^']+)'/gm),
			...source.matchAll(/^\s*import\s*\(\s*'([^']+)'/gm),
			...source.matchAll(/^\s*import\s*'([^']+)'/gm),
		].map((m) => m[1]!);

		expect(specifiers).not.toHaveLength(0);
		expect(new Set(specifiers)).toEqual(
			new Set(['./brand-seed', './interpretation', './oklch', './provenance', './token-set']),
		);
	});
});
