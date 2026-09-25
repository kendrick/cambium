import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';

import { ANTHROPIC_MESSAGES_URL } from '../app/readers/anthropic-reader';
// `with { type: 'json' }` is required here: Playwright runs this file as native Node ESM
// (`package.json`'s `"type": "module"`), and Node's own loader refuses a JSON import without the
// attribute, unlike Vitest's bundled runtime, which is why `anthropic-reader.test.ts` gets away
// without one.
import error401Fixture from '../app/readers/fixtures/error-401-credentials.json' with { type: 'json' };
import error529Fixture from '../app/readers/fixtures/error-529-overloaded.json' with { type: 'json' };
import malformedFixture from '../app/readers/fixtures/malformed-no-content-block.json' with { type: 'json' };
import proseNotJsonFixture from '../app/readers/fixtures/structured-prose-not-json.json' with { type: 'json' };
import refusalFixture from '../app/readers/fixtures/refusal-thinking-first.json' with { type: 'json' };
import structuredSuccessFixture from '../app/readers/fixtures/structured-success.json' with { type: 'json' };
import { SESSION_KEY_STORAGE_KEY } from '../app/generation/session-key';
import { DATABASE_NAME, RECORD_STORE_NAME } from '../app/storage/indexed-db-record-store';
import { BrandRecordSchema } from '../core/brand-record';
import type { BrandSeed } from '../core/brand-seed';

import { expect, test } from './fixtures';
import { makePng } from './fixtures/png';

/**
 * Nothing here asserts `describeFailure`'s wording, because
 * `app/generation/describe-failure.test.ts` already pins every message. What a browser alone can
 * prove is the wiring: which `data-outcome` renders, which single recovery control comes with it,
 * and what does or does not reach storage, a URL, or the console. Every assertion below stays at
 * that seam.
 */

/** Distinctive enough that a stray match in a URL, storage dump, or console line can't be a coincidence. */
const TEST_KEY = 'sk-ant-e2e-9f2c6a10b4d84e7fa9c1d2e3f4a5b6c7d8e9f0a1';

/** Distinctive enough that finding it in the unexpected outcome can only mean the held id survived. */
const DISTINCT_REQUEST_ID = 'req-e2e-save-again-unexpected-9f2c6a10';

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
 * The returned array is the live list of requests sent so far—it grows as the page makes
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
 * exactly what `anthropic-reader.ts` maps to the `network` kind—there is no status to fulfill.
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
 * `model` is pinned to `claude-opus-5-5` because the fixture was recorded against `claude-opus-5`,
 * and generation runs on `GENERATION_MODEL`, which is `claude-opus-5-5`.
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

type StoredRecord = { id: string; revision: number; images: { id: string }[]; versions: unknown[] };

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

/**
 * Appends a first version to a stored record through raw IndexedDB, as a commit from another tab
 * would land: behind the landing page's back, after it has already rendered the Generate panel.
 * The result is parsed through `BrandRecordSchema` first, since the panel's fresh `get` parses on
 * the way out and a fixture it rejected would reach the unexpected outcome rather than the branch
 * under test. The key color cites the record's own image so the provenance refinement passes, and
 * `revision` moves by one because a real commit moves it.
 */
