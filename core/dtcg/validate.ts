import validateAgainstSchema from './format-validator.generated.mjs';

/**
 * A single way in which a document departs from the DTCG Format Module. `pointer` is an RFC 6901
 * JSON Pointer into the document the caller passed, so a UI can walk straight to the offending
 * token. It is `pointer` rather than `path` because the repo already spells three other things
 * `path`, and only this one is a JSON Pointer.
 *
 * A failure at the root carries the empty pointer, which is what RFC 6901 evaluates a pointer
 * with no reference tokens to, not a placeholder. `/` is a different pointer: it addresses the
 * property whose name is the empty string. Rendering the root as something a person reads is the
 * caller's job, and doing it here would hand every caller a pointer that resolves to the wrong
 * place.
 */
export type DtcgViolation = {
	pointer: string;
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
			pointer: error.instancePath,
			message: error.message ?? `failed the ${error.keyword} constraint`,
		})),
	};
}
