/**
 * Eight kinds because there are eight recoveries. #23 branches on `kind` to decide what it offers
 * the user: re-enter the key, top up the account, wait, send fewer images, retry. Status codes are
 * the wrong thing to branch on, because 401 and 403 mean the same thing to a person holding a key,
 * and 500 and 529 both mean try later.
 *
 * `network` and `malformed` have no status behind them. The first is fetch rejecting before a
 * response exists, the second a 200 whose body holds no usable content block.
 */
export type AnthropicReaderErrorKind =
	| 'credentials'
	| 'billing'
	| 'rate-limit'
	| 'request-too-large'
	| 'invalid-request'
	| 'server'
	| 'network'
	| 'malformed';

/** All optional: a network failure has no status, and a `request-id` header is not guaranteed. */
export type AnthropicReaderErrorDetails = {
	status?: number | null;
	requestId?: string | null;
	body?: string | null;
	retryAfterSeconds?: number | null;
	cause?: unknown;
};

/**
 * Throwing is the only channel open. `RawReaderResponse` on the seam has no error slot and no
 * room for one: every reader returns it, and a failure shape belongs to the reader that failed.
 *
 * Nothing here may hold an API key. `message` and `body` both reach the user and may end up in a
 * log or a bug report, so a caller building one of these passes the response body, never the
 * request it sent.
 */
export class AnthropicReaderError extends Error {
	readonly kind: AnthropicReaderErrorKind;
	readonly status: number | null;
	readonly requestId: string | null;
	readonly body: string | null;
	/**
	 * Only ever set for `rate-limit`, and only ever shown to a person. Issue #1 rules out
	 * automatic retry because it "spends the user's money without consent", so this is a number
	 * to display rather than one to sleep on.
	 */
	readonly retryAfterSeconds: number | null;

	constructor(
		kind: AnthropicReaderErrorKind,
		message: string,
		details: AnthropicReaderErrorDetails = {},
	) {
		super(message, { cause: details.cause });

		// Both lines are spelled out rather than assumed, because this is the repo's first
		// `extends Error`. Without `name`, a logged error announces itself as a bare "Error", and
		// the prototype reset keeps `instanceof` working if this ever compiles below ES2022, where
		// the class already gets it for free.
		this.name = 'AnthropicReaderError';
		Object.setPrototypeOf(this, new.target.prototype);

		this.kind = kind;
		this.status = details.status ?? null;
		this.requestId = details.requestId ?? null;
		this.body = details.body ?? null;
		this.retryAfterSeconds = details.retryAfterSeconds ?? null;
	}
}

/**
 * Every status resolves to a kind and nothing here throws, because this runs on the failure path,
 * where a second failure has nowhere to go.
 *
 * The taxonomy in #17 names the statuses the API documents, which leaves the ones it does not:
 * 404, 409, 502. An unmapped 4xx is the request being wrong, so it joins `invalid-request`.
 * Everything else, 5xx and the impossible alike, is the service failing rather than the caller, so
 * it joins `server`. Both put a wrong guess on the side that tells the user to try again instead
 * of blaming their input.
 */
export function errorKindForStatus(status: number): AnthropicReaderErrorKind {
	switch (status) {
		case 400:
			return 'invalid-request';
		case 401:
		case 403:
			return 'credentials';
		case 402:
			return 'billing';
		case 413:
			return 'request-too-large';
		case 429:
			return 'rate-limit';
		case 500:
		case 504:
		case 529:
			return 'server';
		default:
			return status >= 400 && status < 500 ? 'invalid-request' : 'server';
	}
}
