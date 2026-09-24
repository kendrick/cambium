import type { BrandRecord, FontTableRef } from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';
import {
	parseSeed,
	type SeedParseError,
	type SeedParseErrorKind,
	type SeedParseIssue,
} from '../../core/parse-seed';
import type { ScaleEngine } from '../../core/scale-engine';
import { isSchemaRejection } from '../../components/is-schema-rejection';
import { resolveFontTable } from '../fonts/font-table-provider';
import { anthropicAuth } from '../readers/anthropic-auth';
import { AnthropicReaderError, type AnthropicReaderErrorKind } from '../readers/anthropic-errors';
import {
	type AnthropicBrandReader,
	createAnthropicBrandReader,
	type SeedRepair,
} from '../readers/anthropic-reader';
import {
	type CommitProvenance,
	createWorkspaceStore,
	RecordStampedAheadError,
} from '../state/workspace-store';
import { type RecordStore, StaleRecordWriteError } from '../storage/record-store';
import { StorageQuotaExceededError } from '../storage/storage-estimate';

import { GENERATION_MODEL, GENERATION_OUTPUT_MODE } from './model';

export type ReaderFailure = {
	kind: AnthropicReaderErrorKind;
	error: AnthropicReaderError;
};

export type ParseFailure = {
	kind: SeedParseErrorKind;
	error: SeedParseError;
};

export type StorageFailureKind =
	| 'storage-quota-exceeded'
	| 'stale-record-write'
	| 'record-stamped-ahead';

/**
 * A seed from a read that already succeeded and was paid for, with the provenance its version
 * would carry. `saveGeneratedVersion` takes the pair back, which is how the landing page saves
 * again without spending a second request. Neither half holds the key.
 */
export type PaidSeed = {
	seed: BrandSeed;
	provenance: CommitProvenance;
};

/** The model call had already succeeded when any of these happened, so the paid seed rides along. */
export type StorageFailure = PaidSeed & {
	kind: StorageFailureKind;
	error: StorageQuotaExceededError | StaleRecordWriteError | RecordStampedAheadError;
};

/**
 * `put` refused the record the seed would produce, most often because the seed cites an image id
 * the record doesn't hold. `parseSeed` can't catch that, since it never sees the record. The read
 * was still paid for, so the paid seed rides along like a storage failure's does.
 */
export type RecordSchemaFailure = PaidSeed & {
	kind: 'record-schema';
	/** Paths start at the seed, not the record, so the model reads them against what it wrote. */
	issues: SeedParseIssue[];
	error: unknown;
};

/** Nothing was sent: the font table resolves before the read, so this costs no request. */
export type FontTableFailure = {
	kind: 'font-table-unavailable';
	error: unknown;
};

export type GenerationFailure =
	| ReaderFailure
	| ParseFailure
	| StorageFailure
	| RecordSchemaFailure
	| FontTableFailure;
export type GenerationFailureKind = GenerationFailure['kind'];

export type GenerateResult =
	| { ok: true; record: BrandRecord }
	| { ok: false; failure: GenerationFailure };

export type SaveGeneratedVersionInput = PaidSeed & {
	record: BrandRecord;
	recordStore: RecordStore;
	engine: ScaleEngine;
	now?: () => string;
};

export type GenerateInput = Omit<SaveGeneratedVersionInput, keyof PaidSeed> & {
	/** Passed in, not read from `session-key.ts`, so this module never touches `sessionStorage`. */
	key: string;
	reader: AnthropicBrandReader;
	/** Only ever set because a person asked for a repair. Nothing here builds one on its own. */
	repair?: SeedRepair;
	/** Set by the person's Cancel and passed to the reader. Nothing in this module sets a timeout. */
	signal?: AbortSignal;
	/**
	 * Called after the last abort check, just before the commit starts. From then on an abort changes
	 * nothing, so the caller withdraws Cancel here rather than leave a button that swallows the click.
	 */
	onCommitting?: () => void;
	/**
	 * Injectable because the default fetches the font taxonomy from a CDN, and a test that let it
	 * would depend on the network to exercise a failure path that never gets that far.
	 */
	resolveFontTableRef?: () => Promise<FontTableRef>;
};

async function defaultFontTableRef(): Promise<FontTableRef> {
	return (await resolveFontTable()).ref;
}

/**
 * Binds the reader to `GENERATION_MODEL` and `GENERATION_OUTPUT_MODE`, the pair the cost estimate
 * prices and measures, so the estimate and the call describe the same request.
 */
