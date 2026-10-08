import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
	generateButton,
	generateWithFreshKey,
	imageIdFromRequest,
	keyDialog,
	mockAnthropic,
	pngFile,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

type FocusWatch = { armed: boolean; bodySamples: number; seen: string[] };
type WatchedWindow = Window & { cambiumFocusWatch: FocusWatch };

/**
 * Samples `document.activeElement` on every animation frame and on a zero-delay timer while armed,
 * counting the samples that found it on `<body>` (or nowhere). A single read at the end would pass
 * a drop that something later repaired. Frames alone missed one too: with a `disabled` Save, focus
 * sat on `<body>` between two frames and the outcome caught it before the second. `seen` keeps the
 * sequence of distinct holders for the failure message.
 */
async function installFocusWatch(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const watch: FocusWatch = { armed: false, bodySamples: 0, seen: [] };
		(window as unknown as WatchedWindow).cambiumFocusWatch = watch;

		// Everything the script uses lives inside it: Playwright serializes this function into the page,
		// so a helper hoisted to module scope wouldn't exist there.
		const sample = () => {
			if (!watch.armed) return;
			const active = document.activeElement;
			if (active === null || active === document.body) watch.bodySamples += 1;
			const name = active
				? `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}`
				: 'null';
			if (watch.seen.at(-1) !== name) watch.seen.push(name);
		};
		const tick = () => {
			sample();
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		const poll = () => {
			sample();
			setTimeout(poll, 0);
		};
		poll();
	});
}

async function arm(page: Page): Promise<void> {
	await page.evaluate(() => {
		const watch = (window as unknown as WatchedWindow).cambiumFocusWatch;
		watch.armed = true;
		watch.bodySamples = 0;
		watch.seen = [];
	});
}

/** Two more frames after the target took focus, so a drop right after it would be counted. */
async function disarm(page: Page): Promise<{ bodySamples: number; seen: string[] }> {
	return page.evaluate(async () => {
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const watch = (window as unknown as WatchedWindow).cambiumFocusWatch;
		watch.armed = false;
		return { bodySamples: watch.bodySamples, seen: watch.seen };
	});
}

async function expectNeverOnBody(page: Page, step: string): Promise<void> {
	const { bodySamples, seen } = await disarm(page);
	expect(bodySamples, `${step}: focus went ${seen.join(' → ')}`).toBe(0);
}

/** Tab until `target` holds focus, so controls earlier waves put ahead of it don't fix a count. */
async function tabUntil(page: Page, target: Locator, limit = 60): Promise<void> {
	for (let press = 0; press < limit; press += 1) {
		await page.keyboard.press('Tab');
		if (await target.evaluate((node) => node === document.activeElement)) return;
	}
	throw new Error(`focus never reached the target in ${limit} Tab presses`);
}

test('with the keyed flow driven by keyboard only, focus never falls to the page', async ({
	page,
}) => {
	await installFocusWatch(page);
	await serveFontTable(page);

	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await mockAnthropic(page, async (body) => {
		// Held, so the run is still in flight when focus is read after the dialog closes.
		await held;
		return { status: 200, body: successResponseBody(imageIdFromRequest(body)) };
	});

	await page.goto('/');

	// A file picked by keyboard.
	const picker = page.getByLabel('Reference images');
	await tabUntil(page, picker);
	const chooser = page.waitForEvent('filechooser');
	await arm(page);
	await page.keyboard.press('Space');
	// Big enough for the decode to take a while. With a 2 × 2 file this step passed against the
	// `disabled` input it exists to catch.
	await (await chooser).setFiles(pngFile('brand.png', 2000, 2000));
	await expect(page.getByText('brand.png', { exact: true })).toBeVisible();
	await expect(picker).toBeFocused();
	await expectNeverOnBody(page, 'after the file was picked');

	// Save these references.
	await tabUntil(page, page.getByRole('button', { name: 'Save these references' }));
	await arm(page);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Saved' })).toBeFocused();
	await expectNeverOnBody(page, 'after Save these references');

	// The key dialog closing into a run.
	await waitForGenerateReady(page);
	await tabUntil(page, generateButton(page));
	await page.keyboard.press('Enter');
	await expect(keyDialog(page).getByLabel(/api key/i)).toBeFocused();
	await page.keyboard.type(TEST_KEY);
	await arm(page);
	await page.keyboard.press('Enter');
	await expect(keyDialog(page)).toHaveCount(0);
	await expect(page.locator('[data-generate-status]')).toBeFocused();
	await expectNeverOnBody(page, 'after the key dialog closed into a run');

	// The success, still watched. The route change unmounts the focused status line with the whole
	// landing page, and the workspace's "Opening that record…" line takes no focus, so `<body>` holds
	// it until `Shell` mounts. What this asserts is where it ends up: the seed heading, the same
	// destination a first version generated inside the workspace gets, and nowhere else after that.
	await arm(page);
	release();
	await expect(page).toHaveURL(/\/workspace\?record=/);
	const seedHeading = page.getByRole('heading', { level: 2, name: 'Seed', exact: true });
	await expect(seedHeading).toBeFocused();
	const { seen } = await disarm(page);
	expect(seen.at(-1), `after the workspace opened: focus went ${seen.join(' → ')}`).toBe(
		'h2#seed-heading',
	);
});

test('generating the first version from the workspace leaves focus on the seed heading', async ({
	page,
}) => {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);
	await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));

	await page.goto(`/workspace?record=${recordId}`);
	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	// #158's panel unmounts once the version opens. Without a new target focus would drop.
	await expect(page.locator('[data-seed-field]').first()).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Seed', exact: true })).toBeFocused();
});

test('a first version that lands after the viewport crossed md still leaves focus on the seed heading', async ({
	page,
}) => {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);

	// #181's rotated-phone case: the run starts in the phone Seed tab, and `Shell` holds that layout
	// until the panel stops reporting busy. The catch-up then remounts the rail. Two guards keep focus
	// on the heading: `FirstVersion` swaps inside its flush before it focuses (Decision 5), and
	// `Shell`'s focus restore catches a swap that lands later. This passes with either one alone.
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/workspace?record=${recordId}`);
	await waitForGenerateReady(page);

	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const sent = await mockAnthropic(page, async (body) => {
		await held;
		return { status: 200, body: successResponseBody(imageIdFromRequest(body)) };
	});

	await generateWithFreshKey(page, TEST_KEY);
	await expect.poll(() => sent.length).toBe(1);

	// Two frames after the resize, as #181's own scenario waits, so React has seen the media query
	// change before the reply lands.
	await page.setViewportSize({ width: 1024, height: 844 });
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}),
	);
	await expect(page.getByRole('tablist', { name: 'Workspace' })).toHaveCount(1);

	release();
	await expect(page.getByRole('tablist', { name: 'Output' })).toBeVisible();
	await expect(page.locator('[data-seed-field]').first()).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Seed', exact: true })).toBeFocused();
});
