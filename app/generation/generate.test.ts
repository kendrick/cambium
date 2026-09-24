import { describe, expect, it, vi } from 'vitest';

import { type BrandRecord, type BrandVersion, SCHEMA_VERSION } from '../../core/brand-record';
import { createOklchScaleEngine } from '../../core/oklch-scale-engine';
import error400 from '../readers/fixtures/error-400-invalid-request.json';
import error401 from '../readers/fixtures/error-401-credentials.json';
import error402 from '../readers/fixtures/error-402-billing.json';
import error413 from '../readers/fixtures/error-413-request-too-large.json';
import error429 from '../readers/fixtures/error-429-rate-limit.json';
import error500 from '../readers/fixtures/error-500-server.json';
import error529 from '../readers/fixtures/error-529-overloaded.json';
import malformedNoContentBlock from '../readers/fixtures/malformed-no-content-block.json';
import refusalThinkingFirst from '../readers/fixtures/refusal-thinking-first.json';
import structuredProseNotJson from '../readers/fixtures/structured-prose-not-json.json';
import structuredSuccess from '../readers/fixtures/structured-success.json';
import truncatedMaxTokensThinkingFirst from '../readers/fixtures/truncated-max-tokens-thinking-first.json';
import { SEED_PROMPT_VERSION } from '../readers/seed-prompt';
import { createInMemoryRecordStore } from '../storage/in-memory-record-store';
import type { RecordStore } from '../storage/record-store';
import { StorageQuotaExceededError } from '../storage/storage-estimate';

import { describeFailure, type FailureRecovery } from './describe-failure';
import {
	createGenerationReader,
	type GenerationFailureKind,
	generate,
	saveGeneratedVersion,
} from './generate';
import { GENERATION_MODEL } from './model';

type Fixture = { status: number; headers: Record<string, string>; body: unknown };

/** Distinctive so the leak check can't match anything a fixture already says. */
const API_KEY = 'sk-ant-GENERATE-LEAK-SENTINEL-5c1d';
const NOW = '2026-09-24T12:00:00.000Z';
const FONT_TABLE_REF = { source: 'generate-test-table', version: 'pinned-1' };
const RECORD_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const engine = createOklchScaleEngine();

/**
 * The recorded success names `claude-opus-5`, the model it was captured from. The reader records
 * the model the response names, so a replay of it would say nothing about what this module asks
 * for. Echoing the requested model is what the API does, and the request body is asserted
 * separately below.
 */
const SUCCESS_ON_GENERATION_MODEL: Fixture = {
	...structuredSuccess,
	body: { ...structuredSuccess.body, model: GENERATION_MODEL },
};

const SUCCESS_TEXT = (structuredSuccess.body.content[0] as { text: string }).text;

const PROSE_TEXT = (
	structuredProseNotJson.body.content.find((block) => block.type === 'text') as { text: string }
).text;

/** A seed with a key the schema doesn't know, in a normal 200 envelope. */
const SCHEMA_REJECTED: Fixture = {
	...SUCCESS_ON_GENERATION_MODEL,
	body: {
		...structuredSuccess.body,
		model: GENERATION_MODEL,
		content: [{ type: 'text', text: SUCCESS_TEXT.replace(/}$/, ',"confidence":0.9}') }],
	},
};

/**
 * A seed `parseSeed` accepts and the record refuses: it cites `img-ghost`, which no record here
 * holds, so the rejection comes from `BrandRecordSchema` inside `put`.
 */
const GHOST_IMAGE_TEXT = SUCCESS_TEXT.replaceAll('img-packaging', 'img-ghost');
const CITES_MISSING_IMAGE: Fixture = {
	...structuredSuccess,
	body: {
		...structuredSuccess.body,
		model: GENERATION_MODEL,
		content: [{ type: 'text', text: GHOST_IMAGE_TEXT }],
	},
};

const RATE_LIMIT_NO_RETRY_AFTER: Fixture = {
	...error429,
	headers: { 'request-id': error429.headers['request-id'], 'content-type': 'application/json' },
};

function responseFrom(fixture: Fixture): Response {
	return new Response(JSON.stringify(fixture.body), {
		status: fixture.status,
		headers: fixture.headers,
	});
}

/** A fresh `Response` per call, so a second read would fail on its own merits, not a used body. */
function replay(fixture: Fixture) {
	return vi.fn<typeof globalThis.fetch>(async () => responseFrom(fixture));
}

function networkDown() {
	return vi.fn<typeof globalThis.fetch>(async () => {
		throw new TypeError('Failed to fetch');
	});
}

