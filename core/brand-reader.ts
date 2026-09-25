import type { ReferenceImage } from './brand-record';

/**
 * Opaque on purpose. Issue #1 rules out an `apiKey: string` on this seam, because the transport
 * is the part most likely to move: today the browser holds the user's key, tomorrow a server
 * might hold it and the browser hold nothing.
 *
 * `scheme` stays a plain string so a new reader can add a scheme without editing this file. The
 * price is that a bare `scheme === 'api-key'` check narrows nothing: a reader declares its own
 * auth shape with a literal `scheme` and reaches it through a type predicate, which needs no
 * cast. That keeps a transport move a change inside one reader rather than a change to the
 * interface every reader implements.
 */
export type AuthProvider = {
	readonly scheme: string;
};

/**
 * One field, deliberately. #18's codex reader authenticates through an already-logged-in CLI
 * and #33's local extractor needs no credential at all, so an absent provider is a first-class
 * case rather than a degraded one. Temperature, forced tool use, image encoding, and streaming are
 * all provider-specific and belong to the reader that has them.
 */
export type ReadOptions = {
	auth: AuthProvider | null;
};

/**
 * The payload is opaque; the envelope around it is not. Readers parse nothing, but a reader is
 * the only party that knows which model actually answered, and a version is reproducible only
 * by reference to that. `provider`, `model`, and `promptVersion` are the same three fields
 * `BrandVersionSchema` already persists.
 *
 * `raw` is a string because the user sees it. A malformed response is displayed verbatim and
 * offered one repair retry, which needs text rather than a shape that failed to parse.
 */
export type RawReaderResponse = {
	raw: string;
	provider: string;
	model: string;
	promptVersion: string;
	/**
	 * The provider's id for this request, when the provider sent one. A read can succeed and the run
	 * still fail afterwards, in parsing or in storage, and the request was billed either way, so this
	 * is what lets support find it. Absent for a reader that makes no request.
	 */
	requestId?: string;
};

/**
 * One asynchronous read, and nothing else. Seed parsing lives in `parseSeed` in the core, which
 * leaves an implementation an I/O shell with no logic left to test. That is what makes the
 * second implementation cheap, and a seam with only one implementation is still a guess.
 */
export type BrandReader = {
	read(images: ReferenceImage[], options: ReadOptions): Promise<RawReaderResponse>;
};
