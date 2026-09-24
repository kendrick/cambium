import { describe, expect, it } from 'vitest';

import type { RawReaderResponse } from '../../core/brand-reader';
import { parseSeed } from '../../core/parse-seed';
import { AnthropicReaderError, type AnthropicReaderErrorKind } from '../readers/anthropic-errors';
import { RecordStampedAheadError } from '../state/workspace-store';
import { StaleRecordWriteError } from '../storage/record-store';
import { StorageQuotaExceededError } from '../storage/storage-estimate';

import { describeFailure, type FailureDescriptor } from './describe-failure';
import type { GenerationFailure, ParseFailure, StorageFailure } from './generate';

const REQUEST_ID = 'req_011CDescribeFailure';

function readerFailure(
	kind: AnthropicReaderErrorKind,
	details: ConstructorParameters<typeof AnthropicReaderError>[2] = {},
): GenerationFailure {
	return {
		kind,
		error: new AnthropicReaderError(kind, `internal wording for ${kind}`, {
			requestId: REQUEST_ID,
			...details,
		}),
	};
}

function parseFailure(raw: string): ParseFailure {
	const response: RawReaderResponse = {
		raw,
		provider: 'anthropic',
		model: 'claude-opus-5-5',
		promptVersion: 'seed-v4',
	};
	const result = parseSeed(response);

	if (result.ok) {
		throw new Error('fixture raw parsed as a seed; it has to fail');
	}

	return { kind: result.error.kind, error: result.error };
}

const PROSE = 'The brand reads as a deep forest green on warm cream.';
const UNKNOWN_KEY = JSON.stringify({
	keyColors: null,
	neutralTemperature: null,
	surfacePolarity: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
	confidence: 0.9,
});
const MALFORMED_BODY = '{"type":"message","content":[],"stop_reason":"end_turn"}';

const RECORD_SCHEMA_RAW = '{"keyColors":[{"sourceImageId":"img-ghost"}]}';
const RECORD_SCHEMA_ISSUE = 'no reference image with id "img-ghost"';

function recordSchemaFailure(rawResponse: string): GenerationFailure {
	return {
		kind: 'record-schema',
		issues: [{ path: ['keyColors', 0, 'sourceImageId'], message: RECORD_SCHEMA_ISSUE }],
		error: new Error('stand-in for a ZodError'),
		seed: parseSeedOrThrow(),
		provenance: {
			provider: 'anthropic',
			model: 'claude-opus-5-5',
			promptVersion: 'seed-v4',
			rawResponse,
			fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		},
	};
}

function storageFailure(error: StorageFailure['error']): GenerationFailure {
	return {
		kind: error.kind,
		error,
		seed: parseSeedOrThrow(),
		provenance: {
			provider: 'anthropic',
			model: 'claude-opus-5-5',
			promptVersion: 'seed-v4',
			rawResponse: UNKNOWN_KEY,
			fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		},
	};
}

function parseSeedOrThrow() {
	const result = parseSeed({
		raw: UNKNOWN_KEY.replace(',"confidence":0.9', ''),
		provider: 'anthropic',
		model: 'claude-opus-5-5',
		promptVersion: 'seed-v4',
	});

	if (!result.ok) {
		throw new Error('the stored seed fixture has to parse');
	}

	return result.seed;
}

type Row = {
	name: string;
	failure: GenerationFailure;
	repairUsed: boolean;
	expected: FailureDescriptor;
};

/**
 * Every recovery `describeFailure` maps, asserted with its exact copy. The messages are the product
 * here: the landing page renders them verbatim, and the browser tier asserts no copy at all.
 */
