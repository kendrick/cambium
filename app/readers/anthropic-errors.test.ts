import { describe, expect, it } from 'vitest';

import {
	AnthropicReaderError,
	type AnthropicReaderErrorKind,
	errorKindForStatus,
} from './anthropic-errors';

const ALL_KINDS: AnthropicReaderErrorKind[] = [
	'credentials',
	'billing',
	'rate-limit',
	'request-too-large',
	'invalid-request',
	'server',
	'network',
	'malformed',
];

describe('errorKindForStatus', () => {
	it.each<[number, AnthropicReaderErrorKind]>([
		[400, 'invalid-request'],
		[401, 'credentials'],
		[402, 'billing'],
		[403, 'credentials'],
		[413, 'request-too-large'],
		[429, 'rate-limit'],
		[500, 'server'],
		[504, 'server'],
		[529, 'server'],
	])('maps %i to %s', (status, kind) => {
		expect(errorKindForStatus(status)).toBe(kind);
	});

	// The taxonomy in #17 covers the statuses the API documents. These are the ones it leaves out.
	it.each([404, 405, 409, 418, 422, 451])(
		'treats the unmapped 4xx %i as the request being wrong',
		(status) => {
			expect(errorKindForStatus(status)).toBe('invalid-request');
		},
	);

	it.each([501, 502, 503, 599])('treats the unmapped 5xx %i as the service failing', (status) => {
		expect(errorKindForStatus(status)).toBe('server');
	});

	it.each([0, -1, 200, 302, 999])(
		'falls back to a service failure for %i, which should never reach it',
		(status) => {
			expect(errorKindForStatus(status)).toBe('server');
		},
	);

	// This runs on the failure path, where a throw has nowhere to go.
	it('returns a kind for every status without throwing', () => {
		const statusOnly = ALL_KINDS.filter((kind) => kind !== 'network' && kind !== 'malformed');

		for (let status = 100; status < 600; status += 1) {
			expect(statusOnly).toContain(errorKindForStatus(status));
		}
	});
});

describe('AnthropicReaderError', () => {
	it('is catchable as itself and identifies itself in a log', () => {
		const error = new AnthropicReaderError('credentials', 'The API key was rejected.');

		expect(error).toBeInstanceOf(AnthropicReaderError);
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('AnthropicReaderError');
		expect(error.message).toBe('The API key was rejected.');
		expect(String(error)).toContain('AnthropicReaderError');
	});

	it('carries the kind #23 branches on', () => {
		expect(new AnthropicReaderError('rate-limit', 'Slow down.').kind).toBe('rate-limit');
	});

	it('leaves every detail null when the failure had none to give', () => {
		const error = new AnthropicReaderError('network', 'The request never reached Anthropic.');

		expect(error.status).toBeNull();
		expect(error.requestId).toBeNull();
		expect(error.body).toBeNull();
		expect(error.retryAfterSeconds).toBeNull();
	});

	it('keeps the details a diagnosis needs', () => {
		const cause = new TypeError('Failed to fetch');
		const error = new AnthropicReaderError('rate-limit', 'Rate limited.', {
			status: 429,
			requestId: 'req_123',
			body: '{"type":"error"}',
			retryAfterSeconds: 30,
			cause,
		});

		expect(error.status).toBe(429);
		expect(error.requestId).toBe('req_123');
		expect(error.body).toBe('{"type":"error"}');
		expect(error.retryAfterSeconds).toBe(30);
		expect(error.cause).toBe(cause);
	});

	// A caller that looked for a request id and found none should end up with the same error as
	// one that never looked.
	it('treats an explicitly null detail as absent', () => {
		const error = new AnthropicReaderError('server', 'Overloaded.', {
			status: 529,
			requestId: null,
			retryAfterSeconds: null,
		});

		expect(error.status).toBe(529);
		expect(error.requestId).toBeNull();
		expect(error.retryAfterSeconds).toBeNull();
	});
});