async function commitVersionFromAnotherTab(page: Page, recordId: string): Promise<void> {
	const stored = await readRecord(page, recordId);
	if (!stored) throw new Error('no stored record to append a version to');
	const imageId = stored.images[0]?.id;
	if (!imageId) throw new Error('the stored record holds no image for a seed to cite');

	const seed: BrandSeed = {
		keyColors: [
			{
				oklch: [0.6231, 0.188, 259.8],
				proposedRole: 'brand',
				sourceImageId: imageId,
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

	const next = BrandRecordSchema.parse({
		...stored,
		revision: stored.revision + 1,
		versions: [
			{
				createdAt: new Date().toISOString(),
				ordinal: 1,
				seed,
				tokenSet: null,
				provider: 'cambium-e2e-other-tab',
				model: 'cambium-e2e-other-tab',
				promptVersion: 'cambium-e2e-other-tab',
				rawResponse: 'raw model output from the other tab',
				scaleEngine: 'cambium-oklch-1',
				fontTable: { source: 'cambium-e2e-other-tab', version: '1' },
				interpretation: 'balanced',
				overrides: [],
			},
		],
	});

	await page.evaluate(
		async ([databaseName, storeName, value]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});

			try {
				await new Promise<void>((resolve, reject) => {
					const transaction = db.transaction(storeName, 'readwrite');
					transaction.objectStore(storeName).put(value);
					transaction.addEventListener('complete', () => resolve());
					transaction.addEventListener('error', () => reject(transaction.error));
				});
			} finally {
				db.close();
			}
		},
		[DATABASE_NAME, RECORD_STORE_NAME, next] as const,
	);
}

function pngFile(name: string, width = 2, height = 2) {
	return { name, mimeType: 'image/png', buffer: Buffer.from(makePng(width, height)) };
}

/**
 * Stages one reference image and saves it, the same path `e2e/indexeddb.spec.ts` drives. Returns
 * the id the "Saved." outcome put in the URL, which is the one every scenario below needs to reach
 * `GeneratePanel` and to read the record back afterward.
 */
async function saveOneRecord(page: Page, file = pngFile(PNG_NAME)): Promise<string> {
	await page.goto('/');

	await page.getByLabel('Reference images').setInputFiles(file);
	await expect(page.getByText(file.name, { exact: true })).toBeVisible();

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

/**
 * By role and name rather than `type="submit"`: the dialog deliberately has no form to submit,
 * because Chrome's password manager watches form submissions (see the password-manager scenario).
 */
function useKeyButton(page: Page) {
	return keyDialog(page).getByRole('button', { name: 'Use this key' });
}

async function submitKeyDialog(page: Page, key: string): Promise<void> {
	const dialog = keyDialog(page);
	await expect(dialog).toBeVisible();
	// The field is uncontrolled (`key-dialog.tsx`'s own doc comment says why), so `fill` is the only
	// way in: there is no prop or state this harness could set instead.
	await dialog.getByLabel(/api key/i).fill(key);
	await useKeyButton(page).click();
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
 * Chromium's own network diagnostic for a fetch that lands on a non-2xx status or gets aborted—
 * "Failed to load resource: the server responded with a status of…" or "net::ERR_FAILED"—never
 * anything the app's code calls, and it fires the same way for a real Anthropic outage as it does
 * here.
 */
const NETWORK_DIAGNOSTIC_LOG = /Failed to load resource|net::ERR_FAILED/;

/**
 * Removes only Chromium's own network diagnostic from the auto `consoleErrors` fixture, leaving
 * anything else in the list untouched. The 401, 429, 529 and network-abort scenarios below trigger
 * the diagnostic on purpose, so each calls this once the failure has rendered—but clearing the
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
 * Every console message the page logs, at any level—not just `consoleErrors`' `error`-level
 * subset—so a failure scenario can prove the key reaches none of them, the same check the success
 * scenario already runs.
 */
function collectConsoleMessages(page: Page): string[] {
	const messages: string[] = [];
	page.on('console', (message) => messages.push(message.text()));
	return messages;
}

/**
 * The serialized DOM, which is what an extension, a saved page, or a screenshot tool reads. An
 * input's typed value lives in the element's property and never reaches this, but a
 * `value` attribute (a prefilled `defaultValue`) does, so this is what catches the key being
 * rendered back into the page.
 */
async function expectKeyNotInPage(page: Page): Promise<void> {
	expect(await page.content()).not.toContain(TEST_KEY);
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

	// Read as the person reads it: the dollar figure in the rendered sentence. The bounds are worked
	// out by hand from the published rates ($4/M input, $20/M output), not from `cost-estimate.ts`.
	//   Floor: the output ceiling alone, 16,000 tokens x $20/M = $0.32. No prompt is estimated lower.
	//   Ceiling: the fixture PNG is 2x2 px, and intake never upscales, so the image is at most
	//   ceil(4/750) = 1 token. The prompt text is about 13,000 characters, as `generationPromptChars`
	//   counts it; 100,000 characters is a generous bound, which at 4 characters a token is 25,000
	//   tokens. Input is then at most 25,001 x $4/M = $0.100004, so the total is at most $0.420004,
	//   which rounds up to $0.43.
	const estimateText = (await page.locator('[data-estimate]').textContent()) ?? '';
	const dollars = /\$(\d+\.\d{2})\b/.exec(estimateText)?.[1];
	expect(dollars, `no dollar amount in "${estimateText}"`).toBeDefined();
	expect(Number(dollars)).toBeGreaterThanOrEqual(0.32);
	expect(Number(dollars)).toBeLessThanOrEqual(0.43);

	await generateButton(page).click();

	const dialog = keyDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel(/api key/i)).toBeVisible();
	await expect(useKeyButton(page)).toBeVisible();
	// #23's criterion 5 is checked through its one control, the console link. The spend-limit
	// sentence is copy, so its wording goes unasserted here.
	await expect(dialog.getByRole('link', { name: /anthropic console/i })).toHaveAttribute(
		'href',
		'https://console.anthropic.com',
	);
});

/**
 * Parses the input-token count out of the estimate as it renders, which is the figure a person
 * reads. `Intl.NumberFormat('en-US')` groups thousands with commas.
 */
async function renderedInputTokens(page: Page): Promise<number> {
	const text = (await page.locator('[data-estimate]').first().textContent()) ?? '';
	const match = /about ([\d,]+) input tokens/.exec(text);
	if (!match) throw new Error(`no input-token count in "${text}"`);
	return Number(match[1].replaceAll(',', ''));
}

// Every other fixture here is 2x2 px, which is 1 image token, so a measure() that read dimensions
// wrong by orders of magnitude still rendered the same dollar figure and passed. At 1568x1176 the
// image term is 2459 tokens, so a wrong measure() moves the rendered count.
test('the estimate grows by the image term of a large reference, worked out by hand', async ({
	page,
}) => {
	await saveOneRecord(page);
	await waitForGenerateReady(page);
	const smallTokens = await renderedInputTokens(page);

	// 1568x1176 is exactly intake's 1568 px long-edge cap, so it is stored at that size.
	await saveOneRecord(page, pngFile('large.png', 1568, 1176));
	await waitForGenerateReady(page);
	const largeTokens = await renderedInputTokens(page);

	// Anthropic's vision rule, one token per 750 px², rounded up per image:
	//   large: 1568 x 1176 = 1,843,968 px; / 750 = 2458.624 -> 2459 tokens
	//   small: 2 x 2 = 4 px; / 750 = 0.005 -> 1 token
	// Both records hold one image under the same prompt, so the rendered counts differ by the image
	// term alone: 2459 - 1 = 2458.
	expect(largeTokens - smallTokens).toBe(2458);
});

/**
 * The same field filled with two different keys of the same length, rasterized. A masked field
 * draws identical discs for both; a field showing the key draws different glyphs. Blurred first so
 * a blinking caret can't make two masked shots differ, and captured with animations finished, since
 * the dialog's open transition otherwise lands mid-frame in a busy run.
 */
async function keyFieldPixels(page: Page, key: string): Promise<Buffer> {
	const field = keyDialog(page).getByLabel(/api key/i);
	await field.fill(key);
	await field.evaluate((element) => (element as HTMLInputElement).blur());
	return field.screenshot({ animations: 'disabled' });
}

/**
 * Two masked shots still differ by 1 in a channel along the rounded border's antialiasing, from run
 * to run. Glyphs a field shows in the clear differ by most of the 0-255 range, so 8 separates the
 * two cases with room on both sides.
 */
const MASKED_PIXEL_TOLERANCE = 8;

function largestChannelDifference(first: Buffer, second: Buffer): number {
	const a = PNG.sync.read(first);
	const b = PNG.sync.read(second);
	if (a.width !== b.width || a.height !== b.height) return 255;

	let largest = 0;
	for (let index = 0; index < a.data.length; index += 1) {
		largest = Math.max(largest, Math.abs(a.data[index] - b.data[index]));
	}
	return largest;
}

// A `type="password"` field inside a submitted form reads to Chrome's password manager as a login,
// and it offers to save the key into the person's synced passwords.
test('the key field is masked without reading as a password to a password manager, and Enter submits it', async ({
	page,
}) => {
	const recordId = await saveOneRecord(page);
	await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));
	await waitForGenerateReady(page);
	await generateButton(page).click();

	const dialog = keyDialog(page);
	const field = dialog.getByLabel(/api key/i);
	await expect(field).toBeVisible();

	expect(await field.getAttribute('type')).not.toBe('password');
	await expect(field).toHaveAttribute('autocomplete', 'off');
	await expect(field).toHaveAttribute('data-1p-ignore', '');
	await expect(field).toHaveAttribute('data-lpignore', 'true');
	await expect(field).toHaveAttribute('data-bwignore', '');
	await expect(field).toHaveAttribute('data-form-type', 'other');
	// No form means no native submission for the password manager to watch.
	await expect(dialog.locator('form')).toHaveCount(0);

	const sameLength = 'x'.repeat(TEST_KEY.length);
	expect(
		largestChannelDifference(
			await keyFieldPixels(page, sameLength),
			await keyFieldPixels(page, TEST_KEY),
		),
	).toBeLessThanOrEqual(MASKED_PIXEL_TOLERANCE);

	await field.fill(TEST_KEY);
	await expect(page.locator('input[type="password"]')).toHaveCount(0);

	await field.press('Enter');
	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
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
	await generateButton(page).click();
	const dialog = keyDialog(page);
	await dialog.getByLabel(/api key/i).fill(TEST_KEY);
	await expectKeyNotInPage(page);
	await useKeyButton(page).click();

	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));
	await expectKeyNotInPage(page);

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

