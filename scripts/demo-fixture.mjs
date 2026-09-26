import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

import { createOklchScaleEngine } from '../core/oklch-scale-engine.ts';
import { BrandRecordSchema, FIRST_REVISION, SCHEMA_VERSION } from '../core/brand-record.ts';
import { IMAGE_TAGS } from '../core/image-tag.ts';
import { parseSeed } from '../core/parse-seed.ts';
import { saveGeneratedVersion } from '../app/generation/generate.ts';
// Not `loadFallbackFontTable` from `app/fonts/load-fallback-table.ts`: that module's own
// `await import('./fallback-table')` names a directory, and `scripts/lib/ts-resolve.mjs` only
// retries a failed specifier with `.ts` appended, never with `/index.ts`, so it never resolves
// under this dev-tooling loader (confirmed by running this script: "Cannot find module
// '.../fallback-table.ts'"). Importing the same constant `FALLBACK_FONT_TABLE_REF` straight from
// its module is the offline, deterministic ref every fallback path already stamps on a version;
// see the plan concern in this wave's report for the fix this papers over.
import { FALLBACK_FONT_TABLE_REF } from '../app/fonts/fallback-table/index.ts';
import { createInMemoryRecordStore } from '../app/storage/in-memory-record-store.ts';
import { createCodexReader } from './codex-reader.ts';
import { createMagickCodec } from './magick-codec.ts';
import { prepareReferenceImage } from '../lib/image-intake.ts';

const USAGE =
	'usage: fixture:demo <image> --tag <auto|logo|ui|photo|artwork> ' +
	'[--raw <file> --provider <p> --model <m> --prompt-version <v>] [--model <m>] [--out <dir>]';

const DEFAULT_OUT_DIR = 'app/demo/fixtures';

/** Thrown for a call this script itself refuses before touching a file or a subprocess. */
class UsageError extends Error {}

function parseArgs(argv) {
	const flags = {};
	const positional = [];

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];

		if (arg.startsWith('--')) {
			flags[arg.slice(2)] = argv[i + 1];
			i += 1;
		} else {
			positional.push(arg);
		}
	}

	return { positional, flags };
}

async function readImageBlob(path) {
	let bytes;

	try {
		bytes = await readFile(path);
	} catch (cause) {
		throw new Error(`could not read image "${path}": ${cause.message}`, { cause });
	}

	return new Blob([bytes]);
}

function describeIntakeFailure(path, result) {
	if (result.kind === 'unsupported') {
		const detected = result.rejected.detected;
		return `"${path}" is not a supported reference image${detected ? ` (looks like ${detected})` : ''}`;
	}

	return (
		`"${path}" is too large after re-encoding: ${result.oversized.bytes} bytes ` +
		`over a ${result.oversized.limit} byte limit`
	);
}

/**
 * `--raw` replays a recorded response with no model call, per #18's plan. The provenance a live
 * call would have reported travels with it only if a caller states it explicitly: defaulting a
 * missing `--provider` or `--model` to a guess would let a hand-authored or borrowed fixture read
 * as an answer some model actually gave.
 */
async function readRawProvenance(flags) {
	const missing = ['provider', 'model', 'prompt-version'].filter((name) => !flags[name]);

	if (missing.length > 0) {
		throw new UsageError(
			`--raw needs its recorded provenance stated explicitly: missing ${missing
				.map((name) => `--${name}`)
				.join(', ')}`,
		);
	}

	let raw;

	try {
		raw = await readFile(flags.raw, 'utf8');
	} catch (cause) {
		throw new Error(`could not read raw response "${flags.raw}": ${cause.message}`, { cause });
	}

	return {
		raw,
		provider: flags.provider,
		model: flags.model,
		promptVersion: flags['prompt-version'],
	};
}

async function main() {
	const { positional, flags } = parseArgs(process.argv.slice(2));
	const [imagePath] = positional;

	if (!imagePath) throw new UsageError(USAGE);
	if (!flags.tag || !IMAGE_TAGS.includes(flags.tag)) {
		throw new UsageError(`${USAGE}\n--tag must be one of: ${IMAGE_TAGS.join(', ')}`);
	}

	const outDir = resolve(flags.out ?? DEFAULT_OUT_DIR);

	// Runs before the raw-vs-live branch below: both paths need the same prepared image, and a
	// missing `magick` is refused here rather than after a model call nobody needed to pay for.
	const blob = await readImageBlob(imagePath);
	const intake = await prepareReferenceImage(blob, createMagickCodec());

	if (intake.kind !== 'prepared') {
		throw new Error(describeIntakeFailure(imagePath, intake));
	}

	const image = { ...intake.prepared.image, tag: flags.tag };

	const response = flags.raw
		? await readRawProvenance(flags)
		: await createCodexReader({ model: flags.model }).read([image], { auth: null });

	const parsed = parseSeed(response);

	if (!parsed.ok) {
		const source = flags.raw ?? '<model response>';
		const lines = parsed.error.issues.map(
			(issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
		);

		// Nothing has been written yet, and nothing below this throw runs: a bad response is refused
		// before the record it would have produced ever exists.
		throw new Error(`${source} failed seed schema validation:\n${lines.join('\n')}`);
	}

	// The fallback ref, not `resolveFontTable`'s CDN fetch: a fixture generator has to produce the
	// same record on a machine with no network reach, and `resolveFontTable` already treats a
	// failed fetch as an ordinary path to this same fallback, so asking for it directly costs
	// nothing a live run would have kept.
	const fontTable = FALLBACK_FONT_TABLE_REF;

	const record = {
		id: randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		revision: FIRST_REVISION,
		brandUrl: null,
		images: [image],
		versions: [],
	};

	const saved = await saveGeneratedVersion({
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
		recordStore: createInMemoryRecordStore(),
		engine: createOklchScaleEngine(),
	});

	if (!saved.ok) {
		throw new Error(`could not save the generated version (${saved.failure.kind})`);
	}

	// A second parse right before the bytes hit disk, matching the plan's decision: `put` already
	// parsed on the way in, but this is the one line standing between a bug in that return path and
	// an invalid record reaching a file.
	const finalRecord = BrandRecordSchema.parse(saved.record);
	const stem = basename(imagePath, extname(imagePath));
	const recordPath = `${outDir}/${stem}.json`;
	const rawPath = `${outDir}/${stem}.raw.json`;

	await mkdir(outDir, { recursive: true });
	await writeFile(recordPath, `${JSON.stringify(finalRecord, null, 2)}\n`);
	await writeFile(rawPath, `${JSON.stringify(response, null, 2)}\n`);

	console.log(recordPath);
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
