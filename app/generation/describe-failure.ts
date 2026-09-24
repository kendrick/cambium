import type { SeedParseIssue } from '../../core/parse-seed';
import type { SeedRepair } from '../readers/anthropic-reader';

import type { GenerationFailure, GenerationFailureKind, ReaderFailure } from './generate';

/**
 * What the landing page offers after a failure, one action each. `none` means no retry is worth
 * offering: the same request would fail the same way.
 */
export type FailureRecovery =
	| 'reopen-key-dialog'
	| 'manual-retry'
	| 'repair-retry'
	| 'save-again'
	| 'none';

export type FailureDescriptor = {
	kind: GenerationFailureKind;
	message: string;
	recovery: FailureRecovery;
	/** Rate limits only. Null when Anthropic sent no usable `retry-after`. */
	retryAfterSeconds?: number | null;
	/**
	 * What Anthropic sent back, for the person to see what went wrong. For a parse or record failure
	 * it's the seed text the model wrote. For `malformed` it's the whole response body, since no
	 * seed text could be found in it, which is also why `malformed` never carries a `repair`.
	 */
	raw?: string;
	requestId?: string;
	/** Set exactly when `recovery` is `repair-retry`, ready to hand back to `generate`. */
	repair?: SeedRepair;
};

export type DescribeFailureOptions = {
	/** A repair gets one go. A second would resend the images for an answer that already failed twice. */
	repairUsed: boolean;
};

function issueLine({ path, message }: SeedParseIssue): string {
	return path.length > 0 ? `${path.map(String).join('.')}: ${message}` : message;
}

function seconds(count: number): string {
	const whole = Math.ceil(count);
	return whole === 1 ? '1 second' : `${whole} seconds`;
}

type RepairableCopy = { first: string; afterRepair: string; empty: string };

/**
 * The failures a repair can fix. Each one has seed text the model wrote, which the repair hands
 * back with what was wrong with it. The empty case falls back to a plain retry because the
 * request builder refuses a repair with nothing to correct, so offering one would fail locally.
 */
const REPAIRABLE: Record<'not-json' | 'schema' | 'record-schema', RepairableCopy> = {
	'not-json': {
		first:
			'Anthropic described the brand in prose instead of returning a seed. Ask it to fix the answer.',
		afterRepair:
			'Anthropic answered in prose again after being asked to fix it. Try again from the start.',
		empty: 'Anthropic sent back an empty seed. Try again.',
	},
	schema: {
		first: "Anthropic's seed had fields Cambium can't use. Ask it to fix them.",
		afterRepair:
			"Anthropic's fixed seed still had fields Cambium can't use. Try again from the start.",
		empty: 'Anthropic sent back an empty seed. Try again.',
	},
	'record-schema': {
		first:
			"Anthropic's seed didn't match this brand's images, so it wasn't saved. Ask it to fix the seed.",
		afterRepair:
			"Anthropic's fixed seed still didn't match this brand's images. Try again from the start.",
		empty: 'Anthropic sent back an empty seed. Try again.',
	},
};

type RepairableFailure = {
	kind: keyof typeof REPAIRABLE;
	/** The seed text the model wrote, which a repair hands back to it. */
	raw: string | null;
	/** Already worded for the model, one line each. */
	issues: string[];
};

function describeRepairable(
	{ kind, raw, issues }: RepairableFailure,
	{ repairUsed }: DescribeFailureOptions,
): FailureDescriptor {
	const copy = REPAIRABLE[kind];

	if (!raw || raw.trim().length === 0) {
		return { kind, message: copy.empty, recovery: 'manual-retry' };
	}

	if (repairUsed) {
		return { kind, message: copy.afterRepair, recovery: 'manual-retry', raw };
	}

	return {
		kind,
		message: copy.first,
		recovery: 'repair-retry',
		raw,
		repair: { rawResponse: raw, issues },
	};
}

/**
 * The single source for what the landing page says and offers after a failed generation. Every
 * message names what to do next and nothing about how Cambium works inside. None of them says the
 * key was cleared, because it never is: a rejected key stays loaded so the person can check it.
 */
