import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { type DtcgViolation, validateDtcg } from './validate';

// `fileURLToPath`, not `.pathname`: a checkout path containing a space arrives percent-encoded.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'cambium-dtcg-'));

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

/**
 * Regenerate-and-diff, the pattern borrowed from unbranded-ds. The validator is committed so the
 * app never compiles a schema at runtime, which is what keeps `'unsafe-eval'` out of the CSP. A
 * committed artefact drifts from its source silently, so the check is to build it again and
 * compare bytes: refresh the schema without rebuilding, or edit the generated file by hand, and
 * this fails rather than shipping.
 */
describe('the generated DTCG validator', () => {
	it('matches what the build script produces from the vendored schema today', () => {
		const stem = join(scratch, 'format-validator.generated');

		execFileSync('node', ['scripts/build-dtcg-validator.mjs', `${stem}.mjs`], { cwd: repoRoot });

		// Collected rather than asserted one at a time, because `expect` takes no custom message
		// here and a bare byte diff of a quarter-megabyte file tells the reader nothing.
		const stale = ['.mjs', '.d.mts']
			.filter((suffix) => {
				const committed = join(repoRoot, 'core/dtcg', `format-validator.generated${suffix}`);
				return readFileSync(`${stem}${suffix}`, 'utf8') !== readFileSync(committed, 'utf8');
			})
			.map(
				(suffix) => `core/dtcg/format-validator.generated${suffix} is stale; run pnpm dtcg:build`,
			);

		expect(stale).toEqual([]);
	});
});

const validDocument = {
	color: {
		$type: 'color',
		brand: {
			$value: { colorSpace: 'oklch', components: [0.62, 0.19, 259.8], alpha: 1 },
			$description: 'The seed colour, unmodified.',
			$extensions: { 'com.cambium.provenance': { origin: 'observed' } },
		},
		border: { $value: '{color.brand}' },
	},
};

/**
 * RFC 6901 §4 resolution. The promise `DtcgViolation` makes is not that `pointer` has a
 * particular spelling, it is that a caller can walk it to the value that failed, so the tests
 * walk the pointers the validator actually returned. A pointer asserted only as a string looks
 * right in exactly the case where it is wrong.
 */
function resolvePointer(tokenDocument: unknown, pointer: string): unknown {
	if (pointer === '') return tokenDocument;

	return pointer
		.slice(1)
		.split('/')
		.map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
		.reduce<unknown>(
			(node, token) => (node as Record<string, unknown> | undefined)?.[token],
			tokenDocument,
		);
}

const badHue = {
	color: {
		brand: { $type: 'color', $value: { colorSpace: 'oklch', components: [0.62, 0.19, 360] } },
	},
};

function violationsOf(tokenDocument: unknown): DtcgViolation[] {
	const result = validateDtcg(tokenDocument);

	if (result.valid) throw new Error('expected this document to fail validation');

	return result.violations;
}

describe('validateDtcg', () => {
	it('accepts a document carrying an OKLCH token, an alias, and foreign $extensions', () => {
		expect(validateDtcg(validDocument)).toEqual({ valid: true });
	});

	/**
	 * Hue of exactly 360 is the case worth pinning. Colour Module §4.2.8 runs hue from 0 up to but
	 * not including 360, and this value-level strictness is why the official schema was chosen over
	 * every parser in the survey: the parsers accept it.
	 */
	it('rejects an OKLCH hue of 360 and points at the component that failed', () => {
		// Keyed by the pointers the validator returned, so nothing here resolves a literal the
		// author typed. A missing pointer shows up as an undefined lookup.
		const resolved = new Map(
			violationsOf(badHue).map((violation) => [
				violation.pointer,
				resolvePointer(badHue, violation.pointer),
			]),
		);

		expect(resolved.get('/color/brand/$value/components/2')).toBe(360);
	});

	/**
	 * Ajv reports `additionalProperties` against the object holding the key and says only "must NOT
	 * have additional properties", so the key lives in `params` or nowhere. Without it a caller
	 * cannot name the field that broke.
	 */
	it('points at the offending key when a document carries one the schema forbids', () => {
		const strayKey = { $foo: 1 };

		expect(violationsOf(strayKey).map((violation) => violation.pointer)).toContain('/$foo');
	});

	/**
	 * The name has to start with `$` to reach the escaping in `validate.ts` at all. A name like
	 * `a~b/c` is legal under the DTCG pattern, so it goes to `patternProperties` and Ajv builds the
	 * pointer itself, already escaped. Testing that name measures Ajv rather than this module,
	 * which is exactly what an earlier version of this test did.
	 */
	it('escapes ~ and / in a key it appends, so the pointer still resolves', () => {
		const awkwardName = { '$a~b/c': 1 };
		const [pointer] = violationsOf(awkwardName).map((violation) => violation.pointer);

		expect(pointer).toBe('/$a~0b~1c');
		expect(resolvePointer(awkwardName, pointer ?? '')).toBe(1);
	});

	/**
	 * Characterization, not endorsement. One bad value produces nineteen diagnostics because Ajv
	 * reports every rejected `oneOf` branch, and four of the six distinct pointers below address
	 * keys that are perfectly legal where they sit. Collapsing that means guessing which branch the
	 * author intended, and a wrong guess hides a real error elsewhere, so the noise stays until #11
	 * says what it wants.
	 *
	 * The exact figures are pinned on purpose. A vague assertion would let the shape drift without
	 * anyone noticing, and these can only move when someone runs `pnpm dtcg:refresh`, which is a
	 * deliberate act with a diff to review. If this test fails, read the new numbers and decide;
	 * do not relax it.
	 */
	it('returns every branch diagnostic, including ones that are false about the document', () => {
		const violations = violationsOf(badHue);

		expect(violations).toHaveLength(19);
		// Compared as a Set so the assertion does not depend on Ajv's diagnostic ordering, which is
		// not part of anything this module promises.
		expect(new Set(violations.map((violation) => violation.pointer))).toEqual(
			new Set([
				'/color',
				'/color/brand',
				'/color/brand/$value',
				'/color/brand/$value/colorSpace',
				'/color/brand/$value/components',
				'/color/brand/$value/components/2',
			]),
		);
	});

	// The empty string addresses the whole document, and `/` addresses the property named by the
	// empty string. Returning `/` here would resolve to `document[""]`, a different place and
	// usually no place at all.
	it('addresses a root-level failure with the empty pointer', () => {
		const [violation] = violationsOf('not a token document');

		expect(violation?.pointer).toBe('');
	});
});