// The landing page offers Generate only for a record with no versions, and it decided that when it
// rendered. Another tab can commit the first version after that, and a click here would then pay
// for a second one the person never asked for.
test('Generate on a record another tab has since given a version sends nothing and opens that record', async ({
	page,
}) => {
	const recordId = await saveOneRecord(page);
	const sent = await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
	}));

	await waitForGenerateReady(page);
	await commitVersionFromAnotherTab(page, recordId);
	await generateWithFreshKey(page, TEST_KEY);

	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));
	expect(sent).toHaveLength(0);
	expect((await readRecord(page, recordId))?.versions).toHaveLength(1);
});

test('a rejected key (401) reopens the key dialog by itself with the key still in session, and no version is saved', async ({
	page,
	consoleErrors,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	const sent = await mockAnthropic(page, () => ({ status: 401, body: error401Fixture.body }));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	// Nothing is clicked between the 401 and this check. The dialog comes back by itself with the
	// rejection stated inside it. The field stays empty, since a prefill would write the key into the
	// DOM as a `value` attribute, and the dialog says the loaded key is still there instead.
	const dialog = keyDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel(/api key/i)).toHaveValue('');
	await expect(dialog.locator('[data-key-loaded]')).toBeVisible();
	await expect(dialog.locator('[data-key-notice]')).toBeVisible();
	await expectKeyNotInPage(page);
	tolerateExpectedNetworkErrorLog(consoleErrors);

	// #23's own rule: a rejected key stays loaded, so the person can inspect or fix it rather than
	// paste it again from scratch.
	const sessionValue = await page.evaluate(
		(storageKey) => sessionStorage.getItem(storageKey),
		SESSION_KEY_STORAGE_KEY,
	);
	expect(sessionValue).toBe(TEST_KEY);

	// Dismissing the dialog leaves the outcome and its one button for reopening the dialog.
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);

	const container = outcome(page, 'credentials');
	await expect(container).toBeVisible();
	const recovery = container.getByRole('button', { name: /api key|update key/i });
	await expect(recovery).toHaveCount(1);
	await expect(container.getByRole('button')).toHaveCount(1);

	await recovery.click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel(/api key/i)).toHaveValue('');
	await expectKeyNotInPage(page);

	// Submitting the empty field keeps the loaded key and sends nothing, since #23 forbids a retry
	// the person didn't ask for.
	await useKeyButton(page).click();
	await expect(dialog).toHaveCount(0);
	const keptValue = await page.evaluate(
		(storageKey) => sessionStorage.getItem(storageKey),
		SESSION_KEY_STORAGE_KEY,
	);
	expect(keptValue).toBe(TEST_KEY);
	expect(sent).toHaveLength(1);
	await expectKeyNotInPage(page);

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
	// number is the one part of `describeFailure`'s message that isn't copy—it's
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

