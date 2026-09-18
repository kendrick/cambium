import { readFile } from 'node:fs/promises';
import { BrandSeedSchema } from '../../core/brand-seed.ts';

/**
 * Thrown for every way a seed file can fail to become a `BrandSeed`. One type rather than three
 * lets both `scripts/generate.mjs` and `scripts/evaluate.mjs` share a single catch-and-exit path
 * instead of each re-deriving what "readable" means.
 */
export class SeedLoadError extends Error {}

/**
 * Reads a seed JSON file and parses it straight against `BrandSeedSchema`, not against
 * `parseSeed`'s `RawReaderResponse` envelope. A file on disk isn't a reader's response: it has no
 * `provider`/`model`/`promptVersion` to carry, and `parseSeed`'s not-json/schema split exists to
 * tell a retryable model reply apart from a rejected one, which doesn't apply here. Zod's issue
 * paths already make a schema rejection readable on their own.
 */
export async function loadSeed(path) {
	let raw;

	try {
		raw = await readFile(path, 'utf8');
	} catch (cause) {
		throw new SeedLoadError(`could not read seed file "${path}": ${cause.message}`);
	}

	let payload;

	try {
		payload = JSON.parse(raw);
	} catch (cause) {
		throw new SeedLoadError(`"${path}" is not valid JSON: ${cause.message}`);
	}

	const result = BrandSeedSchema.safeParse(payload);

	if (!result.success) {
		// Zod reports an unrecognised key against the object that holds it and names the key in a
		// separate array, one path segment short of the field that actually failed. Flattening the
		// two together is the same fix core/parse-seed.ts makes for the same reason: without it, the
		// message points at "(root)" instead of naming the offending key.
		const lines = result.error.issues.flatMap((issue) =>
			issue.code === 'unrecognized_keys'
				? issue.keys.map((key) => `  ${[...issue.path, key].join('.')}: unrecognized key`)
				: [`  ${issue.path.join('.') || '(root)'}: ${issue.message}`],
		);

		throw new SeedLoadError(`"${path}" failed seed schema validation:\n${lines.join('\n')}`);
	}

	return result.data;
}
