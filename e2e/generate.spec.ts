import type { Page } from '@playwright/test';

import { ANTHROPIC_MESSAGES_URL } from '../app/readers/anthropic-reader';
// `with { type: 'json' }` isn't decoration here: Playwright runs this file as native Node ESM
// (`package.json`'s `"type": "module"`), and Node's own loader refuses a JSON import without the
// attribute, unlike Vitest's bundled runtime, which is why `anthropic-reader.test.ts` gets away
// without one.
import error401Fixture from '../app/readers/fixtures/error-401-credentials.json' with { type: 'json' };
import error529Fixture from '../app/readers/fixtures/error-529-overloaded.json' with { type: 'json' };
import malformedFixture from '../app/readers/fixtures/malformed-no-content-block.json' with { type: 'json' };
import refusalFixture from '../app/readers/fixtures/refusal-thinking-first.json' with { type: 'json' };
import structuredSuccessFixture from '../app/readers/fixtures/structured-success.json' with { type: 'json' };
import { SESSION_KEY_STORAGE_KEY } from '../app/generation/session-key';
import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';

import { expect, test } from './fixtures';
import { makePng } from './fixtures/png';

/**
 * #23 forbids asserting `describeFailure`'s wording here (`AGENTS.md`'s Task 6 constraint, and the
 * plan's own decision), because that message is already pinned in
 * `app/generation/describe-failure.test.ts`. What a browser alone can prove is the wiring: which
 * `data-outcome` renders, which single recovery control comes with it, and what does or does not
 * reach storage, a URL, or the console. Every assertion below stays at that seam.
 */

/** Distinctive enough that a stray match in a URL, storage dump, or console line can't be a coincidence. */
const TEST_KEY = 'sk-ant-e2e-9f2c6a10b4d84e7fa9c1d2e3f4a5b6c7d8e9f0a1';

const PNG_NAME = 'brand.png';

/**
 * Chromium preflights the actual POST because `x-api-key` and `anthropic-version` aren't simple
 * headers. `*` is enough here: the request carries no credentials mode, so the wildcard form of
 * every `Access-Control-*` response header is legal under the Fetch spec, and this harness has no
 * reason to enumerate the exact header set the reader happens to send today.
 */
const PREFLIGHT_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': '*',
	'access-control-allow-methods': '*',
};

type SentBody = { model?: string; messages: { role: string; content: unknown }[] };

/** A captured POST: the parsed body and the headers the page's own `fetch` actually sent. */
type SentRequest = { body: SentBody; headers: Record<string, string> };

type MockResponse = { status: number; body: unknown; headers?: Record<string, string> };

/**
 * Installs the one route every scenario needs: answer the CORS preflight, then hand each real
 * POST to `respond`. `respond` sees the parsed body and how many real requests have landed so far
 * (1-based), which is what the repair and no-auto-retry scenarios need to tell requests apart.
 *
 * The returned array is the live list of requests sent so far — it grows as the page makes
 * requests, so a scenario can `expect(sent.length)` after waiting on whatever the UI does next.
 */
async function mockAnthropic(
	page: Page,
	respond: (body: SentBody, attempt: number) => MockResponse | Promise<MockResponse>,
): Promise<SentRequest[]> {
	const sent: SentRequest[] = [];

	await page.route(ANTHROPIC_MESSAGES_URL, async (route) => {
		const request = route.request();

		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
			return;
		}

		const body = request.postDataJSON() as SentBody;
		sent.push({ body, headers: request.headers() });

		const result = await respond(body, sent.length);

		await route.fulfill({
			status: result.status,
			headers: { 'access-control-allow-origin': '*', ...result.headers },
			contentType: 'application/json',
			body: JSON.stringify(result.body),
		});
	});

	return sent;
}

/**
 * A route that answers the preflight and then drops the real request, the way an offline tab or a
 * DNS failure would. `route.abort` rejects the page's `fetch` before any response exists, which is
 * exactly what `anthropic-reader.ts` maps to the `network` kind — there is no status to fulfill.
 */