test('a malformed response offers a retry, not a repair, shows what came back, and saves no version', async ({
	page,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	await mockAnthropic(page, () => ({ status: 200, body: malformedFixture.body }));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	// No seed text came back, so there is nothing for a repair to hand the model. The raw body is
	// still there for the person to read.
	const container = outcome(page, 'malformed');
	await expect(container).toBeVisible();
	await expect(container.getByRole('button', { name: /retry/i })).toHaveCount(1);
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

const PROSE_TEXT = (
	proseNotJsonFixture.body.content.find((block) => block.type === 'text') as { text: string }
).text;

test('a repair asked for after the key was cleared still goes out as a repair once a key is entered', async ({
	page,
}) => {
	const recordId = await saveOneRecord(page);

	const sent = await mockAnthropic(page, (body, attempt) => {
		if (attempt === 1) return { status: 200, body: proseNotJsonFixture.body };
		return { status: 200, body: successResponseBody(imageIdFromRequest(body)) };
	});

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	const container = outcome(page, 'not-json');
	await expect(container).toBeVisible();

	// A repair is a whole second request, images resent and the same output ceiling, so its price
	// shows before the button is pressed. The floor is worked out by hand: 16,000 output tokens at
	// $20/M is $0.32, and no repair is estimated below its output ceiling.
	const repairEstimate = container.locator('[data-estimate]');
	await expect(repairEstimate).toBeVisible();
	const repairText = (await repairEstimate.textContent()) ?? '';
	const repairDollars = /\$(\d+\.\d{2})\b/.exec(repairText)?.[1];
	expect(repairDollars, `no dollar amount in "${repairText}"`).toBeDefined();
	expect(Number(repairDollars)).toBeGreaterThanOrEqual(0.32);

	// The floor alone passes a repair priced on output only, since a 2x2 image's input rounds to a
	// cent. A repair resends the first request's text and adds the answer and a directive, so its
	// estimate can't be less than the first run's shown on the same page.
	const firstText = (await page.locator('[data-estimate]').first().textContent()) ?? '';
	const firstDollars = /\$(\d+\.\d{2})\b/.exec(firstText)?.[1];
	expect(firstDollars, `no dollar amount in "${firstText}"`).toBeDefined();
	expect(Number(repairDollars)).toBeGreaterThanOrEqual(Number(firstDollars));

	// With no key left, Repair has to ask for one first. The run that follows must still be the
	// repair, not a plain generation that drops the answer being fixed.
	await page.locator('[data-key-indicator]').getByRole('button', { name: /clear/i }).click();
	await container.getByRole('button', { name: /repair/i }).click();
	await submitKeyDialog(page, TEST_KEY);

	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));

	expect(sent).toHaveLength(2);
	// The repair conversation is the original turn, the model's own prose played back, and a user
	// turn naming what to fix. Never a trailing assistant turn, which Opus 5.5 rejects as a prefill
	// (`buildMessages` in `app/readers/anthropic-request.ts`).
	const repairMessages = sent[1]?.body.messages ?? [];
	expect(repairMessages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
	expect(repairMessages[1]?.content).toEqual([{ type: 'text', text: PROSE_TEXT }]);

	const record = await readRecord(page, recordId);
	expect(record?.versions).toHaveLength(1);
});

/**
 * A route that answers the preflight and then holds the real request open forever, the way a
 * stalled connection does. The handler never settles the route, so only the page aborting its own
 * `fetch` can end the request.
 */
async function mockAnthropicStall(page: Page): Promise<SentRequest[]> {
	const sent: SentRequest[] = [];

	await page.route(ANTHROPIC_MESSAGES_URL, async (route) => {
		const request = route.request();

		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
			return;
		}

		sent.push({ body: request.postDataJSON() as SentBody, headers: request.headers() });
	});

	return sent;
}

test('a stalled request can be cancelled, which offers a retry and saves no version', async ({
	page,
	consoleErrors,
}) => {
	const consoleMessages = collectConsoleMessages(page);
	const recordId = await saveOneRecord(page);

	const sent = await mockAnthropicStall(page);

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	await expect.poll(() => sent.length).toBe(1);
	const cancel = page.getByRole('button', { name: 'Cancel' });
	await expect(cancel).toBeVisible();
	await cancel.click();

	const container = outcome(page, 'cancelled');
	await expect(container).toBeVisible();
	tolerateExpectedNetworkErrorLog(consoleErrors);
	await expect(container.getByRole('button', { name: /retry/i })).toHaveCount(1);
	await expect(container.getByRole('button')).toHaveCount(1);
	await expect(cancel).toHaveCount(0);

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(consoleMessages.join('\n')).not.toContain(TEST_KEY);
	expect(sent).toHaveLength(1);
});

/**
 * Everything the font lookup fetches from jsDelivr ends in this file (`UPSTREAM_URL` in
 * `app/fonts/font-table-provider.ts`). No other scenario routes it, so it only stalls here.
 */
const FONT_TABLE_CSV_GLOB = '**/families.csv';

test('a font lookup stalled before any request can be cancelled, which sends nothing and offers a retry', async ({
	page,
}) => {
	const recordId = await saveOneRecord(page);

	let csvRequested = false;
	// Never fulfilled, so the lookup has no answer and no timeout. Only Cancel can end the run.
	await page.route(FONT_TABLE_CSV_GLOB, () => {
		csvRequested = true;
	});
	const sent = await mockAnthropic(page, () => ({ status: 500, body: {} }));

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	await expect.poll(() => csvRequested).toBe(true);
	const cancel = page.getByRole('button', { name: 'Cancel' });
	await expect(cancel).toBeVisible();
	await cancel.click();

	const container = outcome(page, 'cancelled');
	await expect(container).toBeVisible();
	await expect(cancel).toHaveCount(0);
	// Generate stays disabled while a failure shows, by design, so Retry is the way back in.
	await expect(container.getByRole('button', { name: /retry/i })).toBeEnabled();
	await expect(container.getByRole('button')).toHaveCount(1);

	expect(sent).toHaveLength(0);
	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
});

/**
 * Opens a readwrite transaction on the record store and keeps it alive with a chain of requests, so
 * the app's own commit queues behind it. This is how another tab's write would stall a commit, and
 * it turns the milliseconds between "answer arrived" and "version written" into a window a test can
 * act inside. Returns once the transaction is live; `releaseRecordStore` ends it.
 */
async function holdRecordStore(page: Page): Promise<void> {
	await page.evaluate(
		async ([databaseName, storeName]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName);
				request.addEventListener('success', () => resolve(request.result));
				request.addEventListener('error', () => reject(request.error));
			});
			const transaction = db.transaction(storeName, 'readwrite');
			const store = transaction.objectStore(storeName);
			const holder = window as unknown as { releaseRecordStore?: () => void };
			let held = true;

			// A transaction commits once it has no pending requests, so each one queues the next.
			const spin = () => {
				if (held) store.count().addEventListener('success', spin);
			};
			spin();
			transaction.addEventListener('complete', () => db.close());
			holder.releaseRecordStore = () => {
				held = false;
			};
		},
		[DATABASE_NAME, RECORD_STORE_NAME] as const,
	);
}

