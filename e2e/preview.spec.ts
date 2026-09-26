import { randomUUID } from 'node:crypto';

import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import {
	type BrandRecord,
	BrandRecordSchema,
	FIRST_REVISION,
	SCHEMA_VERSION,
} from '../core/brand-record';
import type { BrandSeed } from '../core/brand-seed';
import { withContrastRepairs } from '../core/contrast/repair';
import { cssNaming } from '../core/css/globals-css';
import { scalarDeclarations, schemeDeclarations } from '../core/css/scheme-declarations';
import { BALANCED } from '../core/interpretation';
import { createOklchScaleEngine } from '../core/oklch-scale-engine';
import { defaultSeedPins } from '../core/seed-pins';
import { buildTokenSet } from '../core/semantic-layer';
import type { SchemeName } from '../core/token-overrides';

import { expect, test } from './fixtures';

/**
 * Spelled out rather than imported from `components/stored-record.tsx`, for the reason
 * `workspace.spec.ts` gives: a rename of the address should fail here, not move this spec with it.
 */
const RECORD_PARAM = 'record';

/** `workspace.spec.ts`'s `FIXTURE_SEED`, copied because importing a spec file registers its tests. */
const SEED: BrandSeed = {
	keyColors: [
		{
			oklch: [0.6231, 0.188, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

/**
 * Every expectation below comes from this Node-side set, built the way the workspace store builds
 * one, and never from the preview container's own inline style. Reading the declarations back off
 * the page would let a preview that declared the wrong values supply its own answer key.
 */
const DERIVED = createOklchScaleEngine().generate(SEED, BALANCED);

if (!DERIVED.ok) {
	throw new Error(`fixture seed failed to derive: ${DERIVED.error.kind}`);
}

// `repairedBase` in `app/state/workspace-store.ts` never paints the raw derived set: it repairs
// contrast first and applies that repair's own overrides, so a fixture that skipped this step would
// check the preview against colours nothing on screen ever shows.
const TOKEN_SET = withContrastRepairs(buildTokenSet(DERIVED.schemes, SEED, BALANCED)).tokenSet;
const NAMING = cssNaming();
const SCALARS = scalarDeclarations(TOKEN_SET, NAMING);
const SCHEMES = ['light', 'dark'] as const satisfies readonly SchemeName[];

/**
 * The vocabulary's step names, written out rather than read off the declaration maps, so a step the
 * maps drop fails `declared` below instead of quietly shrinking the allowed set.
 */
const RADIUS_STEPS = ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;
const TYPE_STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;
const SHADOW_STEPS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
const WEIGHT_STEPS = ['regular', 'medium', 'semibold', 'bold'] as const;
const TRACKING_STEPS = ['tighter', 'tight', 'normal', 'wide', 'wider'] as const;

function declared(map: Record<string, string>, property: string): string {
	const value = map[property];
	if (value === undefined) throw new Error(`nothing declares ${property}`);
	return value;
}

const SHADOW_PROPERTIES = new Set(
	SHADOW_STEPS.map((step) => NAMING.prefixedProperty(`shadow-${step}`)),
);

/** Node's expectations for one scheme, as the literal CSS text the stylesheet would declare. */
function expectedFor(scheme: SchemeName) {
	const map = schemeDeclarations(TOKEN_SET, scheme, NAMING);

	return {
		map,
		// Everything the scheme map declares that isn't a shadow is a colour: the semantic set, the
		// ramps and the brand alias. A utility reading any of them is reading a token.
		colours: Object.entries(map)
			.filter(([property]) => !SHADOW_PROPERTIES.has(property))
			.map(([, value]) => value),
		shadow: (step: (typeof SHADOW_STEPS)[number]) =>
			declared(map, NAMING.prefixedProperty(`shadow-${step}`)),
		radii: RADIUS_STEPS.map((step) => declared(SCALARS, NAMING.prefixedProperty(`radius-${step}`))),
		fontSizes: TYPE_STEPS.map((step) => declared(SCALARS, NAMING.prefixedProperty(`text-${step}`))),
		fontWeights: WEIGHT_STEPS.map((step) =>
			declared(SCALARS, NAMING.prefixedProperty(`font-weight-${step}`)),
		),
		tracking: TRACKING_STEPS.map((step) =>
			declared(SCALARS, NAMING.prefixedProperty(`tracking-${step}`)),
		),
	};
}

const EXPECTED = { light: expectedFor('light'), dark: expectedFor('dark') };

type ResolvableProperty =
	| 'backgroundColor'
	| 'borderTopLeftRadius'
	| 'fontSize'
	| 'fontWeight'
	| 'boxShadow';

/**
 * What the browser computes for each literal, read off a probe hung from `<body>`, outside the
 * preview. Both sides of every comparison then sit in the browser's units: `0.694444rem` becomes
 * `11.1111px`, and an `oklch()` comes back in whatever spelling Chromium serializes. The probe lives
 * outside `[data-preview]` so nothing the preview declares can leak into what it resolves.
 */
async function resolveInBrowser(
	page: Page,
	property: ResolvableProperty,
	values: readonly string[],
): Promise<string[]> {
	return page.evaluate(
		([name, literals]) => {
			const probe = document.createElement('div');
			document.body.appendChild(probe);

			try {
				return literals.map((literal) => {
					probe.style[name] = '';
					probe.style[name] = literal;
					// An empty inline value means the parser refused the literal; the computed value
					// would then be the initial one, which could match by accident.
					if (probe.style[name] === '') throw new Error(`the browser refused ${name}: ${literal}`);
					return getComputedStyle(probe)[name];
				});
			} finally {
				probe.remove();
			}
		},
		[property, values] as const,
	);
}

type Allowed = {
	colours: string[];
	opaqueColours: string[];
	radii: string[];
	fontSizes: string[];
	fontWeights: string[];
	/**
	 * Still the literal `em` text, unresolved. An `em` letter-spacing computes against the font size
	 * of the element it lands on, so one probe at one size can't resolve it for every element; the
	 * walk resolves it at each element's own size instead.
	 */
	tracking: string[];
};

async function allowedFor(page: Page, scheme: SchemeName): Promise<Allowed> {
	const expected = EXPECTED[scheme];

	return {
		colours: await resolveInBrowser(page, 'backgroundColor', expected.colours),
		opaqueColours: await resolveInBrowser(
			page,
			'backgroundColor',
			expected.colours.map((value) => `oklab(from ${value} l a b / 1)`),
		),
		radii: await resolveInBrowser(page, 'borderTopLeftRadius', expected.radii),
		fontSizes: await resolveInBrowser(page, 'fontSize', expected.fontSizes),
		fontWeights: await resolveInBrowser(page, 'fontWeight', expected.fontWeights),
		tracking: expected.tracking,
	};
}

/**
 * Every computed colour, radius, font size, font weight and letter spacing under `root` (itself included) that no token
 * accounts for, as one readable line apiece. Empty means the subtree renders from the tokens alone.
 *
 * Two rules sit beside plain membership, each narrow enough to still catch a literal:
 *
 * - Transparent passes, since it paints nothing and the preflight's `border: 0 solid` leaves every
 *   unbordered side that way.
 * - A translucent colour passes when its opaque form is a token's. That's what `bg-destructive/10`
 *   and `dark:bg-input/30` compile to: `color-mix()` against transparent keeps the token's channels
 *   and scales only alpha. `bg-red-500/10` still fails, because red-500 isn't a token.
 */
async function offTokenStyles(root: Locator, allowed: Allowed): Promise<string[]> {
	return root.evaluate((element, sets) => {
		const colours = new Set(sets.colours);
		const opaqueColours = new Set(sets.opaqueColours);
		const radii = new Set(['0px', ...sets.radii]);
		const fontSizes = new Set(sets.fontSizes);
		const fontWeights = new Set(sets.fontWeights);
		const trackingAt = new Map<string, Set<string>>();
		const probe = document.createElement('div');
		document.body.appendChild(probe);

		const opaque = (colour: string) => {
			probe.style.backgroundColor = `oklab(from ${colour} l a b / 1)`;
			return getComputedStyle(probe).backgroundColor;
		};
		// `normal` is what an element with no tracking utility computes to, so it passes as untouched.
		const tracking = (fontSize: string) => {
			let resolved = trackingAt.get(fontSize);
			if (!resolved) {
				probe.style.fontSize = fontSize;
				resolved = new Set(['normal']);
				for (const literal of sets.tracking) {
					probe.style.letterSpacing = '';
					probe.style.letterSpacing = literal;
					if (probe.style.letterSpacing === '') {
						throw new Error(`the browser refused letter-spacing: ${literal}`);
					}
					resolved.add(getComputedStyle(probe).letterSpacing);
				}
				probe.style.letterSpacing = '';
				trackingAt.set(fontSize, resolved);
			}
			return resolved;
		};
		const transparent = new Set(['transparent', 'rgba(0, 0, 0, 0)']);
		const translucent = / \/ 0?\.\d+\)$|, 0?\.\d+\)$/;

		const problems: string[] = [];

		try {
			for (const node of [element, ...element.querySelectorAll('*')]) {
				const style = getComputedStyle(node);
				const slot = node.getAttribute('data-slot') ?? node.getAttribute('data-preview-part');
				const label = `<${node.localName}${slot ? ` ${slot}` : ''}> "${node.textContent?.trim().slice(0, 30) ?? ''}"`;
				const colourProperties = {
					color: style.color,
					'background-color': style.backgroundColor,
					'border-top-color': style.borderTopColor,
					'border-right-color': style.borderRightColor,
					'border-bottom-color': style.borderBottomColor,
					'border-left-color': style.borderLeftColor,
				};

				for (const [property, value] of Object.entries(colourProperties)) {
					if (transparent.has(value) || colours.has(value)) continue;
					if (translucent.test(value) && opaqueColours.has(opaque(value))) continue;
					problems.push(`${label} ${property}: ${value}`);
				}

				const radiusProperties = {
					'border-top-left-radius': style.borderTopLeftRadius,
					'border-top-right-radius': style.borderTopRightRadius,
					'border-bottom-right-radius': style.borderBottomRightRadius,
					'border-bottom-left-radius': style.borderBottomLeftRadius,
				};

				for (const [property, value] of Object.entries(radiusProperties)) {
					if (!radii.has(value)) problems.push(`${label} ${property}: ${value}`);
				}

				if (!fontSizes.has(style.fontSize)) {
					problems.push(`${label} font-size: ${style.fontSize}`);
				}

				if (!fontWeights.has(style.fontWeight)) {
					problems.push(`${label} font-weight: ${style.fontWeight}`);
				}

				if (!tracking(style.fontSize).has(style.letterSpacing)) {
					problems.push(`${label} letter-spacing: ${style.letterSpacing}`);
				}
			}
		} finally {
			probe.remove();
		}

		return problems;
	}, allowed);
}

/**
 * Buttons and tabs carry `transition-colors` or `transition-all`, so for 150ms after a scheme flip
 * their computed colours sit between two schemes and match neither. Waiting the transitions out
 * reads the settled value; the mouse moves off the page first so no hover state is part of it.
 */
async function settle(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.getAnimations().filter((animation) => animation.playState === 'running').length,
			),
		)
		.toBe(0);
}