/** Settles only by rejecting on abort, the way a browser's `fetch` does for a stalled request. */
function hangsUntilAborted() {
	return vi.fn<typeof globalThis.fetch>(
		(_url, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
			}),
	);
}

function version(overrides: Partial<BrandVersion> = {}): BrandVersion {
	return {
		createdAt: '2026-01-01T00:00:00.000Z',
		ordinal: 1,
		seed: null,
		tokenSet: null,
		provider: 'anthropic',
		model: 'claude-opus-5',
		promptVersion: 'seed-v3',
		rawResponse: '{"earlier":true}',
		scaleEngine: engine.id,
		fontTable: { source: 'in-repo', version: 'cambium-curated-1' },
		interpretation: 'balanced',
		...overrides,
	};
}

/**
 * The success fixture's seed cites `img-logo` and `img-packaging`, and `BrandRecordSchema` refuses a
 * seed citing an image the record doesn't hold, so both have to be here.
 */
function record(versions: BrandVersion[]): BrandRecord {
	return {
		id: RECORD_ID,
		schemaVersion: SCHEMA_VERSION,
		revision: 1,
		images: [
			{ id: 'img-logo', downscaled: 'data:image/png;base64,AA==', originalHash: 'sha256-logo' },
			{
				id: 'img-packaging',
				downscaled: 'data:image/png;base64,AQ==',
				originalHash: 'sha256-pack',
			},
		],
		versions,
	};
}

/**
 * Two starting points, because a wrongly written version reads differently against each. A record
 * with no versions would gain its first, and one with a version would gain a second while keeping
 * the first, so a failure that wrote anything can't pass against both.
 */
const STARTING_RECORDS = [
	{ label: 'no versions', build: () => record([]) },
	{ label: 'one version', build: () => record([version()]) },
];

type Stored = { store: RecordStore; stored: BrandRecord };

async function storeWith(start: BrandRecord, store: RecordStore = createInMemoryRecordStore()) {
	return { store, stored: await store.put(start) } satisfies Stored;
}

function run(
	{ store, stored }: Stored,
	fetch: typeof globalThis.fetch,
	extra: { key?: string; repair?: { rawResponse: string; issues: string[] } } = {},
) {
	return generate({
		record: stored,
		key: extra.key ?? API_KEY,
		reader: createGenerationReader({ fetch }),
		recordStore: store,
		engine,
		repair: extra.repair,
		now: () => NOW,
		resolveFontTableRef: async () => FONT_TABLE_REF,
	});
}

/** Refuses every write after the first, which is the one that seeds the record. */
function fullAfterFirstWrite(): RecordStore {
	const inner = createInMemoryRecordStore();
	let writes = 0;

	return {
		list: () => inner.list(),
		get: (id) => inner.get(id),
		delete: (id) => inner.delete(id),
		async put(value) {
			writes += 1;
			if (writes > 1) {
				throw new StorageQuotaExceededError();
			}
			return inner.put(value);
		},
	};
}

/** Moves storage a revision past the copy `generate` will be handed. */
async function overtaken(start: BrandRecord): Promise<Stored> {
	const setup = await storeWith(start);
	await setup.store.put({
		...setup.stored,
		images: [
			...setup.stored.images,
			{ id: 'img-extra', downscaled: 'data:image/png;base64,Ag==', originalHash: 'sha256-x' },
		],
	});
	return setup;
}

type FailureCase = {
	kind: GenerationFailureKind;
	name: string;
	fetch: () => ReturnType<typeof replay>;
	recovery: FailureRecovery;
	retryAfterSeconds?: number | null;
};