async function releaseRecordStore(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as unknown as { releaseRecordStore?: () => void }).releaseRecordStore?.();
	});
}

test('Cancel is withdrawn once the answer is in and the commit has started', async ({ page }) => {
	const recordId = await saveOneRecord(page);

	let answer: (() => void) | undefined;
	const answered = new Promise<void>((resolve) => {
		answer = resolve;
	});

	const sent = await mockAnthropic(page, async (body) => {
		await answered;
		return { status: 200, body: successResponseBody(imageIdFromRequest(body)) };
	});

	await waitForGenerateReady(page);
	await generateWithFreshKey(page, TEST_KEY);

	await expect.poll(() => sent.length).toBe(1);
	const cancel = page.getByRole('button', { name: 'Cancel' });
	await expect(cancel).toBeVisible();

	// The record was read before the request went out, so from here the only thing the app still
	// needs from the store is the commit's write, and that is what the hold stalls.
	await holdRecordStore(page);
	answer?.();

	// The answer is paid for and on its way into storage, so a Cancel pressed now could stop nothing.
	// A Cancel still on screen here would swallow the click.
	await expect(cancel).toHaveCount(0);
	await expect(page).not.toHaveURL(/\/workspace/);

	await releaseRecordStore(page);
	await expect(page).toHaveURL(new RegExp(`/workspace\\?record=${recordId}$`));
	expect((await readRecord(page, recordId))?.versions).toHaveLength(1);
	expect(sent).toHaveLength(1);
});