async function mockAnthropicNetworkFailure(page: Page): Promise<void> {
	await page.route(ANTHROPIC_MESSAGES_URL, async (route) => {
		const request = route.request();

		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
			return;
		}

		await route.abort('failed');
	});
}

/**
 * The one text block every request carries per image, ahead of the image block itself
 * (`buildContent` in `app/readers/anthropic-request.ts`). Reading the id back out of the request is
 * what lets the success mock cite an id the freshly saved record actually holds, rather than one
 * borrowed from the fixture's own recording, which a fresh record's schema would reject as
 * `record-schema`.
 */
function imageIdFromRequest(body: SentBody): string {
	const content = body.messages[0]?.content;
	const blocks = Array.isArray(content) ? (content as { type?: string; text?: string }[]) : [];
	const marked = blocks.find(
		(block) =>
			block.type === 'text' &&
			typeof block.text === 'string' &&
			block.text.startsWith('Image id: '),
	);

	if (!marked?.text) throw new Error('the request carried no "Image id: " text block');

	return marked.text.slice('Image id: '.length);
}

/**
 * The success fixture, aimed at whichever image the record actually holds. `BrandRecordSchema`'s
 * `superRefine` (`core/brand-record.ts`) checks two fields against the record's own image ids,
 * `keyColors[].sourceImageId` and `imageClassifications[].imageId`, so both move or the seed still
 * cites an id this fresh record never minted and `commit` rejects it as `record-schema`. The test
 * stages exactly one reference image, so there is only one real id for either field to cite.
 * `model` is pinned to `claude-opus-5-5` because the fixture was recorded against `claude-opus-5`
 * and #23 pins generation to the dated model name.
 */
function successResponseBody(imageId: string): unknown {
	const fixtureBody = structuredSuccessFixture.body as {
		content: { type: string; text?: string }[];
	} & Record<string, unknown>;
	const textBlock = fixtureBody.content.find((block) => block.type === 'text' && block.text);

	if (!textBlock?.text) throw new Error('the success fixture carries no text block to rewrite');

	const rewrittenSeed = textBlock.text
		.replace(/"sourceImageId":"[^"]*"/g, `"sourceImageId":"${imageId}"`)
		.replace(/"imageId":"[^"]*"/g, `"imageId":"${imageId}"`);

	return {
		...fixtureBody,
		model: 'claude-opus-5-5',
		content: [{ type: 'text', text: rewrittenSeed }],
	};
}

type StoredRecord = { id: string; images: { id: string }[]; versions: unknown[] };

/**
 * Reads every stored record through raw IndexedDB, the way `e2e/landing-regressions.spec.ts` does,
 * so a defect in `app/storage/indexed-db-record-store.ts` can't hide a wrong answer behind agreeing
 * with itself.
 */
