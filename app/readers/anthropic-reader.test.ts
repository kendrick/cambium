import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReferenceImage } from '../../core/brand-record';
import { parseSeed } from '../../core/parse-seed';

import { anthropicAuth } from './anthropic-auth';
import { AnthropicReaderError, type AnthropicReaderErrorKind } from './anthropic-errors';
import {
	ANTHROPIC_MESSAGES_URL,
	ANTHROPIC_VERSION,
	createAnthropicBrandReader,
} from './anthropic-reader';
import { buildSeedRequestBody } from './anthropic-request';
import { SEED_PROMPT_VERSION } from './seed-prompt';
import error400 from './fixtures/error-400-invalid-request.json';
import error401 from './fixtures/error-401-credentials.json';
import error402 from './fixtures/error-402-billing.json';
import error403 from './fixtures/error-403-permission.json';
import error413 from './fixtures/error-413-request-too-large.json';
import error429 from './fixtures/error-429-rate-limit.json';
import error500 from './fixtures/error-500-server.json';
import error504 from './fixtures/error-504-gateway-timeout.json';
import error529 from './fixtures/error-529-overloaded.json';
import forcedToolSuccess from './fixtures/forced-tool-success.json';
import malformedNoContentBlock from './fixtures/malformed-no-content-block.json';
import structuredProseNotJson from './fixtures/structured-prose-not-json.json';
import structuredSuccess from './fixtures/structured-success.json';

type Fixture = {
	status: number;
	headers: Record<string, string>;
	body: unknown;
};

/**
 * Distinctive on purpose. The leak assertions search a serialised result for this string, and a
 * plausible-looking `sk-ant-test` could match something the fixtures already say.
 */
const API_KEY = 'sk-ant-LEAK-SENTINEL-9f3ac0b2e7';
const CONFIGURED_MODEL = 'claude-opus-5-configured';

const IMAGES: ReferenceImage[] = [
	{ id: 'img-1', downscaled: 'data:image/webp;base64,AA', originalHash: 'sha256:img-1' },
];

function responseFrom(fixture: Fixture): Response {
	return new Response(JSON.stringify(fixture.body), {
		status: fixture.status,
		headers: fixture.headers,
	});
}

/**
 * A fresh `Response` per call, because a body can only be read once. A stub handing back the same
 * instance twice would fail for the wrong reason if the reader ever retried.
 */
function stubFetch(fixture: Fixture) {
	return vi.fn<typeof globalThis.fetch>(async () => responseFrom(fixture));
}

function readerWith(fetchStub: typeof globalThis.fetch, outputMode?: 'structured' | 'forced-tool') {
	return createAnthropicBrandReader({ model: CONFIGURED_MODEL, outputMode, fetch: fetchStub });
}

function read(fetchStub: typeof globalThis.fetch, outputMode?: 'structured' | 'forced-tool') {
	return readerWith(fetchStub, outputMode).read(IMAGES, { auth: anthropicAuth(API_KEY) });
}

/**
 * Everything a thrown error could carry into a log or a bug report: its own enumerable fields plus
 * `message`, which `Error` defines as non-enumerable and a spread would therefore miss.
 */
function everythingAnErrorCarries(error: AnthropicReaderError): string {
	return JSON.stringify({ ...error, message: error.message });
}

/**
 * Narrows to the reader's own error type, so every failure test reads the `kind` without a cast.
 * A read that resolves, or throws something else, surfaces here rather than passing silently.
 */
async function rejection(promise: Promise<unknown>): Promise<AnthropicReaderError> {
	const outcome = await promise.then(
		() => new Error('expected the read to reject, and it resolved'),
		(caught: unknown) => caught,
	);

	if (outcome instanceof AnthropicReaderError) {
		return outcome;
	}

	throw outcome instanceof Error ? outcome : new Error(String(outcome));
}

