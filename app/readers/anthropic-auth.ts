import type { AuthProvider } from '../../core/brand-reader';

/**
 * `AuthProvider.scheme` is a plain `string` so a new reader can add a scheme without editing the
 * seam. The cost is that the seam narrows nothing on its own: each reader declares its own auth
 * shape with a literal scheme and reaches it through a predicate, which is what this constant and
 * `isAnthropicAuth` are here for.
 */
export const ANTHROPIC_AUTH_SCHEME = 'anthropic-api-key';

export type AnthropicAuth = {
	readonly scheme: typeof ANTHROPIC_AUTH_SCHEME;
	readonly apiKey: string;
};

/**
 * Trims because keys arrive by paste. A password manager or a terminal copy often carries a
 * trailing newline, and a header value holding one fails at the API as an unhelpful 401, far from
 * the paste that caused it.
 */
export function anthropicAuth(apiKey: string): AnthropicAuth {
	return { scheme: ANTHROPIC_AUTH_SCHEME, apiKey: apiKey.trim() };
}

/**
 * Rejects a provider that carries this scheme but no usable key, which is the case worth a
 * predicate at all. Accepting one sends `x-api-key: undefined` and earns a 401 that reads like a
 * rejected key rather than a missing one, turning a failure the user could have fixed locally
 * into a remote one they cannot.
 */
export function isAnthropicAuth(auth: AuthProvider | null | undefined): auth is AnthropicAuth {
	if (!auth || auth.scheme !== ANTHROPIC_AUTH_SCHEME || !('apiKey' in auth)) {
		return false;
	}

	// `in` narrows an unlisted property to `unknown`, which is how this reads the key without a
	// cast, the discipline the seam's doc comment asks of every reader.
	const { apiKey } = auth;
	return typeof apiKey === 'string' && apiKey.trim().length > 0;
}