export function describeFailure(
	failure: GenerationFailure,
	options: DescribeFailureOptions,
): FailureDescriptor {
	switch (failure.kind) {
		case 'not-json':
		case 'schema':
			return describeRepairable(
				{
					kind: failure.kind,
					raw: failure.error.raw,
					issues: failure.error.issues.map(issueLine),
				},
				options,
			);
		case 'record-schema':
			return describeRepairable(
				{
					kind: failure.kind,
					raw: failure.provenance.rawResponse,
					issues: failure.issues.map(issueLine),
				},
				options,
			);
		case 'font-table-unavailable':
			return {
				kind: failure.kind,
				message:
					"Cambium couldn't load its font list, so nothing was sent to Anthropic. Try again.",
				recovery: 'manual-retry',
			};
		case 'storage-quota-exceeded':
			return {
				kind: failure.kind,
				message:
					'The new version is ready, but this browser is out of storage. Free up space, then save again.',
				recovery: 'save-again',
			};
		case 'stale-record-write':
			return {
				kind: failure.kind,
				message:
					'The new version is ready, but this brand changed somewhere else since you opened it. Save again to add it to the latest copy.',
				recovery: 'save-again',
			};
		case 'record-stamped-ahead':
			return {
				kind: failure.kind,
				message:
					"The new version is ready, but this brand's last version is dated later than this device's clock. Check the clock, then save again.",
				recovery: 'save-again',
			};
	}

	// Reader failures read the same whether or not a repair was used, since none of them offers one.
	return describeReaderFailure(failure);
}

function describeReaderFailure({ kind, error }: ReaderFailure): FailureDescriptor {
	const requestId = error.requestId ? { requestId: error.requestId } : {};

	switch (kind) {
		case 'malformed': {
			// No seed text came back, so a repair would have nothing to hand the model, and the recovery
			// is a plain retry. The body is still shown as the only clue to what Anthropic did send.
			const body = error.body?.trim() ? error.body : null;

			return {
				kind,
				message: body
					? "Anthropic's answer had nothing Cambium could read. Try again."
					: 'Anthropic sent back an empty answer. Try again.',
				recovery: 'manual-retry',
				...(body ? { raw: body } : {}),
				...requestId,
			};
		}
		case 'credentials':
			return {
				kind,
				message:
					"Anthropic didn't accept this API key. It's still loaded, so check it or replace it.",
				recovery: 'reopen-key-dialog',
				...requestId,
			};
		case 'billing':
			return {
				kind,
				message:
					'Your Anthropic account is out of credit. Add credit in the Anthropic Console, then try again.',
				recovery: 'manual-retry',
				...requestId,
			};
		case 'rate-limit':
			return {
				kind,
				message:
					error.retryAfterSeconds === null
						? "Anthropic is limiting requests on this key and didn't say for how long. Wait a minute, then try again."
						: `Anthropic is limiting requests on this key. Try again in ${seconds(error.retryAfterSeconds)}.`,
				recovery: 'manual-retry',
				retryAfterSeconds: error.retryAfterSeconds,
				...requestId,
			};
		case 'request-too-large':
			return {
				kind,
				message:
					'These reference images are too large to send together. Use fewer or smaller images.',
				recovery: 'none',
				...requestId,
			};
		case 'invalid-request':
			return {
				kind,
				message: "Anthropic rejected the request itself, so sending it again won't help.",
				recovery: 'none',
				...requestId,
			};
		case 'server':
			return {
				kind,
				message: 'Anthropic had a problem on its end. Try again in a moment.',
				recovery: 'manual-retry',
				...requestId,
			};
		case 'network':
			return {
				kind,
				message: "Couldn't reach Anthropic. Check your connection, then try again.",
				recovery: 'manual-retry',
				...requestId,
			};
		case 'cancelled':
			// Anthropic may have started work, and billing, before the abort reached it. Saying nothing
			// was charged would be a promise Cambium can't keep. A cancel after the response arrived
			// carries its request id, which is what support needs to look that charge up.
			return {
				kind,
				message:
					"Generation cancelled, and nothing was saved. Anthropic may still bill for a request it had already started. Try again when you're ready.",
				recovery: 'manual-retry',
				...requestId,
			};
		case 'refusal':
			return {
				kind,
				message: 'Anthropic declined to read these images. Try different reference images.',
				recovery: 'none',
				...requestId,
			};
		case 'truncated':
			// Never a repair: the seed hit the output limit, and asking for the same seed hits it again.
			return {
				kind,
				message: 'Anthropic ran out of room before finishing the seed. Try again.',
				recovery: 'manual-retry',
				...requestId,
			};
	}
}