test('Cancel ends a run stalled on the record lookup before anything is sent', async ({ page }) => {
	const recordId = await saveOneRecord(page);
	const sent = await mockAnthropic(page, () => ({ status: 500, body: {} }));

	await waitForGenerateReady(page);
	// Held before the click, so the panel's fresh read of the record queues behind it and the run
	// can't reach the font lookup or the request.
	await holdRecordStore(page);

	// Released in `finally` even when an assertion fails. Left held, a failing run's teardown stalled
	// for over four minutes.
	try {
		await generateWithFreshKey(page, TEST_KEY);

		const cancel = page.getByRole('button', { name: 'Cancel' });
		await expect(cancel).toBeVisible();
		await cancel.click();

		// Asserted while the hold is still in place. A run that only noticed the abort once the read
		// came back would pass after the release and prove nothing.
		const container = outcome(page, 'cancelled');
		await expect(container).toBeVisible();
		await expect(cancel).toHaveCount(0);
		await expect(container.getByRole('button', { name: /retry/i })).toBeEnabled();
		await expect(container.getByRole('button')).toHaveCount(1);
		expect(sent).toHaveLength(0);
	} finally {
		await releaseRecordStore(page);
	}

	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
	expect(sent).toHaveLength(0);
});

type PutFailureMode = 'pass' | 'quota' | 'abort';

