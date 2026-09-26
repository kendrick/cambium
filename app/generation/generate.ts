import type { BrandRecord, FontTableRef } from '../../core/brand-record';
import type { BrandSeed } from '../../core/brand-seed';
import {
	parseSeed,
	type SeedParseError,
	type SeedParseErrorKind,
	type SeedParseIssue,
} from '../../core/parse-seed';
import type { ScaleEngine } from '../../core/scale-engine';
import { defaultSeedPins } from '../../core/seed-pins';
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

/**
 * What the landing page keeps for "Save again": the paid seed plus the id of the read that paid for
 * it. A save-again makes no request of its own, so a failure it hits can only name that read's id.
 */
export type HeldSeed = PaidSeed & {
	requestId?: string;
};

/** The model call had already succeeded when any of these happened, so the paid seed rides along. */
export type StorageFailure = PaidSeed & {
	kind: StorageFailureKind;
	error: StorageQuotaExceededError | StaleRecordWriteError | RecordStampedAheadError;
	/**
	 * The paid read's, when it had one. A save-again made no request, so it carries the id of the
	 * read whose seed it's saving.
	 */
	requestId?: string;
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
	/** The paid read's, when it had one. */
	requestId?: string;
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

/** Only a commit runs here, so only the failures a commit can have. */
export type SaveResult =
	| { ok: true; record: BrandRecord }
	| { ok: false; failure: StorageFailure | RecordSchemaFailure };

export type SaveGeneratedVersionInput = HeldSeed & {
	record: BrandRecord;
	recordStore: RecordStore;
	engine: ScaleEngine;
	now?: () => string;
};

export type GenerateInput = Omit<SaveGeneratedVersionInput, keyof HeldSeed> & {
	/** Passed in, not read from `session-key.ts`, so this module never touches `sessionStorage`. */
	key: string;
	reader: AnthropicBrandReader;
	/** Only ever set because a person asked for a repair. Nothing here builds one on its own. */
	repair?: SeedRepair;
	/**
	 * Set by the person's Cancel. It ends the font lookup's wait as well as the read, since Cancel is
	 * on screen for both. Nothing in this module sets a timeout.
	 */
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
 * Thrown by `generate` when the commit fails after a paid read in a way `saveGeneratedVersion` has
 * no recovery for. Support needs the read's request id to find that charge, so the error carries
 * it. `cause` holds the original error.
 */
export class UnexpectedAfterPaidReadError extends Error {
	readonly requestId: string;

	constructor(requestId: string, cause: unknown) {
		super('The commit failed after a paid read.', { cause });
		this.name = 'UnexpectedAfterPaidReadError';
		this.requestId = requestId;
	}
}

export const ABORTED = Symbol('aborted');

/**
 * Lets Cancel end a wait on something that takes no signal. The default font lookup is a CDN fetch
 * with none, and it can't take one: the in-flight promise is cached and shared, so aborting it for
 * this run would fail every other caller waiting on it. It finishes in the background instead, and
 * a late rejection lands on a handler here rather than going unhandled.
 *
 * Exported for the landing page's record lookup, which has the same problem: IndexedDB takes no
 * signal, and another tab's write can hold the read for as long as that write takes.
 */
export function unlessAborted<T>(
	start: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T | typeof ABORTED> {
	if (!signal) return start();
	// A Cancel pressed during setup shouldn't start a lookup at all.
	if (signal.aborted) return Promise.resolve(ABORTED);

	const pending = start();

	return new Promise((resolve, reject) => {
		const onAbort = () => resolve(ABORTED);

		signal.addEventListener('abort', onAbort, { once: true });
		pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}

export function cancelledFailure(
	message: string,
	signal: AbortSignal | undefined,
	requestId?: string,
): GenerateResult {
	// No status either way: before the read nothing was sent, and after it the reader has already
	// consumed the response, so the status isn't known here.
	const error = new AnthropicReaderError('cancelled', message, {
		cause: signal?.reason,
		requestId: requestId ?? null,
	});
	return { ok: false, failure: { kind: error.kind, error } };
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
	requestId,
	recordStore,
	engine,
	now,
}: SaveGeneratedVersionInput): Promise<SaveResult> {
	const id = requestId ? { requestId } : {};
	const store = createWorkspaceStore({ recordStore, engine, now });
	const workspace = store.getState();

	workspace.open(record);
	// `open` restores the newest version's overrides, and they were edits to another seed's tokens.
	// Carried into this commit, they'd be credited to a model that never produced what they sit on.
	for (const key of Object.keys(store.getState().overrides)) {
		workspace.clearOverride(key);
	}
	workspace.editSeed(seed);
	// Every key colour here was read out of an image, whether this is the record's first version or
	// a save-again after a storage failure retried the same read. `open` would otherwise carry the
	// previous version's pins forward, which name indices into a seed this commit is replacing.
	workspace.setDraftPins(defaultSeedPins(seed));

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
					...id,
				},
			};
		}

		const error = asStorageError(cause);

		if (!error) {
			throw cause;
		}

		return { ok: false, failure: { kind: error.kind, error, seed, provenance, ...id } };
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
	let fontTable: FontTableRef | typeof ABORTED;

	try {
		fontTable = await unlessAborted(resolveFontTableRef, signal);
	} catch (error) {
		return { ok: false, failure: { kind: 'font-table-unavailable', error } };
	}

	// Cancel is on screen from the click, and this lookup has no timeout of its own, so a stalled CDN
	// would otherwise hold the run open until reload. Nothing was sent, so nothing was billed.
	if (fontTable === ABORTED) {
		return cancelledFailure('The run was cancelled before anything was sent.', signal);
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
		return cancelledFailure(
			'The run was cancelled before its seed was saved.',
			signal,
			response.requestId,
		);
	}

	// `SeedParseError` spreads the whole response, so a parse failure already carries `requestId`.
	const parsed = parseSeed(response);

	if (!parsed.ok) {
		return { ok: false, failure: { kind: parsed.error.kind, error: parsed.error } };
	}

	onCommitting?.();

	try {
		return await saveGeneratedVersion({
			record,
			seed: parsed.seed,
			provenance: {
				provider: response.provider,
				model: response.model,
				promptVersion: response.promptVersion,
				rawResponse: response.raw,
				fontTable,
			},
			requestId: response.requestId,
			recordStore,
			engine,
			now,
		});
	} catch (cause) {
		// This read was paid for, so even a failure with no recovery has to name it.
		if (response.requestId) throw new UnexpectedAfterPaidReadError(response.requestId, cause);
		throw cause;
	}
}
