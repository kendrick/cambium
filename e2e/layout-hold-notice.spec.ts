import type { Locator, Page } from '@playwright/test';

// `with { type: 'json' }`: Playwright runs this file as native Node ESM, whose loader wants it.
import error401Fixture from '../app/readers/fixtures/error-401-credentials.json' with { type: 'json' };
import malformedFixture from '../app/readers/fixtures/malformed-no-content-block.json' with { type: 'json' };
import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';

import { expect, test } from './fixtures';
import {
	generateButton,
	generateWithFreshKey,
	imageIdFromRequest,
	keyDialog,
	mockAnthropic,
	saveOneRecord,
	serveFontTable,
	successResponseBody,
	waitForGenerateReady,
} from './keyed-flow';

const TEST_KEY = 'sk-ant-test-not-a-real-key';

/**
 * Chromium's own log line for a fetch that came back 4xx or 5xx, or was aborted. The pattern is
 * copied from `generate.spec.ts`, since importing a spec registers its tests twice.
 */
const NETWORK_DIAGNOSTIC_LOG = /Failed to load resource|net::ERR_FAILED/;

function excuseNetworkDiagnostics(consoleErrors: string[]): void {
	for (let index = consoleErrors.length - 1; index >= 0; index -= 1) {
		if (NETWORK_DIAGNOSTIC_LOG.test(consoleErrors[index])) consoleErrors.splice(index, 1);
	}
}

function gate(): { held: Promise<void>; release: () => void } {
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { held, release };
}

async function twoFrames(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}),
	);
}

/**
 * #181's rotated phone: the first-version run starts in the phone Seed tab, and the viewport crosses
 * md while the reply is held. The two frames match #181's own scenarios, so React has handled the
 * media query change before the reply lands.
 */