/**
 * Patches `IDBObjectStore.prototype.put` before the page's first script runs, since that's the one
 * method both `saveOneRecord`'s own write and every commit under it call, however many layers of
 * `idb` and `workspace-store` sit between the click and it. `pass` runs the original, so the record
 * this scenario stages goes through the same patch it will later use to fail. Installed once per
 * page load; `setPutFailureMode` flips the live mode without a reload.
 */
async function installPutFailure(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const proto = IDBObjectStore.prototype;
		const original = proto.put;
		const state = { mode: 'pass' as string };
		(window as unknown as { putFailure: { mode: string } }).putFailure = state;

		proto.put = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
			const mode = (window as unknown as { putFailure: { mode: string } }).putFailure.mode;
			if (mode === 'quota') throw new DOMException('e2e: simulated quota', 'QuotaExceededError');
			if (mode === 'abort') throw new DOMException('e2e: simulated abort', 'AbortError');
			return original.apply(this, args);
		};
	});
}

async function setPutFailureMode(page: Page, mode: PutFailureMode): Promise<void> {
	await page.evaluate((nextMode) => {
		(window as unknown as { putFailure: { mode: string } }).putFailure.mode = nextMode;
	}, mode);
}

test('a save-again that fails on an unrecognised error still names the paid read a storage-quota failure held', async ({
	page,
}) => {
	// Installed before the record is even saved, so the same patch carries the fixture's own write
	// and the generation commit that follows, and nothing here depends on a reload to pick it up.
	await installPutFailure(page);
	const recordId = await saveOneRecord(page);

	const sent = await mockAnthropic(page, (body) => ({
		status: 200,
		body: successResponseBody(imageIdFromRequest(body)),
		headers: {
			'request-id': DISTINCT_REQUEST_ID,
			'access-control-expose-headers': 'request-id',
		},
	}));

	await waitForGenerateReady(page);

	try {
		// The paid read lands, then the commit's write throws quota-exceeded, which is recognised and
		// held with the read's id for "Save again".
		await setPutFailureMode(page, 'quota');
		await generateWithFreshKey(page, TEST_KEY);

		const quotaContainer = outcome(page, 'storage-quota-exceeded');
		await expect(quotaContainer).toBeVisible();
		const saveAgain = quotaContainer.getByRole('button', { name: 'Save again' });
		await expect(saveAgain).toBeVisible();

		// Save again makes no request of its own, so this is the one commit it triggers, and it throws
		// something `saveGeneratedVersion` doesn't recognise. No new paid read follows it.
		await setPutFailureMode(page, 'abort');
		await saveAgain.click();

		const unexpectedContainer = outcome(page, 'unexpected');
		await expect(unexpectedContainer).toBeVisible();
		// The id here is `attempt.held.requestId`, carried from the paid read before either write ran,
		// not copy, so this checks the code element's data rather than the surrounding sentence.
		await expect(unexpectedContainer.locator('code')).toHaveText(DISTINCT_REQUEST_ID);
	} finally {
		await setPutFailureMode(page, 'pass');
	}

	expect(sent).toHaveLength(1);
	await expect(await readRecord(page, recordId)).toMatchObject({ versions: [] });
});
