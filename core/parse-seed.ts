import type { RawReaderResponse } from './brand-reader';
import { type BrandSeed, BrandSeedSchema } from './brand-seed';

/** `path` is the segment array Zod produces, so an issue points at a field rather than describing one. */
export type SeedParseIssue = {
	path: PropertyKey[];
	message: string;
};

/**
 * The two failures recover differently, which is the only reason they are told apart. Prose
 * where JSON was asked for is worth retrying as it stands, while JSON the schema rejects has an
 * offending field to show the user first.
 */
export type SeedParseErrorKind = 'not-json' | 'schema';

/**
 * A failure carries the whole envelope. The response is persisted either way, and which model
 * answered under which prompt is most of what makes a bad generation diagnosable later.
 */
export type SeedParseError = RawReaderResponse & {
	kind: SeedParseErrorKind;
	issues: SeedParseIssue[];
};

/**
 * The `never` slots mirror Zod's own `SafeParseResult`, so `result.seed?.` and `result.error?.`
 * both read without narrowing first. That is how every assertion in `core/` is already written.
 */
export type ParseSeedResult =
	| { ok: true; seed: BrandSeed; error?: never }
	| { ok: false; seed?: never; error: SeedParseError };

/**
 * Returns a result rather than throwing. The raw response is the one place untrusted model
 * output enters the core, so a caller has to handle a bad one; an exception makes handling it
 * optional, and #23 has a defined recovery for each failure below.
 */
export function parseSeed(response: RawReaderResponse): ParseSeedResult {
	let payload: unknown;

	try {
		payload = JSON.parse(response.raw);
	} catch (cause) {
		return {
			ok: false,
			error: {
				...response,
				kind: 'not-json',
				// Text that is not JSON has no path into it, so the parser's own complaint is the
				// whole diagnosis. The raw string beside it is what the user reads.
				issues: [{ path: [], message: cause instanceof Error ? cause.message : String(cause) }],
			},
		};
	}

	const result = BrandSeedSchema.safeParse(payload);

	if (!result.success) {
		return {
			ok: false,
			error: {
				...response,
				kind: 'schema',
				// Zod reports an unrecognised key against the object that holds it and names the key in
				// a separate array, so the issue's own path stops one segment short of the field that
				// failed. Joining the two gives every issue a path pointing at the offending field,
				// which is what lets #23 highlight it instead of string-matching the message.
				issues: result.error.issues.flatMap((issue) =>
					issue.code === 'unrecognized_keys'
						? issue.keys.map((key) => ({ path: [...issue.path, key], message: issue.message }))
						: [{ path: issue.path, message: issue.message }],
				),
			},
		};
	}

	return { ok: true, seed: result.data };
}
