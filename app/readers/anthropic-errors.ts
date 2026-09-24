/**
 * One kind per thing that went wrong, as a person holding a key would tell them apart. #23 maps
 * each to a message of its own and to one recovery: re-enter the key, retry, ask for a repair, or
 * nothing at all. Several kinds share a recovery, and the message tells the person which
 * situation they're in. Status codes are the wrong thing to branch on,
 * because 401 and 403 mean the same thing to a person holding a key, and 500 and 529 both mean
 * try later.
 *
 * `network` never has a status behind it: fetch rejected before a response existed. `cancelled`
 * has one only when the abort landed after the headers arrived, and then it carries that status
 * and request id; an abort before that leaves both null. They're apart because only one of them is
 * the connection's fault, and telling somebody who pressed Cancel to check their connection would
 * be wrong. The last three all arrive as a 200, and only the body tells
 * them apart. `malformed` holds no usable content block. `refusal` and `truncated` come from
 * `stop_reason`, and they need kinds of their own because their recoveries differ from a parse
 * failure's: a repair retry can't talk a safety classifier round, and a truncated seed hit
 * `max_tokens`, so asking for the same seed again hits it again.
 */
export type AnthropicReaderErrorKind =
	| 'credentials'
	| 'billing'
	| 'rate-limit'
	| 'request-too-large'
	| 'invalid-request'
	| 'server'
	| 'network'
	| 'cancelled'
	| 'malformed'
	| 'refusal'
	| 'truncated';

/** All optional: a network failure has no status, and a `request-id` header is not guaranteed. */
export type AnthropicReaderErrorDetails = {
	status?: number | null;
	requestId?: string | null;
	body?: string | null;
	retryAfterSeconds?: number | null;
	refusalCategory?: string | null;
	cause?: unknown;
};

/**
 * Throwing is the only channel open. `RawReaderResponse` on the seam has no error slot and no
 * room for one: every reader returns it, and a failure shape belongs to the reader that failed.
 *
 * Nothing here may hold an API key. `message` and `body` both reach the user and may end up in a
 * log or a bug report. `body` is the response's, always. `message` is the reader's own wording,
 * plus the API's message where the response carried one, plus, on the one local failure that has
 * no response at all, the id of the reference image that could not be encoded. An image id is a
 * record key rather than anything the user typed, so the rule that matters holds: nothing a
 * credential could have been pasted into is ever copied in here.
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
	/**
	 * Only ever set for `refusal`, from the response's `stop_details.category`. The API documents
	 * that set as open (`cyber`, `bio`, `reasoning_extraction` so far) and lets it be null, so this
	 * is a string to show or log rather than a union to switch on.
	 */
	readonly refusalCategory: string | null;

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
		this.refusalCategory = details.refusalCategory ?? null;
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
