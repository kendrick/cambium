import type { Page } from '@playwright/test';

import { ANTHROPIC_MESSAGES_URL } from '../app/readers/anthropic-reader';
// `with { type: 'json' }` is required here: Playwright runs this file as native Node ESM
// (`package.json`'s `"type": "module"`), and Node's own loader refuses a JSON import without the
// attribute, unlike Vitest's bundled runtime, which is why `anthropic-reader.test.ts` gets away
// without one.
import structuredSuccessFixture from '../app/readers/fixtures/structured-success.json' with { type: 'json' };

import { expect } from './fixtures';
import { makePng } from './fixtures/png';

const PNG_NAME = 'brand.png';

/**
 * Chromium preflights the actual POST because `x-api-key` and `anthropic-version` aren't simple
 * headers. `*` is enough here: the request carries no credentials mode, so the wildcard form of
 * every `Access-Control-*` response header is legal under the Fetch spec, and this harness has no
 * reason to enumerate the exact header set the reader happens to send today.
 */
export const PREFLIGHT_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': '*',
	'access-control-allow-methods': '*',
};

export type SentBody = { model?: string; messages: { role: string; content: unknown }[] };

/** A captured POST: the parsed body and the headers the page's own `fetch` actually sent. */
export type SentRequest = { body: SentBody; headers: Record<string, string> };

type MockResponse = { status: number; body: unknown; headers?: Record<string, string> };

/**
 * Installs the one route every scenario needs: answer the CORS preflight, then hand each real
 * POST to `respond`. `respond` sees the parsed body and how many real requests have landed so far
 * (1-based), which is what the repair and no-auto-retry scenarios need to tell requests apart.
 *
 * The returned array is the live list of requests sent so far—it grows as the page makes
 * requests, so a scenario can `expect(sent.length)` after waiting on whatever the UI does next.
 */
export async function mockAnthropic(
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
 * The one text block every request carries per image, ahead of the image block itself
 * (`buildContent` in `app/readers/anthropic-request.ts`). Reading the id back out of the request is
 * what lets the success mock cite an id the freshly saved record actually holds, rather than one
 * borrowed from the fixture's own recording, which a fresh record's schema would reject as
 * `record-schema`.
 */
export function imageIdFromRequest(body: SentBody): string {
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
export function successResponseBody(imageId: string): unknown {
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

export function pngFile(name: string, width = 2, height = 2) {
	return { name, mimeType: 'image/png', buffer: Buffer.from(makePng(width, height)) };
}

/**
 * Stages one reference image and saves it, the same path `e2e/indexeddb.spec.ts` drives. Returns
 * the id the "Saved." outcome put in the URL, which is the one every scenario below needs to reach
 * `GeneratePanel` and to read the record back afterward.
 */
export async function saveOneRecord(page: Page, file = pngFile(PNG_NAME)): Promise<string> {
	await page.goto('/');

	await page.getByLabel('Reference images').setInputFiles(file);
	await expect(page.getByText(file.name, { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Save these references' }).click();
	await expect(page.getByText(/^Saved\./)).toBeVisible();

	const recordId = new URL(page.url()).searchParams.get('record');
	if (!recordId) throw new Error('saving did not put a record id in the URL');

	return recordId;
}

export const generateButton = (page: Page) => page.getByRole('button', { name: 'Generate' });

/** `GeneratePanel` disables Generate until the async cost estimate resolves. */
export async function waitForGenerateReady(page: Page): Promise<void> {
	await expect(generateButton(page)).toBeEnabled();
}

export function keyDialog(page: Page) {
	return page.getByRole('dialog');
}

/**
 * By role and name rather than `type="submit"`: the dialog deliberately has no form to submit,
 * because Chrome's password manager watches form submissions (see the password-manager scenario).
 */
export function useKeyButton(page: Page) {
	return keyDialog(page).getByRole('button', { name: 'Use this key' });
}

export async function submitKeyDialog(page: Page, key: string): Promise<void> {
	const dialog = keyDialog(page);
	await expect(dialog).toBeVisible();
	// The field is uncontrolled (`key-dialog.tsx`'s own doc comment says why), so `fill` is the only
	// way in: there is no prop or state this harness could set instead.
	await dialog.getByLabel(/api key/i).fill(key);
	await useKeyButton(page).click();
}

/** Opens the dialog from Generate and submits a key in one motion, for the common first-run case. */
export async function generateWithFreshKey(page: Page, key: string): Promise<void> {
	await generateButton(page).click();
	await submitKeyDialog(page, key);
}