export function createGenerationReader(
	options: { fetch?: typeof globalThis.fetch } = {},
): AnthropicBrandReader {
	return createAnthropicBrandReader({
		model: GENERATION_MODEL,
		outputMode: GENERATION_OUTPUT_MODE,
		fetch: options.fetch,
	});
}

function asStorageError(error: unknown): StorageFailure['error'] | null {
	return error instanceof StorageQuotaExceededError ||
		error instanceof StaleRecordWriteError ||
		error instanceof RecordStampedAheadError
		? error
		: null;
}

type ZodLikeIssue = { path: PropertyKey[]; message: string };

/**
 * A version's seed sits at `versions.<n>.seed` in the record. Stripping that prefix lets the repair
 * turn say `keyColors.0.sourceImageId`, which names a field the model wrote, rather than a record
 * path it never saw.
 */
function seedRelativeIssues(error: unknown): SeedParseIssue[] {
	const issues = (error as { issues: ZodLikeIssue[] }).issues;

	return issues.map(({ path, message }) => ({
		path: path[0] === 'versions' && path[2] === 'seed' ? path.slice(3) : path,
		message,
	}));
}

/**
 * Commits a parsed seed as the record's next version. A fresh workspace store per call, because the
 * landing page holds no workspace, and one kept between calls would remember a record this call's
 * caller may have just reloaded.
 *
 * Returns rather than throws for the storage failures a person can act on, and for a record-schema
 * rejection, which a repair can fix. Anything else still throws, because it has no recovery to
 * offer.
 *
 * The schema check uses `isSchemaRejection`, the test the stored-record read path already uses, so
 * both sides of storage agree on what counts as a schema rejection.
 */
export async function saveGeneratedVersion({
	record,
	seed,
	provenance,
	recordStore,
	engine,
	now,
}: SaveGeneratedVersionInput): Promise<GenerateResult> {
	const workspace = createWorkspaceStore({ recordStore, engine, now }).getState();

	workspace.open(record);
	workspace.editSeed(seed);

	try {
		return { ok: true, record: await workspace.commit(provenance) };
	} catch (cause) {
		if (isSchemaRejection(cause)) {
			return {
				ok: false,
				failure: {
					kind: 'record-schema',
					issues: seedRelativeIssues(cause),
					error: cause,
					seed,
					provenance,
				},
			};
		}

		const error = asStorageError(cause);

		if (!error) {
			throw cause;
		}

		return { ok: false, failure: { kind: error.kind, error, seed, provenance } };
	}
}

/**
 * Reads once, parses, and commits. It never reads a second time, because every read, a repair
 * included, spends the user's money, and issue #1 says that waits for them to ask.
 *
 * Nothing is written until the parse succeeds, so a failed read or parse can't touch the record. A
 * storage failure means `RecordStore.put` rejected, and a rejected `put` writes nothing.
 *
 * A cancelled run commits nothing either, even when the answer landed before the abort did. The
 * person said stop, and a version turning up after that would be one they didn't ask for.
 */
export async function generate({
	record,
	key,
	reader,
	recordStore,
	engine,
	repair,
	signal,
	onCommitting,
	now,
	resolveFontTableRef = defaultFontTableRef,
}: GenerateInput): Promise<GenerateResult> {
	// Resolved before the read. Resolution only rejects when the fallback table's chunk fails to
	// load, and failing there after a paid read would throw the seed away with it.
	let fontTable: FontTableRef;

	try {
		fontTable = await resolveFontTableRef();
	} catch (error) {
		return { ok: false, failure: { kind: 'font-table-unavailable', error } };
	}

	let response;

	try {
		response = await reader.read(record.images, { auth: anthropicAuth(key), repair, signal });
	} catch (cause) {
		if (cause instanceof AnthropicReaderError) {
			return { ok: false, failure: { kind: cause.kind, error: cause } };
		}

		throw cause;
	}

	// The Anthropic reader already refuses a response that arrived after an abort. `reader` is an
	// injected seam, though, and this is the last point before a write, so it doesn't lean on that.
	if (signal?.aborted) {
		const error = new AnthropicReaderError(
			'cancelled',
			'The run was cancelled before its seed was saved.',
			{ cause: signal.reason },
		);
		return { ok: false, failure: { kind: error.kind, error } };
	}

	const parsed = parseSeed(response);

	if (!parsed.ok) {
		return { ok: false, failure: { kind: parsed.error.kind, error: parsed.error } };
	}

	onCommitting?.();

	return saveGeneratedVersion({
		record,
		seed: parsed.seed,
		provenance: {
			provider: response.provider,
			model: response.model,
			promptVersion: response.promptVersion,
			rawResponse: response.raw,
			fontTable,
		},
		recordStore,
		engine,
		now,
	});
}
