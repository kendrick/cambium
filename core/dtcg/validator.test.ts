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
	it('rejects an OKLCH hue of 360 and names the component that failed', () => {
		const paths = violationsOf({
			color: {
				brand: { $type: 'color', $value: { colorSpace: 'oklch', components: [0.62, 0.19, 360] } },
			},
		}).map((violation) => violation.path);

		expect(paths).toContain('/color/brand/$value/components/2');
	});

	it('reports the root as a path rather than an empty string', () => {
		expect(violationsOf('not a token document')[0]?.path).toBe('/');
	});
});