/**
 * Every test drives the injected `fetch`, so nothing here should ever reach the global. Standing
 * in for it turns "the suite makes no live call" into something the suite enforces rather than
 * something each new test has to remember. `fetch` is a live global under Node, so its absence
 * cannot be asserted the way `document`'s can in `core/purity.test.ts`; this is the substitute.
 *
 * The check is an assertion afterwards rather than a throw at call time, which matters here and
 * not in the core. The reader wraps anything `fetch` throws as a `network` error, so a guard that
 * threw would arrive disguised as a connection failure, and a test asserting only `kind` and
 * `status` would pass having quietly used the global.
 */
const globalFetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
	vi.stubGlobal('fetch', globalFetch);
});

afterEach(() => {
	const reachedTheGlobal = globalFetch.mock.calls.length > 0;

	globalFetch.mockClear();
	vi.unstubAllGlobals();

	// Thrown rather than asserted, because oxlint's vitest/no-standalone-expect refuses an
	// `expect` outside a test block. A hook that throws fails the case the same way and says the
	// same thing.
	if (reachedTheGlobal) {
		throw new Error('this test used the global fetch; pass a stub through the reader config');
	}
});

describe('createAnthropicBrandReader success', () => {
	it('returns the structured text block verbatim, and the core accepts it', async () => {
		const result = await read(stubFetch(structuredSuccess));
		const textBlock = structuredSuccess.body.content[0];

		expect(result.raw).toBe(textBlock.text);
		expect(() => JSON.parse(result.raw)).not.toThrow();

		// The claim the whole ticket rests on: what this reader returns is what the core accepts.
		expect(parseSeed(result).ok).toBe(true);
	});

	it('serialises the forced tool input, and the core accepts that too', async () => {
		const result = await read(stubFetch(forcedToolSuccess), 'forced-tool');
		const toolUse = forcedToolSuccess.body.content[0];

		expect(JSON.parse(result.raw)).toEqual(toolUse.input);
		expect(parseSeed(result).ok).toBe(true);
	});

	it('stamps the envelope a stored version is reproducible from', async () => {
		const result = await read(stubFetch(structuredSuccess));

		expect(result.provider).toBe('anthropic');
		expect(result.promptVersion).toBe(SEED_PROMPT_VERSION);
		// The model the response named, not the one the config asked for.
		expect(result.model).toBe(structuredSuccess.body.model);
		expect(result.model).not.toBe(CONFIGURED_MODEL);
	});

	it('falls back to the configured model when the response names none', async () => {
		const { model, ...bodyWithoutModel } = structuredSuccess.body;
		const result = await read(stubFetch({ ...structuredSuccess, body: bodyWithoutModel }));

		expect(model).toBeTruthy();
		expect(result.model).toBe(CONFIGURED_MODEL);
	});

	// The boundary the fixtures README calls out: prose in a text block is a successful read, and
	// the core is what rejects it. Folding it into `malformed` here would swallow the one failure
	// #23 is built to recover from.
	it('resolves when the text block holds prose, leaving not-json to the core', async () => {
		const result = await read(stubFetch(structuredProseNotJson));

		expect(result.raw).toBe(structuredProseNotJson.body.content[0].text);

		const parsed = parseSeed(result);

		expect(parsed.ok).toBe(false);
		expect(parsed.error?.kind).toBe('not-json');
	});
});

