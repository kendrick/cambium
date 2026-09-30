import type { Page } from '@playwright/test';

import malformedFixture from '../app/readers/fixtures/malformed-no-content-block.json' with { type: 'json' };
import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';

import { expect, test } from './fixtures';
import {
	fixtureBrandKeyColor,
	generateButton,
	generateWithFreshKey,
	imageIdFromRequest,
	mockAnthropic,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

/** The rail's landmark name while it holds the First version section as well as the other two. */
const EMPTY_RAIL_NAME = 'Seed, first version and tokens';

/**
 * Set on `window` just before Generate is clicked. A reload or any full navigation starts a fresh
 * `window`, so finding it afterwards shows the seed arrived in the same document. URL equality
 * alone would pass a `location.reload()`.
 */
const NO_RELOAD_MARK = '__cambiumNoReloadMark';

type MarkedWindow = Window & Record<string, boolean | undefined>;

/** `oklch(l c h)` split into numbers, so the check compares values rather than formatter output. */
function parseOklchChannels(text: string): [number, number, number] {
	const channels = /^oklch\(([^ ]+) ([^ ]+) ([^ )]+)\)$/.exec(text);
	if (!channels) throw new Error(`unrecognised swatch text: ${text}`);
	return [Number(channels[1]), Number(channels[2]), Number(channels[3])];
}

/**
 * Reads the stored row through raw IndexedDB, so a defect in the app's own `RecordStore` can't
 * agree with itself here. `null` when no row is stored under the id.
 */
