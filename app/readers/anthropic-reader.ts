import type { BrandReader } from '../../core/brand-reader';

import { isAnthropicAuth } from './anthropic-auth';
import { AnthropicReaderError, errorKindForStatus } from './anthropic-errors';
import { type AnthropicOutputMode, buildSeedRequestBody } from './anthropic-request';
import { SEED_PROMPT_VERSION, SEED_TOOL_NAME } from './seed-prompt';

export const ANTHROPIC_PROVIDER = 'anthropic';
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

export type AnthropicReaderConfig = {
	model: string;
	outputMode?: AnthropicOutputMode;
	/**
	 * Injected so the suite drives every path without a live request. A reader that called the
	 * global directly would leave "no test ever calls the API" resting on whoever writes the next
	 * test remembering to pass a stub.
	 */
	fetch?: typeof globalThis.fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function contentBlocks(body: unknown): Record<string, unknown>[] {
	const content = isRecord(body) ? body.content : null;
	return Array.isArray(content) ? content.filter(isRecord) : [];
}

/**
 * Reads whichever envelope arrived, rather than branching on `outputMode`. The mode picks a
 * request shape, and only the response says what came back, so a reader that trusts its own
 * request over the answer it got is one API change away from a failure nobody can diagnose.
 *
 * A `tool_use` block wins over a `text` block when both are present, because a forced tool call
 * may arrive behind a sentence of preamble; the seed is the tool input, the prose is commentary.
 * The named tool is preferred but not required. A renamed tool is still a seed, and refusing to
 * read one would turn a recoverable response into a `malformed`.
 *
 * Null means no readable block at all. It does not mean unparseable: a text block holding prose
 * is a success here and `parseSeed`'s `not-json` case downstream, which is the one #23 shows the
 * user and offers a repair retry on.
 */
function normalizeRaw(body: unknown): string | null {
	const blocks = contentBlocks(body);
	const toolUses = blocks.filter((block) => block.type === 'tool_use' && block.input !== undefined);
	const seedToolUse = toolUses.find((block) => block.name === SEED_TOOL_NAME) ?? toolUses[0];

	if (seedToolUse) {
		return JSON.stringify(seedToolUse.input);
	}

	const textBlock = blocks.find((block) => block.type === 'text' && typeof block.text === 'string');

	return typeof textBlock?.text === 'string' ? textBlock.text : null;
}

function modelFromBody(body: unknown): string | null {
	const model = isRecord(body) ? body.model : null;
	return typeof model === 'string' && model.length > 0 ? model : null;
}

/**
 * `retry-after` is a header string, and the HTTP spec lets it carry a date instead of a count of
 * seconds. `Number` turns that into NaN, which would reach the user as "retry in NaN seconds", so
 * anything non-numeric resolves to null and #23 falls back to its own wording.
 */
function parseRetryAfter(headers: Headers): number | null {
	const value = headers.get('retry-after');

	if (value === null) {
		return null;
	}

	const seconds = Number(value.trim());

	return Number.isFinite(seconds) ? seconds : null;
}

/**
 * The body is diagnostic on the failure path and the failure path has nowhere to put a second
 * failure, so a body that will not read costs the detail rather than the error.
 */
async function readBodyText(response: Response): Promise<string | null> {
	try {
		return await response.text();
	} catch {
		return null;
	}
}

/**
 * The only module in the repo that calls `fetch`. It talks to `POST /v1/messages` directly rather
 * than through `@anthropic-ai/sdk`, per ADR-0002: the request is one shape, the dependency is not
 * in the measured baseline, and a bring-your-own-key static site pays for every kilobyte.
 *
 * The key arrives per read through `options.auth`, never through this config. That is the seam's
 * decision (`core/brand-reader.ts`), and it keeps a key out of anything long-lived enough to be
 * logged. Nothing this module returns or throws carries it either: error messages name the status,
 * and every attached body is the response's, never the request's.
 */
export function createAnthropicBrandReader(config: AnthropicReaderConfig): BrandReader {
	const outputMode = config.outputMode ?? 'structured';
	// Bound, not merely referenced: a browser's `fetch` throws "Illegal invocation" when it is
	// called detached from `globalThis`.
	const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);

	return {
		async read(images, options) {
			const { auth } = options;

			// Before the round trip, deliberately. A missing key is a failure the user can fix where
			// they are standing, and spending a request to learn it returns a 401 that reads like a
			// rejected key rather than an absent one.
			if (!isAnthropicAuth(auth)) {
				throw new AnthropicReaderError(
					'credentials',
					'This read carried no Anthropic API key. Enter one and try again.',
				);
			}

			const requestBody = buildSeedRequestBody({ images, model: config.model, outputMode });

			let response: Response;

			try {
				response = await doFetch(ANTHROPIC_MESSAGES_URL, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'x-api-key': auth.apiKey,
						'anthropic-version': ANTHROPIC_VERSION,
						// Unverified. Issue #17 names a "direct browser access header", but no current
						// public documentation describes one: the TypeScript SDK documents a client-side
						// `dangerouslyAllowBrowser` option and names no wire header at all. It is sent
						// because an ignored header costs nothing, and nothing here may assume it is
						// either required or sufficient. No code path here is conditional on it, and a CORS
						// failure is still a plain `network` error.
						'anthropic-dangerous-direct-browser-access': 'true',
					},
					body: JSON.stringify(requestBody),
				});
			} catch (cause) {
				throw new AnthropicReaderError(
					'network',
					'The request never reached Anthropic. Check the connection and try again.',
					{ cause },
				);
			}

			const requestId = response.headers.get('request-id');

			if (!response.ok) {
				const kind = errorKindForStatus(response.status);

				// No automatic retry lives here. Issue #1 rules it out because retrying "spends the
				// user's money without consent", so a rate limit comes back as a number to show rather
				// than one to sleep on. The kind gate keeps `retryAfterSeconds` meaning what
				// `anthropic-errors.ts` promises it means, even if some other status grows the header.
				throw new AnthropicReaderError(kind, `Anthropic returned HTTP ${response.status}.`, {
					status: response.status,
					requestId,
					body: await readBodyText(response),
					retryAfterSeconds: kind === 'rate-limit' ? parseRetryAfter(response.headers) : null,
				});
			}

			const payload = await readBodyText(response);
			let body: unknown = null;

			try {
				body = JSON.parse(payload ?? '');
			} catch {
				// A 200 that is not JSON has no content block either, so it lands on `malformed` below
				// with the text attached rather than earning a failure kind of its own.
			}

			const raw = normalizeRaw(body);

			if (raw === null) {
				throw new AnthropicReaderError(
					'malformed',
					'Anthropic returned a response with no readable content block.',
					{ status: response.status, requestId, body: payload },
				);
			}

			return {
				raw,
				provider: ANTHROPIC_PROVIDER,
				// From the response when it names one. The seam calls a reader "the only party that
				// knows which model actually answered", and echoing back the requested model would
				// defeat the field in the one case it exists for: the two disagreeing.
				model: modelFromBody(body) ?? config.model,
				promptVersion: SEED_PROMPT_VERSION,
			};
		},
	};
}