async function readRecords(page: Page): Promise<StoredRecord[]> {
	return page.evaluate(
		async ([databaseName, storeName]) => {
			const known = (await indexedDB.databases()).some((info) => info.name === databaseName);
			if (!known) return [];

			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				if (!db.objectStoreNames.contains(storeName)) return [];

				return await new Promise<StoredRecord[]>((resolve, reject) => {
					const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
					request.addEventListener('success', () => resolve(request.result as StoredRecord[]));
					request.addEventListener('error', () => reject(request.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME] as const,
	);
}

async function readRecord(page: Page, recordId: string): Promise<StoredRecord | undefined> {
	return (await readRecords(page)).find((record) => record.id === recordId);
}

function pngFile(name: string) {
	return { name, mimeType: 'image/png', buffer: Buffer.from(makePng(2, 2)) };
}

/**
 * Stages one reference image and saves it, the same path `e2e/indexeddb.spec.ts` drives. Returns
 * the id the "Saved." outcome put in the URL, which is the one every scenario below needs to reach
 * `GeneratePanel` and to read the record back afterward.
 */
async function saveOneRecord(page: Page): Promise<string> {
	await page.goto('/');

	await page.getByLabel('Reference images').setInputFiles(pngFile(PNG_NAME));
	await expect(page.getByText(PNG_NAME, { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Save these references' }).click();
	await expect(page.getByText(/^Saved\./)).toBeVisible();

	const recordId = new URL(page.url()).searchParams.get('record');
	if (!recordId) throw new Error('saving did not put a record id in the URL');

	return recordId;
}

const generateButton = (page: Page) => page.getByRole('button', { name: 'Generate' });

/** `GeneratePanel` disables Generate until the async cost estimate resolves. */
async function waitForGenerateReady(page: Page): Promise<void> {
	await expect(generateButton(page)).toBeEnabled();
}

function keyDialog(page: Page) {
	return page.getByRole('dialog');
}

async function submitKeyDialog(page: Page, key: string): Promise<void> {
	const dialog = keyDialog(page);
	await expect(dialog).toBeVisible();
	// The field is uncontrolled (`key-dialog.tsx`'s own doc comment says why), so `fill` is the only
	// way in: there is no prop or state this harness could set instead.
	await dialog.getByLabel(/api key/i).fill(key);
	await dialog.locator('button[type="submit"]').click();
}

/** Opens the dialog from Generate and submits a key in one motion, for the common first-run case. */
async function generateWithFreshKey(page: Page, key: string): Promise<void> {
	await generateButton(page).click();
	await submitKeyDialog(page, key);
}

function outcome(page: Page, kind: string) {
	return page.locator(`[data-outcome="${kind}"]`);
}

/**
 * Chromium's own network diagnostic for a fetch that lands on a non-2xx status or gets aborted —
 * "Failed to load resource: the server responded with a status of…" or "net::ERR_FAILED" — never
 * anything the app's code calls, and it fires the same way for a real Anthropic outage as it does
 * here.
 */
const NETWORK_DIAGNOSTIC_LOG = /Failed to load resource|net::ERR_FAILED/;

/**
 * Removes only Chromium's own network diagnostic from the auto `consoleErrors` fixture, leaving
 * anything else in the list untouched. The 401, 429, 529 and network-abort scenarios below trigger
 * the diagnostic on purpose, so each calls this once the failure has rendered — but clearing the
 * whole list, rather than filtering, would just as happily hide a real console error the app logged
 * on the same path, key included. `e2e/fixtures.ts`'s own docblock allows a scenario to "empty"
 * the list to tolerate an expected one; this is the narrower form that keeps the teardown check
 * meaningful for everything else.
 */
function tolerateExpectedNetworkErrorLog(consoleErrors: string[]): void {
	for (let index = consoleErrors.length - 1; index >= 0; index -= 1) {
		if (NETWORK_DIAGNOSTIC_LOG.test(consoleErrors[index])) consoleErrors.splice(index, 1);
	}
}

/**
 * Every console message the page logs, at any level — not just `consoleErrors`' `error`-level
 * subset — so a failure scenario can prove the key reaches none of them, the same check the success
 * scenario already runs.
 */
function collectConsoleMessages(page: Page): string[] {
	const messages: string[] = [];
	page.on('console', (message) => messages.push(message.text()));
	return messages;
}

test('no key dialog is open before Generate is clicked, and clicking it opens one', async ({
	page,
}) => {
	await saveOneRecord(page);
	await waitForGenerateReady(page);

	await expect(keyDialog(page)).toHaveCount(0);

	await generateButton(page).click();
	await expect(keyDialog(page)).toBeVisible();
});

test('the key dialog links to the Anthropic console, and a cost estimate is shown before Generate', async ({
	page,
}) => {
	await saveOneRecord(page);

	// Present before Generate is even clickable, which is the point: the estimate is criterion 6's
	// "shown before generation", not something that only appears once a run starts.
	await expect(page.locator('[data-estimate]')).toBeVisible();

	await waitForGenerateReady(page);
	await generateButton(page).click();

	const dialog = keyDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel(/api key/i)).toBeVisible();
	await expect(dialog.locator('button[type="submit"]')).toBeVisible();
	// The one control criterion 5 needs, per the plan's own Task 6 mapping: the console link, not
	// the spend-limit sentence's wording.
	await expect(dialog.getByRole('link', { name: /anthropic console/i })).toHaveAttribute(
		'href',
		'https://console.anthropic.com',
	);
});

test('the key indicator appears once a key is in session, and Clear empties it', async ({
	page,
}) => {
	await page.goto('/');
	await page.evaluate(([storageKey, key]) => sessionStorage.setItem(storageKey, key), [
		SESSION_KEY_STORAGE_KEY,
		TEST_KEY,
	] as const);
	// `LandingRoute` reads session storage once, in its `useState` initializer, so a key set after
	// mount needs a fresh mount to show up.
	await page.reload();

	const indicator = page.locator('[data-key-indicator]');
	await expect(indicator).toBeVisible();

	await indicator.getByRole('button', { name: /clear/i }).click();
	await expect(indicator).toHaveCount(0);

	const remaining = await page.evaluate(
		(storageKey) => sessionStorage.getItem(storageKey),
		SESSION_KEY_STORAGE_KEY,
	);
	expect(remaining).toBeNull();
});

test('a successful generation reaches the workspace, and the key touches nothing it should not', async ({
	page,
}) => {
	const consoleMessages = collectConsoleMessages(page);

	const recordId = await saveOneRecord(page);

	const sent = await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));

	expect(sent).toHaveLength(1);
	expect(sent[0]?.body.model).toBe('claude-opus-5-5');
	expect(sent[0]?.headers['x-api-key']).toBe(TEST_KEY);

	const record = await readRecord(page, recordId);
	expect(record?.versions).toHaveLength(1);
	expect((record?.versions[0] as { model?: string } | undefined)?.model).toBe('claude-opus-5-5');

	const serializedRecord = JSON.stringify(record);
	expect(serializedRecord).not.toContain(TEST_KEY);
	expect(page.url()).not.toContain(TEST_KEY);
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);

	const stored = await page.evaluate(
		([storageKey, key]) => ({
			session: sessionStorage.getItem(storageKey),
			localStorageHoldsKey: JSON.stringify(localStorage).includes(key),
		}),
		[SESSION_KEY_STORAGE_KEY, TEST_KEY] as const,
	);
	expect(stored.session).toBe(TEST_KEY);
	expect(stored.localStorageHoldsKey).toBe(false);
});

test('a rejected key (401) reopens the key dialog with the key still in session, and no version is saved', async ({
	page,
	consoleErrors,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	await mockAnthropic(page, () => ({ status: 401, body: error401Fixture.body }));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const container = outcome(page, 'credentials');
	await expect(container).toBeVisible();
	tolerateExpectedNetworkErrorLog(consoleErrors);

	const recovery = container.getByRole('button', { name: /api key|update key/i });
	await expect(recovery).toHaveCount(1);
	await expect(container.getByRole('button')).toHaveCount(1);

	// #23's own rule: a rejected key stays loaded, so the person can inspect or fix it rather than
	// paste it again from scratch.
	const sessionValue = await page.evaluate(
		(storageKey) => sessionStorage.getItem(storageKey),
		SESSION_KEY_STORAGE_KEY,
	);
	expect(sessionValue).toBe(TEST_KEY);

	await recovery.click();
	const dialog = keyDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel(/api key/i)).toHaveValue(TEST_KEY);

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);
});

test('a rate limit (429) offers a manual retry, surfaces the retry window, no version is saved, and nothing retries on its own', async ({
	page,
	consoleErrors,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	const sent = await mockAnthropic(page, () => ({
		status: 429,
		body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
		headers: { 'retry-after': '30', 'access-control-expose-headers': 'retry-after' },
	}));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const container = outcome(page, 'rate-limit');
	await expect(container).toBeVisible();
	tolerateExpectedNetworkErrorLog(consoleErrors);
	await expect(container.getByRole('button', { name: /retry/i })).toHaveCount(1);
	await expect(container.getByRole('button')).toHaveCount(1);
	// Not a wording check: the issue asks for the retry window to reach the page at all, and the
	// number is the one part of `describeFailure`'s message that isn't copy — it's
	// `error.retryAfterSeconds` off the `retry-after` header, read back out through the DOM. The
	// paired "no retry-after" scenario below is what proves this isn't matching on a stray "30"
	// somewhere else in the panel.
	await expect(container).toContainText('30');

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);

	// Issue #1 rules out spending the person's money without consent, so nothing here may schedule
	// a second call on its own. Five seconds is comfortably past any interval a mistaken retry loop
	// would use.
	await page.waitForTimeout(5000);
	expect(sent).toHaveLength(1);
});

test('a rate limit (429) with no retry-after header shows no retry window', async ({
	page,
	consoleErrors,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	await mockAnthropic(page, () => ({
		status: 429,
		body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
	}));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const container = outcome(page, 'rate-limit');
	await expect(container).toBeVisible();
	tolerateExpectedNetworkErrorLog(consoleErrors);
	await expect(container.getByRole('button', { name: /retry/i })).toHaveCount(1);
	// The counterpart to the scenario above: with no `retry-after` header at all, `parseRetryAfter`
	// (`app/readers/anthropic-reader.ts`) has nothing to read, so no window should render, and this
	// is what tells the two scenarios' `toContainText('30')` checks apart from each other rather than
	// both trivially passing on a page that always shows "30" somewhere.
	await expect(container).not.toContainText('30');

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);
});

test('an overloaded response (529) offers a manual retry, no version is saved, and nothing retries on its own', async ({
	page,
	consoleErrors,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	const sent = await mockAnthropic(page, () => ({ status: 529, body: error529Fixture.body }));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	// 529 maps to the `server` kind (`app/readers/anthropic-errors.ts`'s `errorKindForStatus`), the
	// same recovery path 500 and 504 take.
	const container = outcome(page, 'server');
	await expect(container).toBeVisible();
	tolerateExpectedNetworkErrorLog(consoleErrors);
	await expect(container.getByRole('button', { name: /retry/i })).toHaveCount(1);
	await expect(container.getByRole('button')).toHaveCount(1);

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);

	await page.waitForTimeout(5000);
	expect(sent).toHaveLength(1);
});

test('a network failure offers a manual retry, and no version is saved', async ({
	page,
	consoleErrors,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	await mockAnthropicNetworkFailure(page);

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const container = outcome(page, 'network');
	await expect(container).toBeVisible();
	tolerateExpectedNetworkErrorLog(consoleErrors);
	await expect(container.getByRole('button', { name: /retry/i })).toHaveCount(1);
	await expect(container.getByRole('button')).toHaveCount(1);

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);
});

test('a malformed response offers a repair, and no version is saved until it is used', async ({
	page,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	await mockAnthropic(page, () => ({ status: 200, body: malformedFixture.body }));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const container = outcome(page, 'malformed');
	await expect(container).toBeVisible();
	await expect(container.getByRole('button', { name: /repair/i })).toHaveCount(1);
	await expect(container.getByRole('button')).toHaveCount(1);
	await expect(container.locator('details')).toBeVisible();

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);
});

test('a refusal offers no retry, and no version is saved', async ({ page }) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	await mockAnthropic(page, () => ({ status: 200, body: refusalFixture.body }));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const container = outcome(page, 'refusal');
	await expect(container).toBeVisible();
	// `none` means the descriptor names no recovery at all, so the container carries its message and
	// nothing a person could click.
	await expect(container.getByRole('button')).toHaveCount(0);

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);
});

test('a repair retry resends the conversation once and succeeds on the second call', async ({
	page,
}) => {
	const recordId = await saveOneRecord(page);

	const sent = await mockAnthropic(page, (body, attempt) => {
		if (attempt === 1) return { status: 200, body: malformedFixture.body };
		return { status: 200, body: successResponseBody(imageIdFromRequest(body)) };
	});

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const container = outcome(page, 'malformed');
	await expect(container).toBeVisible();
	await container.getByRole('button', { name: /repair/i }).click();

	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));

	expect(sent).toHaveLength(2);
	// The repair conversation is the original turn, the model's own (unreadable) answer played back,
	// and a user turn naming what to fix — never a trailing assistant turn, which Opus 5.5 rejects
	// as a prefill (`buildMessages` in `app/readers/anthropic-request.ts`).
	expect(sent[1]?.body.messages.map((message) => message.role)).toEqual([
		'user',
		'assistant',
		'user',
	]);

	const record = await readRecord(page, recordId);
	expect(record?.versions).toHaveLength(1);
});