async function storedVersionCount(page: Page, recordId: string): Promise<number | null> {
	return page.evaluate(
		async ([databaseName, storeName, id]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				return await new Promise<number | null>((resolve, reject) => {
					const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
					request.addEventListener('success', () => {
						const row = request.result as { versions: unknown[] } | undefined;
						resolve(row ? row.versions.length : null);
					});
					request.addEventListener('error', () => reject(request.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, recordId] as const,
	);
}

/**
 * Rendered boxes, each clipped by every scroller above it, because a clipped overflow is what the
 * compositor actually hides. Text in the rail outside the First version section must neither cross
 * that section nor spill past the rail's bottom edge.
 */
async function expectSectionClearOfTheRail(page: Page): Promise<void> {
	const section = page.getByRole('region', { name: 'First version' });
	// By role alone: the landmark's name has its own assertion in the first scenario.
	const layout = await page.getByRole('complementary').evaluate(
		(aside, sectionElement) => {
			type Box = { top: number; bottom: number; left: number; right: number };
			const clipped = (element: Element): Box => {
				const rect = element.getBoundingClientRect();
				const box = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
				for (let node = element.parentElement; node && node !== aside; node = node.parentElement) {
					const style = getComputedStyle(node);
					if (style.overflowY === 'visible' && style.overflowX === 'visible') continue;
					const clip = node.getBoundingClientRect();
					box.top = Math.max(box.top, clip.top);
					box.bottom = Math.min(box.bottom, clip.bottom);
					box.left = Math.max(box.left, clip.left);
					box.right = Math.min(box.right, clip.right);
				}
				return box;
			};
			const sectionBox = clipped(sectionElement);
			const asideBottom = aside.getBoundingClientRect().bottom;
			const overlapping: string[] = [];
			const spilling: string[] = [];
			for (const element of Array.from(aside.querySelectorAll('*'))) {
				if (sectionElement.contains(element) || element.contains(sectionElement)) continue;
				const hasText = Array.from(element.childNodes).some(
					(node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
				);
				if (!hasText) continue;
				const box = clipped(element);
				if (box.bottom - box.top <= 0 || box.right - box.left <= 0) continue;
				const label = `${element.tagName} "${(element.textContent ?? '').trim().slice(0, 40)}"`;
				if (box.top < sectionBox.bottom && box.bottom > sectionBox.top) overlapping.push(label);
				if (box.bottom > asideBottom + 1) spilling.push(label);
			}
			return { overlapping, spilling };
		},
		await section.elementHandle(),
	);

	expect(layout.overlapping, 'text crossing the First version section').toEqual([]);
	expect(layout.spilling, 'text below the rail').toEqual([]);
}

test('a record with no versions generates its first version from the workspace, and the seed rail shows it without a reload', async ({
	page,
}) => {
	// Generation looks up the font table, and the fixture seed states a pairing. Served from the
	// committed CSV so nothing reaches jsDelivr.
	await serveFontTable(page);

	const recordId = await saveOneRecord(page);
	const workspaceUrl = new RegExp(`/workspace\\?record=${recordId}$`);

	await page.goto(`/workspace?record=${recordId}`);
	await expect(
		page.getByRole('complementary', { name: EMPTY_RAIL_NAME, exact: true }),
	).toBeVisible();
	await expect(page.locator('[data-seed-field]')).toHaveCount(0);

	const sent = await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));

	await waitForGenerateReady(page);
	await page.evaluate((mark) => {
		(window as unknown as MarkedWindow)[mark] = true;
	}, NO_RELOAD_MARK);

	await generateWithFreshKey(page, TEST_KEY);

	const brandSwatch = page.locator('[data-seed-field="keyColors.0"] .font-mono');
	await expect(brandSwatch).toBeVisible();

	const [l, c, h] = parseOklchChannels((await brandSwatch.textContent()) ?? '');
	const [expectedL, expectedC, expectedH] = fixtureBrandKeyColor().oklch;
	expect(l).toBeCloseTo(expectedL, 3);
	expect(c).toBeCloseTo(expectedC, 3);
	expect(h).toBeCloseTo(expectedH, 3);

	expect(sent).toHaveLength(1);
	await expect(page).toHaveURL(workspaceUrl);
	expect(
		await page.evaluate((mark) => (window as unknown as MarkedWindow)[mark], NO_RELOAD_MARK),
	).toBe(true);
	expect(await storedVersionCount(page, recordId)).toBe(1);

	// A second version from here is a #158 non-goal, so the control leaves with the empty state.
	await expect(generateButton(page)).toHaveCount(0);
	// The seed now exists, so the preset select Task 1 hid comes back.
	await expect(page.getByLabel('Interpretation')).toBeVisible();
	// And the landmark stops naming a section that has left it.
	await expect(
		page.getByRole('complementary', { name: 'Seed and tokens', exact: true }),
	).toBeVisible();
});

test('on a short md window the first-version section scrolls inside the rail rather than painting over the seed and tokens', async ({
	page,
}) => {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);

	// The shortest md viewport the suite already holds the rail to (seed-rail.spec.ts). Before this
	// test, the seed region collapsed to 12px here and its text sat on top of the new section.
	await page.setViewportSize({ width: 768, height: 400 });
	await page.goto(`/workspace?record=${recordId}`);
	await waitForGenerateReady(page);

	const section = page.getByRole('region', { name: 'First version' });
	await expect(section).toBeVisible();

	await expectSectionClearOfTheRail(page);

	// Still usable: scrolled into view, Generate is what a click at its centre lands on, and its
	// 2px outline at 2px offset (app/globals.css) fits inside the scroller rather than being cut off.
	const button = generateButton(page);
	await button.scrollIntoViewIfNeeded();
	const reach = await button.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		const scroller = element.closest('section')!;
		const bounds = scroller.getBoundingClientRect();
		const ring = 4;
		return {
			hit: hit !== null && element.contains(hit),
			ringInside:
				rect.left - ring >= bounds.left + scroller.clientLeft - 0.5 &&
				rect.top - ring >= bounds.top + scroller.clientTop - 0.5 &&
				rect.bottom + ring <= bounds.top + scroller.clientTop + scroller.clientHeight + 0.5,
		};
	});
	expect(reach).toEqual({ hit: true, ringInside: true });

	// The review also named failure details as making the overlap worse. A malformed response shows
	// the most of them: the outcome text, a retry, and the raw body in a `<details>`, opened here.
	await mockAnthropic(page, () => ({ status: 200, body: malformedFixture.body }));
	await generateWithFreshKey(page, TEST_KEY);
	const failure = section.locator('[data-outcome="malformed"]');
	await expect(failure).toBeVisible();
	await failure.locator('details summary').click();
	await expectSectionClearOfTheRail(page);
});
