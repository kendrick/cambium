import validateAgainstSchema, { type DtcgSchemaError } from './format-validator.generated.mjs';

/**
 * One diagnostic from the schema. `pointer` is an RFC 6901 JSON Pointer into the document the
 * caller passed, addressing the value that this diagnostic is about. It is `pointer` rather than
 * `path` because the repo already spells three other things `path`, and only this one is a JSON
 * Pointer.
 *
 * One diagnostic is not one problem. Read `validateDtcg` before building anything on the set.
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
 *
 * What comes back is every diagnostic Ajv produced, including the ones from rejected `oneOf`
 * alternatives. That is not a list of problems. A single bad value routinely yields many
 * diagnostics: one bad OKLCH hue produces nineteen, several describing the same failure, and some
 * describing a branch the author never intended. A colour token that fails the colour branch is
 * also reported as failing the alias branch, so it draws a "must have required property '$ref'"
 * and a "must NOT have additional properties" naming `$value`, and that second one is simply
 * false about the document.
 *
 * Collapsing that into one problem per mistake needs a consumer to say what it wants, because
 * doing it here means guessing which `oneOf` branch the author intended, and a wrong guess drops
 * a real error somewhere else in the document. Noise is the better failure. #11 is the consumer
 * that gets to make the call, so do not add a filter, a heuristic, or a deepest-pointer-wins rule
 * before then.
 */
/**
 * RFC 6901 §3 escaping for one reference token. `~` first, then `/`: reversed, the `~1` produced
 * by escaping a slash gets re-escaped into `~01`, and the pointer resolves somewhere else.
 */
function escapeToken(key: string): string {
	return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * `additionalProperties` is the one keyword whose message drops the detail that matters. Ajv
 * reports it against the object that holds the offending key, says only "must NOT have additional
 * properties", and puts the key in `params`, so without this the caller cannot name the field at
 * all. Joining them points the violation at the field itself, which is what lets a UI highlight
 * it rather than string-match. `core/parse-seed.ts` does the same on the zod side for
 * `unrecognized_keys`.
 *
 * Every other keyword already carries its detail in `message`, checked against Ajv rather than
 * assumed: `required` says "must have required property 'colorSpace'", `type` says "must be
 * string", `exclusiveMaximum` says "must be < 360", `const` says "must be equal to constant".
 * `required` is deliberately left alone even though it names a key, because that key is by
 * definition absent from the document, so extending the pointer would address a member that does
 * not exist. Under `oneOf` it is usually worse than that: the missing property is often `$ref`,
 * named by a branch the author never intended.
 */
function pointerFor(error: DtcgSchemaError): string {
	const key = error.params.additionalProperty;

	return typeof key === 'string' ? `${error.instancePath}/${escapeToken(key)}` : error.instancePath;
}

export function validateDtcg(tokenDocument: unknown): DtcgValidationResult {
	if (validateAgainstSchema(tokenDocument)) return { valid: true };

	// Ajv hangs the failures off the function itself and overwrites them on the next call, so read
	// them before anything else can validate.
	const errors = validateAgainstSchema.errors ?? [];

	return {
		valid: false,
		violations: errors.map((error) => ({
			pointer: pointerFor(error),
			message: error.message ?? `failed the ${error.keyword} constraint`,
		})),
	};
}
