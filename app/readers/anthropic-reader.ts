import type { ReferenceImage } from '../../core/brand-record';
import type { ReadOptions, RawReaderResponse } from '../../core/brand-reader';

import { isAnthropicAuth } from './anthropic-auth';
import { AnthropicReaderError, errorKindForStatus } from './anthropic-errors';
import {
	type AnthropicOutputMode,
	buildSeedRequestBody,
	type SeedRepair,
} from './anthropic-request';
import { SEED_PROMPT_VERSION, SEED_TOOL_NAME } from './seed-prompt';

export type { SeedRepair } from './anthropic-request';

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

/**
 * The seam's options plus one this reader alone understands. `core/brand-reader.ts` keeps
 * `ReadOptions` to the credential on purpose, so the repair rides here instead: the field is
 * optional, which leaves this reader assignable to `BrandReader` and every caller of the seam
 * unchanged. Only a caller holding this reader by its own type can ask for a repair.
 *
 * Nothing sets `repair` automatically. It resends the images and costs a second request, so it
 * waits for a person to ask, as issue #1 requires of anything that spends their money.
 */
export type AnthropicReadOptions = ReadOptions & {
	repair?: SeedRepair;
	/**
	 * Set by a person's Cancel. Nothing here aborts on a timer, because a slow read may still be a
	 * paid one on its way back.
	 */
	signal?: AbortSignal;
};