/** Every reader and parse failure, each through the real reader and a replayed response. */
const READ_FAILURES: FailureCase[] = [
	{
		kind: 'credentials',
		name: '401',
		fetch: () => replay(error401),
		recovery: 'reopen-key-dialog',
	},
	{ kind: 'billing', name: '402', fetch: () => replay(error402), recovery: 'manual-retry' },
	{
		kind: 'rate-limit',
		name: '429 with retry-after',
		fetch: () => replay(error429),
		recovery: 'manual-retry',
		retryAfterSeconds: 40,
	},
	{
		kind: 'rate-limit',
		name: '429 without retry-after',
		fetch: () => replay(RATE_LIMIT_NO_RETRY_AFTER),
		recovery: 'manual-retry',
		retryAfterSeconds: null,
	},
	{ kind: 'request-too-large', name: '413', fetch: () => replay(error413), recovery: 'none' },
	{ kind: 'invalid-request', name: '400', fetch: () => replay(error400), recovery: 'none' },
	{ kind: 'server', name: '500', fetch: () => replay(error500), recovery: 'manual-retry' },
	{ kind: 'server', name: '529', fetch: () => replay(error529), recovery: 'manual-retry' },
	{ kind: 'network', name: 'fetch rejects', fetch: networkDown, recovery: 'manual-retry' },
	{
		kind: 'malformed',
		name: 'no content block',
		fetch: () => replay(malformedNoContentBlock),
		recovery: 'manual-retry',
	},
	{
		kind: 'refusal',
		name: 'stop_reason refusal',
		fetch: () => replay(refusalThinkingFirst),
		recovery: 'none',
	},
	{
		kind: 'truncated',
		name: 'stop_reason max_tokens',
		fetch: () => replay(truncatedMaxTokensThinkingFirst),
		recovery: 'manual-retry',
	},
	{
		kind: 'not-json',
		name: 'prose',
		fetch: () => replay(structuredProseNotJson),
		recovery: 'repair-retry',
	},
	{
		kind: 'schema',
		name: 'unknown key',
		fetch: () => replay(SCHEMA_REJECTED),
		recovery: 'repair-retry',
	},
];

const READ_FAILURE_RUNS = STARTING_RECORDS.flatMap((start) =>
	READ_FAILURES.map((failure) => ({ ...failure, start })),
);

