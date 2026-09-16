import validateAgainstSchema from './format-validator.generated.mjs';

/**
 * A single way in which a document departs from the DTCG Format Module. `path` is a JSON Pointer
 * into the document the caller passed, so a UI can walk straight to the offending token.
 */
export type DtcgViolation = {
	path: string;
	message: string;
};

export type DtcgValidationResult = { valid: true } | { valid: false; violations: DtcgViolation[] };

/**
 * Validates a parsed DTCG document against the vendored 2025.10 Format schema.
 *
 * The schema is the only validator in the survey that scored 37/37 on the official conformance
 * suite, and it is stricter than any parser about values: colour space enums, component counts,
 * and numeric ranges. It is deliberately not the whole story. JSON Schema cannot propagate a
 * group's `$type` down to its children, so a bare `"#ff0000"` string `$value` under a typed group
 * passes here and has to be caught structurally instead. Schema and parser are complementary;
 * neither one alone means conformant.
 */
export function validateDtcg(tokenDocument: unknown): DtcgValidationResult {
	if (validateAgainstSchema(tokenDocument)) return { valid: true };

	// Ajv hangs the failures off the function itself and overwrites them on the next call, so read
	// them before anything else can validate.
	const errors = validateAgainstSchema.errors ?? [];

	return {
		valid: false,
		violations: errors.map((error) => ({
			// Ajv spells the document root as an empty string; `/` reads as a path.
			path: error.instancePath || '/',
			message: error.message ?? `failed the ${error.keyword} constraint`,
		})),
	};
}