export type AnthropicBrandReader = {
	read(images: ReferenceImage[], options: AnthropicReadOptions): Promise<RawReaderResponse>;
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
function rawSeedFromBody(body: unknown): string | null {
	const blocks = contentBlocks(body);
	const toolUses = blocks.filter((block) => block.type === 'tool_use' && block.input !== undefined);
	const seedToolUse = toolUses.find((block) => block.name === SEED_TOOL_NAME) ?? toolUses[0];

	if (seedToolUse) {
		return JSON.stringify(seedToolUse.input);
	}

	const textBlock = blocks.find((block) => block.type === 'text' && typeof block.text === 'string');

	return typeof textBlock?.text === 'string' ? textBlock.text : null;
}

function stopReasonFromBody(body: unknown): string | null {
	const stopReason = isRecord(body) ? body.stop_reason : null;
	return typeof stopReason === 'string' ? stopReason : null;
}

/**
 * The API documents `stop_details` as present only on a refusal and its `category` as an open set
 * that may be null, so anything other than a non-empty string resolves to null rather than to a
 * guess.
 */
function refusalCategoryFromBody(body: unknown): string | null {
	const details = isRecord(body) ? body.stop_details : null;
	const category = isRecord(details) ? details.category : null;
	return typeof category === 'string' && category.length > 0 ? category : null;
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
	const value = headers.get('retry-after')?.trim();

	// The empty check is not redundant: `Number('')` is 0, so a header present but blank would
	// otherwise reach the user as "retry in 0 seconds", which reads like permission to retry now.
	if (!value) {
		return null;
	}

	const seconds = Number(value);

	return Number.isFinite(seconds) ? seconds : null;
}

/**
 * The API's own message says what was actually wrong with a request, and #17's taxonomy asks
 * `invalid-request` to carry it. Leaving it inside the JSON body string would make #23 parse the
 * body to say anything useful, so it is lifted here instead.
 *
 * Response text only, never anything from the request. That is what keeps the key out of a message
 * bound for a log or a bug report.
 */
function errorMessage(status: number, body: string | null): string {
	const fallback = `Anthropic returned HTTP ${status}.`;

	if (body === null) {
		return fallback;
	}

	try {
		const parsed: unknown = JSON.parse(body);
		const message = isRecord(parsed) && isRecord(parsed.error) ? parsed.error.message : null;

		return typeof message === 'string' && message.length > 0 ? `${fallback} ${message}` : fallback;
	} catch {
		return fallback;
	}
}

/**
 * The body is diagnostic on the failure path and the payload on the success path, and neither has
 * anywhere to put a second failure, so a body that will not read costs the detail rather than the
 * error. An unreadable success body falls through to `malformed` below, which is what it is.
 */
async function readBodyText(response: Response): Promise<string | null> {
	try {
		return await response.text();
	} catch {
		return null;
	}
}

/**
 * An abort can land while the body is still streaming, and `readBodyText` swallows that rejection
 * as a missing body. Checking the signal afterward is what stops a cancelled read from arriving as
 * `malformed`, or as a success built from a body read before the abort.
 */
function throwIfCancelled(signal: AbortSignal | undefined, cause?: unknown): void {
	if (signal?.aborted) {
		throw new AnthropicReaderError('cancelled', 'The read was cancelled before it finished.', {
			cause: cause ?? signal.reason,
		});
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
export function createAnthropicBrandReader(config: AnthropicReaderConfig): AnthropicBrandReader {
	const outputMode = config.outputMode ?? 'structured';
	// Bound, not merely referenced: a browser's `fetch` throws "Illegal invocation" when it is
	// called detached from `globalThis`.
	const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);

	return {
		async read(images, options) {
			const { auth, repair, signal } = options;

			// A signal already aborted costs no request, the same as a missing key doesn't.
			throwIfCancelled(signal);

			// Before the round trip, deliberately. A missing key is a failure the user can fix where
			// they are standing, and spending a request to learn it returns a 401 that reads like a
			// rejected key rather than an absent one.
			if (!isAnthropicAuth(auth)) {
				throw new AnthropicReaderError(
					'credentials',
					'This read carried no Anthropic API key. Enter one and try again.',
				);
			}

			let requestBody: Record<string, unknown>;

			try {
				requestBody = buildSeedRequestBody({ images, model: config.model, outputMode, repair });
			} catch (cause) {
				// `buildSeedRequestBody` throws a plain `Error` on purpose: a stored image that is not
				// a base64 data URL is a caller bug, not an API failure, and the pure module has no
				// business knowing this class. But #23 branches on `kind`, and a bare `Error` reaching
				// it falls through to whatever it does with the unexpected. Wrapping here gives the
				// failure a kind without teaching the request builder about the taxonomy.
				throw new AnthropicReaderError(
					'invalid-request',
					cause instanceof Error ? cause.message : String(cause),
					{ cause },
				);
			}

			let response: Response;

			try {
				response = await doFetch(ANTHROPIC_MESSAGES_URL, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'x-api-key': auth.apiKey,
						'anthropic-version': ANTHROPIC_VERSION,
						// Unverified. Issue #17 names a "direct browser access header". Neither the
						// TypeScript SDK page nor the Messages API reference names one: the SDK documents a
						// client-side `dangerouslyAllowBrowser` option instead. This spelling is what the
						// SDK has historically sent. It goes out because an ignored header costs nothing,
						// and nothing here treats it as either required or sufficient. No code path is
						// conditional on it, and a CORS failure is still a plain `network` error.
						'anthropic-dangerous-direct-browser-access': 'true',
					},
					body: JSON.stringify(requestBody),
					signal,
				});
			} catch (cause) {
				throwIfCancelled(signal, cause);

				throw new AnthropicReaderError(
					'network',
					'The request never reached Anthropic. Check the connection and try again.',
					{ cause },
				);
			}

			const requestId = response.headers.get('request-id');

			if (!response.ok) {
				const kind = errorKindForStatus(response.status);
				const body = await readBodyText(response);

				throwIfCancelled(signal);

				// No automatic retry lives here. Issue #1 rules it out because retrying "spends the
				// user's money without consent", so a rate limit comes back as a number to show rather
				// than one to sleep on. The kind gate keeps `retryAfterSeconds` meaning what
				// `anthropic-errors.ts` promises it means, even if some other status grows the header.
				throw new AnthropicReaderError(kind, errorMessage(response.status, body), {
					status: response.status,
					requestId,
					body,
					retryAfterSeconds: kind === 'rate-limit' ? parseRetryAfter(response.headers) : null,
				});
			}

			const payload = await readBodyText(response);

			throwIfCancelled(signal);
			let body: unknown = null;

			try {
				body = JSON.parse(payload ?? '');
			} catch {
				// A 200 that is not JSON has no content block either, so it lands on `malformed` below
				// with the text attached rather than earning a failure kind of its own.
			}

			// Both stop reasons are checked before the normalizer, because both can arrive holding a
			// perfectly readable block. A refusal may carry a sentence of text, and a truncated seed is
			// a text block of JSON cut off mid-value. The normalizer would pass either on as a seed, and
			// the core would call it `not-json`, which #23 answers with a repair retry that cannot fix
			// a refusal and would only run out of tokens again on a truncation.
			const stopReason = stopReasonFromBody(body);

			if (stopReason === 'refusal') {
				throw new AnthropicReaderError('refusal', 'Anthropic declined to read these images.', {
					status: response.status,
					requestId,
					body: payload,
					refusalCategory: refusalCategoryFromBody(body),
				});
			}

			if (stopReason === 'max_tokens') {
				throw new AnthropicReaderError(
					'truncated',
					'Anthropic stopped at the output limit before the seed was complete.',
					{ status: response.status, requestId, body: payload },
				);
			}

			const raw = rawSeedFromBody(body);

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