const ROWS: Row[] = [
	{
		name: 'a rejected key reopens the dialog and says the key is still loaded',
		failure: readerFailure('credentials', { status: 401 }),
		repairUsed: false,
		expected: {
			kind: 'credentials',
			message:
				"Anthropic didn't accept this API key. It's still loaded, so check it or replace it.",
			recovery: 'reopen-key-dialog',
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'billing asks for credit, then a manual retry',
		failure: readerFailure('billing', { status: 402 }),
		repairUsed: false,
		expected: {
			kind: 'billing',
			message:
				'Your Anthropic account is out of credit. Add credit in the Anthropic Console, then try again.',
			recovery: 'manual-retry',
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'a rate limit with retry-after names the wait',
		failure: readerFailure('rate-limit', { status: 429, retryAfterSeconds: 40 }),
		repairUsed: false,
		expected: {
			kind: 'rate-limit',
			message: 'Anthropic is limiting requests on this key. Try again in 40 seconds.',
			recovery: 'manual-retry',
			retryAfterSeconds: 40,
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'a rate limit with a one-second retry-after reads in the singular',
		failure: readerFailure('rate-limit', { status: 429, retryAfterSeconds: 1 }),
		repairUsed: false,
		expected: {
			kind: 'rate-limit',
			message: 'Anthropic is limiting requests on this key. Try again in 1 second.',
			recovery: 'manual-retry',
			retryAfterSeconds: 1,
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'a rate limit with no retry-after says so',
		failure: readerFailure('rate-limit', { status: 429, retryAfterSeconds: null }),
		repairUsed: false,
		expected: {
			kind: 'rate-limit',
			message:
				"Anthropic is limiting requests on this key and didn't say for how long. Wait a minute, then try again.",
			recovery: 'manual-retry',
			retryAfterSeconds: null,
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'too many or too large images offers no retry',
		failure: readerFailure('request-too-large', { status: 413 }),
		repairUsed: false,
		expected: {
			kind: 'request-too-large',
			message:
				'These reference images are too large to send together. Use fewer or smaller images.',
			recovery: 'none',
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'an invalid request offers no retry',
		failure: readerFailure('invalid-request', { status: 400 }),
		repairUsed: false,
		expected: {
			kind: 'invalid-request',
			message: "Anthropic rejected the request itself, so sending it again won't help.",
			recovery: 'none',
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'a server error offers a manual retry',
		failure: readerFailure('server', { status: 529 }),
		repairUsed: false,
		expected: {
			kind: 'server',
			message: 'Anthropic had a problem on its end. Try again in a moment.',
			recovery: 'manual-retry',
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'a network failure offers a manual retry and has no request id',
		failure: readerFailure('network', { requestId: null }),
		repairUsed: false,
		expected: {
			kind: 'network',
			message: "Couldn't reach Anthropic. Check your connection, then try again.",
			recovery: 'manual-retry',
		},
	},
	{
		name: 'a cancelled run offers a manual retry and never blames the connection',
		failure: readerFailure('cancelled', { requestId: null }),
		repairUsed: false,
		expected: {
			kind: 'cancelled',
			message:
				"Generation cancelled, and nothing was saved. Anthropic may still bill for a request it had already started. Try again when you're ready.",
			recovery: 'manual-retry',
		},
	},
	{
		// Cancelled after Anthropic answered: the id is the one thing a person can take to support
		// about a request they may be billed for.
		name: 'a cancel after the response arrived shows its request id',
		failure: readerFailure('cancelled', { status: 200 }),
		repairUsed: false,
		expected: {
			kind: 'cancelled',
			message:
				"Generation cancelled, and nothing was saved. Anthropic may still bill for a request it had already started. Try again when you're ready.",
			recovery: 'manual-retry',
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'a refusal offers no retry',
		failure: readerFailure('refusal', { status: 200, refusalCategory: 'cyber' }),
		repairUsed: false,
		expected: {
			kind: 'refusal',
			message: 'Anthropic declined to read these images. Try different reference images.',
			recovery: 'none',
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'a truncation offers a manual retry, never a repair, even with a body to repair',
		failure: readerFailure('truncated', { status: 200, body: '{"keyColors":[{"oklch":[0.5' }),
		repairUsed: false,
		expected: {
			kind: 'truncated',
			message: 'Anthropic ran out of room before finishing the seed. Try again.',
			recovery: 'manual-retry',
			requestId: REQUEST_ID,
		},
	},
	{
		// No seed text came back, so a repair would hand the model its own envelope. The body is still
		// shown so the person can see what did arrive.
		name: 'a malformed answer offers a manual retry, never a repair, with the body shown',
		failure: readerFailure('malformed', { status: 200, body: MALFORMED_BODY }),
		repairUsed: false,
		expected: {
			kind: 'malformed',
			message: "Anthropic's answer had nothing Cambium could read. Try again.",
			recovery: 'manual-retry',
			raw: MALFORMED_BODY,
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'a malformed answer with no body offers a manual retry and shows nothing',
		failure: readerFailure('malformed', { status: 200, body: null }),
		repairUsed: false,
		expected: {
			kind: 'malformed',
			message: 'Anthropic sent back an empty answer. Try again.',
			recovery: 'manual-retry',
			requestId: REQUEST_ID,
		},
	},
	{
		name: 'prose instead of JSON offers a repair carrying the prose',
		failure: parseFailure(PROSE),
		repairUsed: false,
		expected: {
			kind: 'not-json',
			message:
				'Anthropic described the brand in prose instead of returning a seed. Ask it to fix the answer.',
			recovery: 'repair-retry',
			raw: PROSE,
			repair: {
				rawResponse: PROSE,
				issues: [expect.stringContaining('JSON') as unknown as string],
			},
		},
	},
	{
		name: 'prose after a repair falls back to a manual retry',
		failure: parseFailure(PROSE),
		repairUsed: true,
		expected: {
			kind: 'not-json',
			message:
				'Anthropic answered in prose again after being asked to fix it. Try again from the start.',
			recovery: 'manual-retry',
			raw: PROSE,
		},
	},
	{
		name: 'a whitespace answer falls back to a manual retry, since a repair needs text',
		failure: parseFailure('   '),
		repairUsed: false,
		expected: {
			kind: 'not-json',
			message: 'Anthropic sent back an empty seed. Try again.',
			recovery: 'manual-retry',
		},
	},
	{
		name: 'a schema rejection offers a repair naming the offending field',
		failure: parseFailure(UNKNOWN_KEY),
		repairUsed: false,
		expected: {
			kind: 'schema',
			message: "Anthropic's seed had fields Cambium can't use. Ask it to fix them.",
			recovery: 'repair-retry',
			raw: UNKNOWN_KEY,
			repair: {
				rawResponse: UNKNOWN_KEY,
				issues: [expect.stringMatching(/^confidence: /) as unknown as string],
			},
		},
	},
	{
		name: 'a schema rejection after a repair falls back to a manual retry',
		failure: parseFailure(UNKNOWN_KEY),
		repairUsed: true,
		expected: {
			kind: 'schema',
			message:
				"Anthropic's fixed seed still had fields Cambium can't use. Try again from the start.",
			recovery: 'manual-retry',
			raw: UNKNOWN_KEY,
		},
	},
	{
		name: 'a full origin offers to save again',
		failure: storageFailure(new StorageQuotaExceededError()),
		repairUsed: false,
		expected: {
			kind: 'storage-quota-exceeded',
			message:
				'The new version is ready, but this browser is out of storage. Free up space, then save again.',
			recovery: 'save-again',
		},
	},
	{
		name: 'a stale write offers to save again',
		failure: storageFailure(
			new StaleRecordWriteError('3f2504e0-4f89-41d3-9a0c-0305e82c3301', {
				storedVersions: 0,
				incomingVersions: 1,
				storedRevision: 2,
				incomingRevision: 1,
			}),
		),
		repairUsed: false,
		expected: {
			kind: 'stale-record-write',
			message:
				'The new version is ready, but this brand changed somewhere else since you opened it. Save again to add it to the latest copy.',
			recovery: 'save-again',
		},
	},
	{
		name: 'a clock behind the record offers to save again',
		failure: storageFailure(new RecordStampedAheadError('2999-01-01T00:00:00.000Z')),
		repairUsed: false,
		expected: {
			kind: 'record-stamped-ahead',
			message:
				"The new version is ready, but this brand's last version is dated later than this device's clock. Check the clock, then save again.",
			recovery: 'save-again',
		},
	},
	{
		name: 'a seed the record refuses offers a repair naming the field, from the seed down',
		failure: recordSchemaFailure(RECORD_SCHEMA_RAW),
		repairUsed: false,
		expected: {
			kind: 'record-schema',
			message:
				"Anthropic's seed didn't match this brand's images, so it wasn't saved. Ask it to fix the seed.",
			recovery: 'repair-retry',
			raw: RECORD_SCHEMA_RAW,
			repair: {
				rawResponse: RECORD_SCHEMA_RAW,
				issues: [`keyColors.0.sourceImageId: ${RECORD_SCHEMA_ISSUE}`],
			},
		},
	},
	{
		name: 'a seed the record refuses after a repair falls back to a manual retry',
		failure: recordSchemaFailure(RECORD_SCHEMA_RAW),
		repairUsed: true,
		expected: {
			kind: 'record-schema',
			message:
				"Anthropic's fixed seed still didn't match this brand's images. Try again from the start.",
			recovery: 'manual-retry',
			raw: RECORD_SCHEMA_RAW,
		},
	},
	{
		name: 'a record refusal with an empty raw response falls back to a manual retry',
		failure: recordSchemaFailure(''),
		repairUsed: false,
		expected: {
			kind: 'record-schema',
			message: 'Anthropic sent back an empty seed. Try again.',
			recovery: 'manual-retry',
		},
	},
	{
		name: 'an unavailable font table offers a manual retry',
		failure: { kind: 'font-table-unavailable', error: new Error('chunk load failed') },
		repairUsed: false,
		expected: {
			kind: 'font-table-unavailable',
			message: "Cambium couldn't load its font list, so nothing was sent to Anthropic. Try again.",
			recovery: 'manual-retry',
		},
	},
];

describe('describeFailure', () => {
	it.each(ROWS)('$name', ({ failure, repairUsed, expected }) => {
		expect(describeFailure(failure, { repairUsed })).toStrictEqual(expected);
	});

	/**
	 * `repairUsed` moves only the three repairable kinds, the ones the filter below leaves out. Every
	 * other failure has to read the same either way, or a person who once asked for a repair would
	 * see different advice for a 401.
	 */
	it.each(
		ROWS.filter((row) => !['not-json', 'schema', 'record-schema'].includes(row.failure.kind)),
	)('$name, whether or not a repair was used', ({ failure }) => {
		expect(describeFailure(failure, { repairUsed: true })).toStrictEqual(
			describeFailure(failure, { repairUsed: false }),
		);
	});

	it('gives every failure kind its own message', () => {
		const firstMessageByKind = new Map<string, string>();

		for (const { failure } of ROWS) {
			if (!firstMessageByKind.has(failure.kind)) {
				firstMessageByKind.set(
					failure.kind,
					describeFailure(failure, { repairUsed: false }).message,
				);
			}
		}

		const messages = [...firstMessageByKind.values()];

		expect(firstMessageByKind.size).toBe(18);
		expect(new Set(messages).size).toBe(messages.length);
	});
});
