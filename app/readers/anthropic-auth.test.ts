import { describe, expect, it } from 'vitest';

import type { AuthProvider } from '../../core/brand-reader';
import { ANTHROPIC_AUTH_SCHEME, anthropicAuth, isAnthropicAuth } from './anthropic-auth';

describe('anthropicAuth', () => {
	it('builds a provider the seam accepts and the predicate recognises', () => {
		const auth: AuthProvider = anthropicAuth('sk-ant-test');

		expect(auth.scheme).toBe(ANTHROPIC_AUTH_SCHEME);
		expect(isAnthropicAuth(auth)).toBe(true);
	});

	// Keys arrive by paste, and a trailing newline in a header value fails at the API rather than
	// at the paste.
	it('strips the whitespace a pasted key arrives with', () => {
		expect(anthropicAuth('  sk-ant-test\n').apiKey).toBe('sk-ant-test');
	});
});

describe('isAnthropicAuth', () => {
	it('narrows an AuthProvider to the key without a cast', () => {
		const auth: AuthProvider | null = anthropicAuth('sk-ant-test');

		// Reading `apiKey` off the `AuthProvider`-typed binding is the assertion. It only compiles
		// if the predicate narrowed.
		expect(isAnthropicAuth(auth) ? auth.apiKey : null).toBe('sk-ant-test');
	});

	it('rejects an absent provider, which #18 and #33 both pass on purpose', () => {
		expect(isAnthropicAuth(null)).toBe(false);
		expect(isAnthropicAuth(undefined)).toBe(false);
	});

	it('rejects a scheme belonging to another reader', () => {
		expect(isAnthropicAuth({ scheme: 'codex-cli' })).toBe(false);
	});

	// A provider carrying the right scheme and no usable key is the case worth guarding: it would
	// otherwise reach the wire as `x-api-key: undefined` and come back a confusing 401.
	it.each<[string, unknown]>([
		['no key at all', { scheme: ANTHROPIC_AUTH_SCHEME }],
		['a key that is not a string', { scheme: ANTHROPIC_AUTH_SCHEME, apiKey: 12345 }],
		['a null key', { scheme: ANTHROPIC_AUTH_SCHEME, apiKey: null }],
		['an empty key', { scheme: ANTHROPIC_AUTH_SCHEME, apiKey: '' }],
		['a whitespace-only key', { scheme: ANTHROPIC_AUTH_SCHEME, apiKey: '   ' }],
	])('rejects a matching scheme with %s', (_label, provider) => {
		expect(isAnthropicAuth(provider as AuthProvider)).toBe(false);
	});
});