describe('createAnthropicBrandReader failures', () => {
	it('calls a 200 with no content block malformed, and carries the body', async () => {
		const error = await rejection(read(stubFetch(malformedNoContentBlock)));

		expect(error.kind).toBe('malformed');
		expect(error.status).toBe(200);
		expect(error.requestId).toBe(malformedNoContentBlock.headers['request-id']);
		expect(JSON.parse(error.body ?? '')).toEqual(malformedNoContentBlock.body);
	});

	it.each<{ label: string; fixture: Fixture; kind: AnthropicReaderErrorKind }>([
		{ label: '400 invalid request', fixture: error400, kind: 'invalid-request' },
		{ label: '401 bad credentials', fixture: error401, kind: 'credentials' },
		{ label: '402 billing', fixture: error402, kind: 'billing' },
		{ label: '403 permission', fixture: error403, kind: 'credentials' },
		{ label: '413 request too large', fixture: error413, kind: 'request-too-large' },
		{ label: '429 rate limit', fixture: error429, kind: 'rate-limit' },
		{ label: '500 server', fixture: error500, kind: 'server' },
		{ label: '504 gateway timeout', fixture: error504, kind: 'server' },
		{ label: '529 overloaded', fixture: error529, kind: 'server' },
	])('turns $label into a $kind error #23 can act on', async ({ fixture, kind }) => {
		const error = await rejection(read(stubFetch(fixture)));

		expect(error.kind).toBe(kind);
		expect(error.status).toBe(fixture.status);
		expect(error.requestId).toBe(fixture.headers['request-id']);
		expect(JSON.parse(error.body ?? '')).toEqual(fixture.body);
	});

	// Issue #1 rules out automatic retry, because it spends the user's money without consent.
	it('reports retry-after on a 429 and makes exactly one request', async () => {
		const fetchStub = stubFetch(error429);
		const error = await rejection(read(fetchStub));

		expect(error.retryAfterSeconds).toBe(40);
		expect(fetchStub).toHaveBeenCalledTimes(1);
	});

	it('leaves retryAfterSeconds null rather than NaN when the header is a date', async () => {
		const headers = { ...error429.headers, 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' };
		const error = await rejection(read(stubFetch({ ...error429, headers })));

		expect(error.retryAfterSeconds).toBeNull();
	});

	it('wraps a rejecting fetch as network, keeping the original as cause', async () => {
		const cause = new TypeError('Failed to fetch');
		const fetchStub = vi.fn<typeof globalThis.fetch>(async () => {
			throw cause;
		});

		const error = await rejection(read(fetchStub));

		expect(error.kind).toBe('network');
		expect(error.status).toBeNull();
		expect(error.cause).toBe(cause);
	});

	it.each<{ label: string; auth: { scheme: string } | null }>([
		{ label: 'no auth at all', auth: null },
		{ label: 'auth belonging to another reader', auth: { scheme: 'codex-cli' } },
	])('refuses $label without spending a request', async ({ auth }) => {
		const fetchStub = stubFetch(structuredSuccess);
		const error = await rejection(readerWith(fetchStub).read(IMAGES, { auth }));

		expect(error.kind).toBe('credentials');
		expect(fetchStub).not.toHaveBeenCalled();
	});
});

describe('createAnthropicBrandReader request', () => {
	it('posts the seed body to the Messages API with the headers it needs', async () => {
		const fetchStub = stubFetch(structuredSuccess);
		await read(fetchStub);

		const [url, init] = fetchStub.mock.calls[0];
		const headers = new Headers(init?.headers);

		expect(url).toBe(ANTHROPIC_MESSAGES_URL);
		expect(init?.method).toBe('POST');
		expect(headers.get('x-api-key')).toBe(API_KEY);
		expect(headers.get('anthropic-version')).toBe(ANTHROPIC_VERSION);
		expect(headers.get('content-type')).toBe('application/json');
		// Unverified against public documentation, and deliberately sent anyway. See the reader.
		expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
	});

	it('defaults to structured output when the config names no mode', async () => {
		const fetchStub = stubFetch(structuredSuccess);
		await read(fetchStub);

		const [, init] = fetchStub.mock.calls[0];

		expect(JSON.parse(String(init?.body))).toEqual(
			buildSeedRequestBody({ images: IMAGES, model: CONFIGURED_MODEL, outputMode: 'structured' }),
		);
	});
});

describe('createAnthropicBrandReader key handling', () => {
	it('keeps the key out of everything a successful read returns', async () => {
		const result = await read(stubFetch(structuredSuccess));

		expect(JSON.stringify(result)).not.toContain(API_KEY);
	});

	it('keeps the key out of an error that will end up in a bug report', async () => {
		const error = await rejection(read(stubFetch(error401)));

		expect(everythingAnErrorCarries(error)).not.toContain(API_KEY);
	});

	it('keeps the key out of the error raised before any request is made', async () => {
		const error = await rejection(
			readerWith(stubFetch(structuredSuccess)).read(IMAGES, {
				auth: null,
			}),
		);

		expect(everythingAnErrorCarries(error)).not.toContain(API_KEY);
	});
});