function buildRecord(): BrandRecord {
	return BrandRecordSchema.parse({
		id: randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl: null,
		images: [
			{
				id: 'img-1',
				downscaled: 'data:image/png;base64,AAAA',
				originalHash: 'sha256-fixture',
				tag: 'auto',
			},
		],
		versions: [
			{
				createdAt: new Date().toISOString(),
				ordinal: 1,
				seed: SEED,
				tokenSet: null,
				provider: 'cambium-e2e-fixture',
				model: 'cambium-e2e-fixture',
				promptVersion: 'cambium-e2e-fixture',
				rawResponse: 'raw model output held by the e2e fixture',
				scaleEngine: 'cambium-oklch-1',
				fontTable: { source: 'cambium-e2e-fixture', version: '1' },
				interpretation: 'balanced',
				overrides: [],
				pins: defaultSeedPins(SEED),
			},
		],
	});
}

/**
 * `workspace.spec.ts`'s `seedWorkspaceRecord`: one row written straight into the records store,
 * opened at the app's database version so the app's own open finds nothing to upgrade.
 */
async function seedWorkspaceRecord(page: Page, record: BrandRecord): Promise<void> {
	await page.evaluate(
		async ([databaseName, storeName, storedValue]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, 1);

				request.addEventListener('upgradeneeded', () => {
					request.result.createObjectStore(storeName, { keyPath: 'id' });
				});
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(storeName, 'readwrite');
					tx.objectStore(storeName).put(storedValue);
					tx.addEventListener('complete', () => resolve());
					tx.addEventListener('error', () => reject(tx.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, record] as const,
	);
}

/** Opens the seeded record's workspace and waits out the preview's lazy load. */
async function openPreview(page: Page): Promise<Locator> {
	const record = buildRecord();
	await seedWorkspaceRecord(page, record);
	await page.goto(`/workspace?${RECORD_PARAM}=${record.id}`);

	const preview = page.locator('[data-preview]');
	await expect(preview).toBeVisible();
	return preview;
}

async function switchScheme(page: Page, preview: Locator, scheme: SchemeName): Promise<void> {
	const toggle = page.getByRole('button', { name: 'Dark scheme' });
	if ((await preview.getAttribute('data-preview-scheme')) !== scheme) await toggle.click();

	await expect(preview).toHaveAttribute('data-preview-scheme', scheme);
	await expect(toggle).toHaveAttribute('aria-pressed', String(scheme === 'dark'));
}

/** A colour literal written straight from its channels, independent of how the app prints one. */
function oklchFromFields({ l, c, h }: { l: number; c: number; h: number }): string {
	return `oklch(${l} ${c} ${h})`;
}

test('every colour, radius, font size, font weight and letter spacing in the preview resolves to a declared token, in both schemes', async ({
	page,
}) => {
	const preview = await openPreview(page);

	for (const scheme of SCHEMES) {
		await switchScheme(page, preview, scheme);

		// The popup portals into the container rather than `<body>`, so it's inside the walk only
		// while open. Dark is where a popup reading the app's own colours would show.
		if (scheme === 'dark') {
			await page.getByRole('button', { name: 'Order details' }).click();
			await expect(preview.locator('[data-slot="popover-content"]')).toBeVisible();
		}

		await settle(page);

		const allowed = await allowedFor(page, scheme);
		expect(await offTokenStyles(preview, allowed), `${scheme} scheme`).toEqual([]);

		// Box shadows compose Tailwind's ring and shadow layers into one list, so the check is that
		// the scheme's own shadow token is one of the layers. Dark's shadow differs from light's for
		// this seed, so a card still wearing light's fails in dark.
		const [cardShadow] = await resolveInBrowser(page, 'boxShadow', [EXPECTED[scheme].shadow('xs')]);
		const card = preview.locator('[data-slot="card"]');
		expect(await card.evaluate((node) => getComputedStyle(node).boxShadow)).toContain(cardShadow);

		if (scheme === 'dark') {
			const [popupShadow] = await resolveInBrowser(page, 'boxShadow', [EXPECTED.dark.shadow('md')]);
			const popup = preview.locator('[data-slot="popover-content"]');
			expect(await popup.evaluate((node) => getComputedStyle(node).boxShadow)).toContain(
				popupShadow,
			);
		}
	}

	expect(EXPECTED.dark.shadow('xs')).not.toBe(EXPECTED.light.shadow('xs'));
});

test('the composed app screen has its nav, sidebar, header, table and primary action, each on the tokens alone', async ({
	page,
}) => {
	const preview = await openPreview(page);
	const screen = preview.locator('[data-preview-app-screen]');
	const parts = ['nav', 'sidebar', 'header', 'table', 'primary-action'] as const;

	for (const scheme of SCHEMES) {
		await switchScheme(page, preview, scheme);
		await settle(page);
		const allowed = await allowedFor(page, scheme);

		for (const part of parts) {
			const element = screen.locator(`[data-preview-part="${part}"]`);
			await expect(element, part).toBeVisible();
			expect(await offTokenStyles(element, allowed), `${scheme} ${part}`).toEqual([]);
		}
	}

	await expect(screen.locator('[data-preview-part="primary-action"]')).toHaveText('New order');
});

test('the scheme toggle flips the primary action from the light tokens to the dark ones', async ({
	page,
}) => {
	const preview = await openPreview(page);
	const action = preview.locator('[data-preview-part="primary-action"]');
	const primary = NAMING.semanticProperty('primary');
	const primaryForeground = NAMING.semanticProperty('primary-foreground');
	const background = NAMING.semanticProperty('background');

	const [lightPrimary, darkPrimary, lightForeground, darkForeground, lightPage, darkPage] =
		await resolveInBrowser(page, 'backgroundColor', [
			declared(EXPECTED.light.map, primary),
			declared(EXPECTED.dark.map, primary),
			declared(EXPECTED.light.map, primaryForeground),
			declared(EXPECTED.dark.map, primaryForeground),
			declared(EXPECTED.light.map, background),
			declared(EXPECTED.dark.map, background),
		]);

	// This seed pins `primary` to its key colour in both schemes, so the background alone can't tell a
	// flipped preview from a stuck one. The foreground and the page background do move, and the
	// scenario leans on them to be able to fail.
	expect(darkForeground).not.toBe(lightForeground);
	expect(darkPage).not.toBe(lightPage);

	const computed = () =>
		action.evaluate((node) => {
			const style = getComputedStyle(node);
			return { background: style.backgroundColor, color: style.color };
		});

	await switchScheme(page, preview, 'light');
	await settle(page);
	expect(await computed()).toEqual({ background: lightPrimary, color: lightForeground });
	expect(await preview.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(lightPage);

	await switchScheme(page, preview, 'dark');
	await settle(page);
	expect(await computed()).toEqual({ background: darkPrimary, color: darkForeground });
	expect(await preview.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(darkPage);
});

test('overriding primary in the token list repaints the preview without a reload', async ({
	page,
}) => {
	const preview = await openPreview(page);
	const action = preview.locator('[data-preview-part="primary-action"]');

	const brand = TOKEN_SET.schemes.light.primitives.brand!;
	const [before, after] = await resolveInBrowser(page, 'backgroundColor', [
		declared(EXPECTED.light.map, NAMING.semanticProperty('primary')),
		oklchFromFields(brand.find((step) => step.step === 1)!),
	]);
	expect(after).not.toBe(before);

	await settle(page);
	expect(await action.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(before);

	// A navigation replaces `window`, so the marker surviving is the proof no reload happened.
	await page.evaluate(() => {
		(window as Window & { cambiumNoReload?: true }).cambiumNoReload = true;
	});

	await page.getByLabel('primary alias', { exact: true }).selectOption('brand.1');

	await expect
		.poll(() => action.evaluate((node) => getComputedStyle(node).backgroundColor))
		.toBe(after);
	expect(
		await page.evaluate(() => (window as Window & { cambiumNoReload?: true }).cambiumNoReload),
	).toBe(true);
});

test('an axe scan of the preview in both schemes, reported rather than asserted', async ({
	page,
}) => {
	const preview = await openPreview(page);

	for (const scheme of SCHEMES) {
		await switchScheme(page, preview, scheme);
		await settle(page);

		const results = await new AxeBuilder({ page }).include('[data-preview]').analyze();

		// Reported, not asserted. #8's repair clears every pair `core/contrast/pairs.ts` declares, and
		// what axe still finds here sits outside that list: the pinned brand colour as text on the
		// page, `muted-foreground` on `sidebar-accent`, and destructive text over a tint of itself.
		// No token repair reaches those, so a violation here is a finding about how the preview pairs
		// tokens rather than a regression.
		for (const violation of results.violations) {
			test.info().annotations.push({
				type: `axe ${scheme}`,
				description: `${violation.id} (${violation.impact ?? 'no impact'}): ${violation.nodes.length} node(s). ${violation.help}`,
			});
		}

		await test.info().attach(`axe-${scheme}.json`, {
			body: JSON.stringify(results.violations, null, 2),
			contentType: 'application/json',
		});
	}
});