describe('generate', () => {
	describe('on success', () => {
		it.each(STARTING_RECORDS)(
			'appends exactly one version on claude-opus-5-5 to a record with $label',
			async ({ build }) => {
				const setup = await storeWith(build());
				const fetch = replay(SUCCESS_ON_GENERATION_MODEL);

				const result = await run(setup, fetch);
				const after = await setup.store.get(RECORD_ID);

				expect(result.ok).toBe(true);
				expect(after?.versions).toHaveLength(setup.stored.versions.length + 1);
				expect(after?.versions.slice(0, -1)).toStrictEqual(setup.stored.versions);
				expect(after?.versions.at(-1)).toMatchObject({
					ordinal: setup.stored.versions.length + 1,
					createdAt: NOW,
					provider: 'anthropic',
					model: 'claude-opus-5-5',
					promptVersion: SEED_PROMPT_VERSION,
					rawResponse: SUCCESS_TEXT,
					fontTable: FONT_TABLE_REF,
					scaleEngine: engine.id,
				});
				expect(after?.versions.at(-1)?.seed?.keyColors?.[0]?.sourceImageId).toBe('img-logo');
				expect(result.ok && result.record).toStrictEqual(after);
			},
		);

		// Asserted on the request body, because the stored model is whatever the response names. Only
		// the request says which model this module asked for and priced.
		it('asks Anthropic for claude-opus-5-5, once', async () => {
			const fetch = replay(SUCCESS_ON_GENERATION_MODEL);

			await run(await storeWith(record([])), fetch);

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).model).toBe('claude-opus-5-5');
		});

		it('sends a repair only when asked, in the same single request', async () => {
			const fetch = replay(SUCCESS_ON_GENERATION_MODEL);
			const repair = { rawResponse: 'Some prose.', issues: ['Unexpected token'] };

			const result = await run(await storeWith(record([])), fetch, { repair });
			const messages = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).messages;

			expect(result.ok).toBe(true);
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(messages).toHaveLength(3);
			expect(messages[1].content[0].text).toBe('Some prose.');
		});
	});

	describe.each(READ_FAILURE_RUNS)(
		'on $kind ($name), against a record with $start.label',
		({ kind, fetch: makeFetch, recovery, retryAfterSeconds, start }) => {
			it('returns the failure and leaves the stored record deep-equal', async () => {
				const setup = await storeWith(start.build());
				const before = await setup.store.get(RECORD_ID);
				const passedIn = structuredClone(setup.stored);
				const fetch = makeFetch();

				const result = await run(setup, fetch);

				expect(result.ok).toBe(false);
				expect(!result.ok && result.failure.kind).toBe(kind);
				expect(await setup.store.get(RECORD_ID)).toStrictEqual(before);
				expect(setup.stored).toStrictEqual(passedIn);
				expect(fetch).toHaveBeenCalledTimes(1);
			});

			it('describes to the recovery the plan maps, carrying what the response said', async () => {
				const result = await run(await storeWith(start.build()), makeFetch());

				if (result.ok) {
					throw new Error('expected a failure');
				}

				const descriptor = describeFailure(result.failure, { repairUsed: false });

				expect(descriptor.recovery).toBe(recovery);
				// Undefined on both sides for every kind but a rate limit.
				expect(descriptor.retryAfterSeconds).toBe(retryAfterSeconds);
				// The key must never reach anything the landing page might render, log or report.
				expect(JSON.stringify(result.failure)).not.toContain(API_KEY);
				expect(JSON.stringify(descriptor)).not.toContain(API_KEY);
			});
		},
	);

	it('fails a blank key as credentials without spending a request', async () => {
		const setup = await storeWith(record([]));
		const before = await setup.store.get(RECORD_ID);
		const fetch = replay(SUCCESS_ON_GENERATION_MODEL);

		const result = await run(setup, fetch, { key: '   ' });

		expect(!result.ok && result.failure.kind).toBe('credentials');
		expect(fetch).not.toHaveBeenCalled();
		expect(await setup.store.get(RECORD_ID)).toStrictEqual(before);
	});

	it('repairs a prose answer from the prose itself when asked, in one request', async () => {
		const first = await run(await storeWith(record([])), replay(structuredProseNotJson));

		if (first.ok) {
			throw new Error('expected a failure');
		}

		const { repair } = describeFailure(first.failure, { repairUsed: false });
		const fetch = replay(SUCCESS_ON_GENERATION_MODEL);
		const setup = await storeWith(record([]));

		const second = await run(setup, fetch, { repair });
		const messages = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).messages;

		// The model's own words go back, never the response envelope around them.
		expect(repair?.rawResponse).toBe(PROSE_TEXT);
		expect(messages[1].content[0].text).toBe(PROSE_TEXT);
		expect(second.ok).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect((await setup.store.get(RECORD_ID))?.versions).toHaveLength(1);
	});

	// A malformed answer has no seed text to hand back, so a repair would replay the envelope.
	it('offers no repair for a malformed answer, only a retry with the body still shown', async () => {
		const result = await run(await storeWith(record([])), replay(malformedNoContentBlock));

		if (result.ok) {
			throw new Error('expected a failure');
		}

		const descriptor = describeFailure(result.failure, { repairUsed: false });

		expect(descriptor.recovery).toBe('manual-retry');
		expect(descriptor.repair).toBeUndefined();
		expect(descriptor.raw).toBe(JSON.stringify(malformedNoContentBlock.body));
	});

	describe('when the person cancels', () => {
		it.each(STARTING_RECORDS)(
			'fails as cancelled mid-request and leaves a record with $label deep-equal',
			async ({ build }) => {
				const setup = await storeWith(build());
				const before = await setup.store.get(RECORD_ID);
				const controller = new AbortController();
				const fetch = hangsUntilAborted();

				const pending = generate({
					record: setup.stored,
					key: API_KEY,
					reader: createGenerationReader({ fetch }),
					recordStore: setup.store,
					engine,
					signal: controller.signal,
					now: () => NOW,
					resolveFontTableRef: async () => FONT_TABLE_REF,
				});
				// Lets the font table resolve and the request go out before the abort.
				await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
				controller.abort();
				const result = await pending;

				if (result.ok) {
					throw new Error('expected a failure');
				}

				expect(result.failure.kind).toBe('cancelled');
				expect(await setup.store.get(RECORD_ID)).toStrictEqual(before);
				expect(describeFailure(result.failure, { repairUsed: false }).recovery).toBe(
					'manual-retry',
				);
			},
		);

		// A reader that ignores the signal still can't get a version written once the person said stop.
		it.each(STARTING_RECORDS)(
			'commits nothing to a record with $label when a good answer arrives after the abort',
			async ({ build }) => {
				const setup = await storeWith(build());
				const before = await setup.store.get(RECORD_ID);
				const controller = new AbortController();

				const result = await generate({
					record: setup.stored,
					key: API_KEY,
					reader: {
						async read() {
							controller.abort();
							return {
								raw: SUCCESS_TEXT,
								provider: 'anthropic',
								model: GENERATION_MODEL,
								promptVersion: SEED_PROMPT_VERSION,
							};
						},
					},
					recordStore: setup.store,
					engine,
					signal: controller.signal,
					now: () => NOW,
					resolveFontTableRef: async () => FONT_TABLE_REF,
				});

				expect(!result.ok && result.failure.kind).toBe('cancelled');
				expect(await setup.store.get(RECORD_ID)).toStrictEqual(before);
			},
		);
	});

	it.each(STARTING_RECORDS)(
		'fails a seed the record refuses as record-schema, leaving a record with $label deep-equal',
		async ({ build }) => {
			const setup = await storeWith(build());
			const before = await setup.store.get(RECORD_ID);
			const fetch = replay(CITES_MISSING_IMAGE);

			const result = await run(setup, fetch);

			if (result.ok) {
				throw new Error('expected a failure');
			}

			const descriptor = describeFailure(result.failure, { repairUsed: false });

			expect(result.failure.kind).toBe('record-schema');
			expect(await setup.store.get(RECORD_ID)).toStrictEqual(before);
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(result.failure).toMatchObject({
				provenance: { model: 'claude-opus-5-5', rawResponse: GHOST_IMAGE_TEXT },
			});
			expect(descriptor.recovery).toBe('repair-retry');
			expect(descriptor.raw).toBe(GHOST_IMAGE_TEXT);
			// Seed-relative, so the model reads the path against the JSON it wrote.
			expect(descriptor.repair?.issues).toContain(
				'keyColors.1.sourceImageId: no reference image with id "img-ghost"',
			);
		},
	);

	it.each(STARTING_RECORDS)(
		'fails an unavailable font table before any request, leaving a record with $label deep-equal',
		async ({ build }) => {
			const setup = await storeWith(build());
			const before = await setup.store.get(RECORD_ID);
			const fetch = replay(SUCCESS_ON_GENERATION_MODEL);

			const result = await generate({
				record: setup.stored,
				key: API_KEY,
				reader: createGenerationReader({ fetch }),
				recordStore: setup.store,
				engine,
				now: () => NOW,
				resolveFontTableRef: async () => {
					throw new Error('Loading chunk failed');
				},
			});

			expect(!result.ok && result.failure.kind).toBe('font-table-unavailable');
			expect(fetch).not.toHaveBeenCalled();
			expect(await setup.store.get(RECORD_ID)).toStrictEqual(before);
		},
	);

	describe('on a storage failure after a good read', () => {
		const STORAGE_RUNS = [
			...STARTING_RECORDS.map(({ label, build }) => ({
				kind: 'storage-quota-exceeded' as const,
				label,
				setup: () => storeWith(build(), fullAfterFirstWrite()),
			})),
			...STARTING_RECORDS.map(({ label, build }) => ({
				kind: 'stale-record-write' as const,
				label,
				setup: () => overtaken(build()),
			})),
			{
				kind: 'record-stamped-ahead' as const,
				label: 'one version stamped ahead of the clock',
				setup: () => storeWith(record([version({ createdAt: '2999-01-01T00:00:00.000Z' })])),
			},
		];

		it.each(STORAGE_RUNS)(
			'$kind against a record with $label leaves it deep-equal and offers to save again',
			async ({ kind, setup: makeSetup }) => {
				const setup = await makeSetup();
				const before = await setup.store.get(RECORD_ID);
				const fetch = replay(SUCCESS_ON_GENERATION_MODEL);

				const result = await run(setup, fetch);

				if (result.ok) {
					throw new Error('expected a failure');
				}

				expect(result.failure.kind).toBe(kind);
				expect(await setup.store.get(RECORD_ID)).toStrictEqual(before);
				expect(fetch).toHaveBeenCalledTimes(1);
				expect(describeFailure(result.failure, { repairUsed: false }).recovery).toBe('save-again');
				expect(result.failure).toMatchObject({
					provenance: {
						model: 'claude-opus-5-5',
						rawResponse: SUCCESS_TEXT,
						fontTable: FONT_TABLE_REF,
					},
				});
			},
		);

		it('saves again from the kept seed without a second request', async () => {
			const setup = await overtaken(record([]));
			const fetch = replay(SUCCESS_ON_GENERATION_MODEL);
			const result = await run(setup, fetch);

			if (result.ok || !('seed' in result.failure)) {
				throw new Error('expected a storage failure');
			}

			const latest = await setup.store.get(RECORD_ID);
			const saved = await saveGeneratedVersion({
				record: latest!,
				seed: result.failure.seed,
				provenance: result.failure.provenance,
				recordStore: setup.store,
				engine,
				now: () => NOW,
			});

			expect(saved.ok).toBe(true);
			expect(fetch).toHaveBeenCalledTimes(1);
			expect((await setup.store.get(RECORD_ID))?.versions).toMatchObject([
				{ ordinal: 1, model: 'claude-opus-5-5', rawResponse: SUCCESS_TEXT },
			]);
		});
	});
});
