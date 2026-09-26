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
// its module is the offline, deterministic ref every fallback path already stamps on a version, so
// every fixture this script writes carries the fallback table rather than the one a live app
// session would resolve over the network—a known gap until `ts-resolve.mjs` can follow a
// directory import.
import { FALLBACK_FONT_TABLE_REF } from '../app/fonts/fallback-table/index.ts';
import { createInMemoryRecordStore } from '../app/storage/in-memory-record-store.ts';
import { createCodexReader } from './codex-reader.ts';
import { createMagickCodec } from './magick-codec.ts';
import { prepareReferenceImage } from '../lib/image-intake.ts';

/**
 * Turns one reference image into a demo `BrandRecord` fixture, live through `createCodexReader` or
 * replayed from a recorded response (`--raw <file>`).
 *
 * Every run writes `<stem>.raw.json` beside the record — the envelope the rest of this file means
 * by that word. It always holds `{ raw, provider, model, promptVersion }`. `imageIds` and
 * `requestId` ride along whenever this run has one to record: both on a live run, whatever a
 * replayed envelope itself held on a `--raw` run over a full envelope, and neither on a `--raw` run
 * over a bare seed string, which has no envelope to carry them from. `imageIds` is the id this run's
 * image carried when it was sent to the model (an array, for a future multi-image run, in
 * attachment order).
 *
 * `imageIds` is what makes a live answer replayable. `prepareReferenceImage` mints a fresh
 * `crypto.randomUUID()` on every call, but a live model can name the id it was shown back inside
 * the seed it returns — `keyColors[].sourceImageId`, `imageClassifications[].imageId` — because the
 * prompt lists each image's id ahead of its attachment (see `buildPrompt` in `codex-reader.ts`).
 * Replaying that seed against a freshly minted id would point those references at an image the
 * replayed record never has, and `BrandRecordSchema` refuses exactly that. So `--raw` reads
 * `imageIds` back out of the envelope and stamps it onto the prepared image before the record is
 * built, overriding the mint. That is also why two `--raw` runs over the same image and response
 * now differ only at the record `id` and `versions[0].createdAt`: the image `id` no longer moves.
 *
 * `--raw <file>` accepts either shape. A full envelope, detected by a top-level string `raw` field,
 * supplies `provider`/`model`/`promptVersion`/`imageIds`/`requestId` unless a flag overrides one of
 * the first three—the natural case, since it's the same file a live run already wrote. `imageIds`
 * and `requestId` have no matching flag, so a full envelope's values for those two always pass
 * through untouched. A bare seed-JSON string (no `raw` field of its own) has no envelope to read
 * anything from, so it still needs `--provider`/`--model`/`--prompt-version` stated explicitly, and
 * carries no image id or request id to reuse—fine for a seed with no image-id references, and
 * exactly this script's own `--raw` fixtures.
 */

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
 * `--raw` replays a recorded response with no model call, per #18's plan. `flags.raw` is read as
 * either shape the module docblock above describes; either way, the provenance that travels with
 * the replay comes from an envelope field or an explicit flag, never a guess — defaulting a
 * missing `--provider` or `--model` would let a hand-authored or borrowed fixture read as an answer
 * some model actually gave.
 */
async function readRawEnvelope(flags) {
	let fileText;

	try {
		fileText = await readFile(flags.raw, 'utf8');
	} catch (cause) {
		throw new Error(`could not read raw response "${flags.raw}": ${cause.message}`, { cause });
	}

	// An envelope is told apart from a bare seed string by its own shape: `raw` is not a
	// `BrandSeedSchema` field, so a parsed bare seed never has one, and anything that isn't even
	// JSON obviously isn't an envelope either.
	let envelope;

	try {
		const parsed = JSON.parse(fileText);
		if (parsed && typeof parsed === 'object' && typeof parsed.raw === 'string') envelope = parsed;
	} catch {
		// Not JSON at all — falls through to the bare-seed-string branch below.
	}

	const raw = envelope ? envelope.raw : fileText;
	const provider = flags.provider ?? envelope?.provider;
	const model = flags.model ?? envelope?.model;
	const promptVersion = flags['prompt-version'] ?? envelope?.promptVersion;

	const missing = [
		['provider', provider],
		['model', model],
		['prompt-version', promptVersion],
	]
		.filter(([, value]) => !value)
		.map(([name]) => name);

	if (missing.length > 0) {
		throw new UsageError(
			`--raw needs its recorded provenance stated explicitly: missing ${missing
				.map((name) => `--${name}`)
				.join(', ')}`,
		);
	}

	return {
		raw,
		provider,
		model,
		promptVersion,
		imageIds: envelope?.imageIds,
		requestId: envelope?.requestId,
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

	let image = { ...intake.prepared.image, tag: flags.tag };

	let response;
	let imageIds;

	if (flags.raw) {
		({ imageIds, ...response } = await readRawEnvelope(flags));

		// The recorded seed may name this image by the id an earlier run's model call actually saw —
		// `prepareReferenceImage` just minted a new one above, and a replayed seed can only resolve
		// against the id it was generated against. One image today, so the first recorded id is the
		// only one that matters; `imageIds` stays an array for the day this script attaches more
		// than one.
		if (imageIds?.[0]) image = { ...image, id: imageIds[0] };
	} else {
		response = await createCodexReader({ model: flags.model }).read([image], { auth: null });
		imageIds = [image.id];
	}

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
	// `imageIds`, and `requestId` through `response`, ride along whenever this run had one to record
	// (see the module docblock for when that is), so a later `--raw` pointed at this same file
	// inherits whatever provenance this run itself had.
	await writeFile(rawPath, `${JSON.stringify({ ...response, imageIds }, null, 2)}\n`);

	console.log(recordPath);
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