async function startAtPhoneThenCross(
	page: Page,
	recordId: string,
	sent: readonly unknown[],
): Promise<void> {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/workspace?record=${recordId}`);
	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);
	await expect.poll(() => sent.length).toBe(1);

	await page.setViewportSize({ width: 1024, height: 844 });
	await twoFrames(page);
	await expect(page.getByRole('tablist', { name: 'Workspace' })).toHaveCount(1);
}

/**
 * Which layout is mounted, by its tab list. `includeHidden` because a modal key dialog takes the
 * rest of the page out of the accessibility tree, and a plain role query would then read a held
 * layout as gone. Only one layout mounts at a time, so counting hidden ones can't find a stale twin.
 */
function layoutTabList(page: Page, name: 'Workspace' | 'Output'): Locator {
	return page.getByRole('tablist', { name, includeHidden: true });
}

/**
 * The notice is on screen, and two frames later the layout it showed in is still the one mounted,
 * so a swap had its chance and didn't take the notice with it. The final read is a one-shot
 * `isVisible`, not a poll, so a notice that flashed and then left can't pass.
 */
async function expectShownAndHeld(page: Page, notice: Locator): Promise<void> {
	await expect(notice).toBeVisible();
	await twoFrames(page);
	await expect(layoutTabList(page, 'Workspace')).toHaveCount(1);
	await expect(layoutTabList(page, 'Output')).toHaveCount(0);
	expect(await notice.isVisible(), 'the notice, after the layout had its chance to swap').toBe(
		true,
	);
}

/** Deletes the stored row through raw IndexedDB, as another tab's Delete would. */
async function deleteStoredRecord(page: Page, recordId: string): Promise<void> {
	await page.evaluate(
		async ([databaseName, storeName, id]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});
			try {
				await new Promise<void>((resolve, reject) => {
					const transaction = db.transaction(storeName, 'readwrite');
					transaction.objectStore(storeName).delete(id);
					transaction.addEventListener('complete', () => resolve());
					transaction.addEventListener('error', () => reject(transaction.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, recordId] as const,
	);
}

test('a failure that offers Retry, landing after md was crossed mid-request, stays on screen until Retry succeeds', async ({
	page,
}) => {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);

	const { held, release } = gate();
	const sent = await mockAnthropic(page, async (body, attempt) => {
		if (attempt === 1) {
			await held;
			return { status: 200, body: malformedFixture.body };
		}
		return { status: 200, body: successResponseBody(imageIdFromRequest(body)) };
	});

	await startAtPhoneThenCross(page, recordId, sent);
	release();

	const notice = page.locator('[data-outcome="malformed"]');
	await expectShownAndHeld(page, notice);
	await expect(notice.getByRole('button', { name: 'Retry' })).toBeVisible();
	// Task 6 put focus on the notice, and the layout that holds it is the one still mounted.
	await expect(notice).toBeFocused();

	// Retry lands a version, and only then does the layout catch up with the viewport.
	await notice.getByRole('button', { name: 'Retry' }).click();
	await expect(page.locator('[data-seed-field="keyColors.0"] .font-mono')).toBeVisible();
	await expect(page.getByRole('tablist', { name: 'Output' })).toBeVisible();
	expect(sent).toHaveLength(2);
});

test('a rejected key after md was crossed mid-request keeps its notice and the key dialog it reopens', async ({
	page,
	consoleErrors,
}) => {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);

	const { held, release } = gate();
	const sent = await mockAnthropic(page, async () => {
		await held;
		return { status: 401, body: error401Fixture.body };
	});

	await startAtPhoneThenCross(page, recordId, sent);
	release();

	await expect(keyDialog(page)).toBeVisible();
	await expectShownAndHeld(page, page.locator('[data-outcome="credentials"]'));
	expect(await keyDialog(page).isVisible(), 'the reopened key dialog').toBe(true);

	// The 401 is a failed fetch to Chromium, which logs it. Only that line is excused.
	excuseNetworkDiagnostics(consoleErrors);
});

test('a record deleted in another tab mid-generate keeps its notice across an md crossing', async ({
	page,
}) => {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);

	const { held, release } = gate();
	const sent = await mockAnthropic(page, async (body) => {
		await held;
		return { status: 200, body: successResponseBody(imageIdFromRequest(body)) };
	});

	await startAtPhoneThenCross(page, recordId, sent);
	// The panel read the record before sending, so the commit is what finds it gone.
	await deleteStoredRecord(page, recordId);
	release();

	const notice = page.locator('[data-outcome="stale-record-write"]');
	await expectShownAndHeld(page, notice);
	await expect(notice).toContainText('deleted in another tab or window');
	// Recovery `none`: no control, and Generate stays off while the notice shows (Decision 27).
	await expect(notice.getByRole('button')).toHaveCount(0);
	await expect(generateButton(page)).toBeDisabled();
});

test('the first key dialog keeps a half-typed key across an md crossing', async ({ page }) => {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);

	// No key goes in, so Generate opens the dialog while no notice shows and nothing was sent.
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/workspace?record=${recordId}`);
	await waitForGenerateReady(page);
	await generateButton(page).click();

	const dialog = keyDialog(page);
	await expect(dialog).toBeVisible();
	const keyField = dialog.getByLabel(/api key/i);
	await keyField.fill('sk-ant-partial');

	await page.setViewportSize({ width: 1024, height: 844 });
	await twoFrames(page);
	await expect(layoutTabList(page, 'Workspace')).toHaveCount(1);
	expect(await dialog.isVisible(), 'the key dialog, after the layout had its chance to swap').toBe(
		true,
	);
	await expect(keyField).toHaveValue('sk-ant-partial');

	// Closing it lets the hold go, and the layout catches up with the viewport.
	await page.keyboard.press('Escape');
	await twoFrames(page);
	await expect(page.getByRole('tablist', { name: 'Output' })).toBeVisible();
});

test('a cancel that sent nothing lets the layout follow the viewport', async ({
	page,
	consoleErrors,
}) => {
	await serveFontTable(page);
	const recordId = await saveOneRecord(page);

	const { held, release } = gate();
	const sent = await mockAnthropic(page, async (body) => {
		await held;
		return { status: 200, body: successResponseBody(imageIdFromRequest(body)) };
	});

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/workspace?record=${recordId}`);
	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);
	await expect.poll(() => sent.length).toBe(1);

	await page.getByRole('button', { name: 'Cancel' }).click();
	const notice = page.locator('[data-outcome="cancelled"]');
	await expect(notice).toBeVisible();
	await expect(notice).toContainText('Generation cancelled');
	// No reply arrived, so there's no request id to keep and the notice may go with the swap.
	await expect(notice).not.toContainText('Anthropic request id');

	await page.setViewportSize({ width: 1024, height: 844 });
	await twoFrames(page);
	await expect(page.getByRole('tablist', { name: 'Output' })).toBeVisible();
	await expect(page.getByRole('tablist', { name: 'Workspace' })).toHaveCount(0);

	// The aborted fetch is a failed load to Chromium, which logs it. Only that line is excused.
	excuseNetworkDiagnostics(consoleErrors);
	release();
});
