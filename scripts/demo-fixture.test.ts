import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { BrandRecordSchema } from '../core/brand-record';
import { createMagickCodec } from './magick-codec';
import { MAX_EDGE_PX, prepareReferenceImage } from '../lib/image-intake';

const execFileAsync = promisify(execFile);

const CLI = fileURLToPath(new URL('./demo-fixture.mjs', import.meta.url));
const REGISTER = fileURLToPath(new URL('./lib/register-ts.mjs', import.meta.url));

/**
 * A probe, not an assumption: this suite runs the real `magick` binary rather than a stubbed
 * codec, so every test that needs it is guarded by this rather than by whatever happened to be
 * installed on whoever's machine last ran it. `pnpm test`/`verify` must stay green on a fresh
 * checkout that has never installed ImageMagick, so a missing binary skips these tests rather than
 * failing them—the same reason `docs/agents/testing.md` keeps `test:e2e` and its browser binary
 * out of `verify`.
 */
const MAGICK_ON_PATH = (() => {
	try {
		execFileSync('magick', ['-version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

if (!MAGICK_ON_PATH) {
	// `it.skipIf`/`describe.skipIf` report a skip with no message of their own, so this is what
	// makes the reason visible in the run's own output rather than just a silent gap in the count.
	console.warn(
		'scripts/demo-fixture.test.ts: skipping magick-dependent tests—`magick` is not on PATH',
	);
}

// The test image is small enough to take `prepareReferenceImage`'s pass-through branch, so the
// tests below exercise the CLI's own argument handling, provenance wiring, and error paths;
// `scripts/magick-codec.test.ts` already covers the resize and quality math under a stubbed
// `child_process`, so this suite doesn't re-prove that.
//
// A 2x3 red JPEG. Small, not minimal: `sniffImageType` only reads a 12-byte signature, so it would
// accept a file this size or smaller regardless of whether the rest decodes to anything.
const TEST_JPEG_BASE64 =
	'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJ' +
	'DRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ' +
	'EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAADAAIDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAU' +
	'EAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcJ/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwD' +
	'AQACEQMRAD8AnRDGqYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//Z';

/** All ten `BrandSeed` fields present and null, matching `VALID_SEED` in codex-reader.test.ts. A
 * `keyColors: null` seed is what makes this fixture safe to replay: `prepareReferenceImage` mints
 * a fresh random image id on every run, so a recorded `keyColors[].sourceImageId` from an earlier
 * run could never match this run's id, and `BrandRecordSchema` refuses a seed pointing at an
 * image the record doesn't hold. */
const VALID_SEED_RAW = JSON.stringify({
	keyColors: null,
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
});

const INVALID_SEED_RAW = JSON.stringify({
	keyColors: null,
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: 'sideways', // not one of BrandSeedSchema's enum values
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
});

/**
 * A placeholder rather than a real UUID: nothing here decodes it, `BrandRecordSchema` only checks
 * that a seed's image-id references match some id in `record.images`, and a readable constant
 * makes the assertions below easier to follow than a random hex string would.
 */
const REPLAYED_IMAGE_ID = 'replayed-image-id';

/**
 * Unlike `VALID_SEED_RAW`, this seed's `keyColors` and `imageClassifications` name a specific
 * image id. Pairing it with `ENVELOPE_WITH_IMAGE_REFS_RAW` below is what the twice-run test needs
 * to prove the `imageIds` override actually works: a seed with no image-id references can't tell a
 * working override from a missing one, because `BrandRecordSchema` never checks an id nothing
 * points at.
 */
const SEED_WITH_IMAGE_REFS_RAW = JSON.stringify({
	keyColors: [
		{
			oklch: [0.55, 0.12, 210],
			proposedRole: 'brand',
			sourceImageId: REPLAYED_IMAGE_ID,
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: [{ imageId: REPLAYED_IMAGE_ID, detected: 'photo' }],
	expressive: null,
});

/**
 * The envelope shape a live run now writes beside its record (see the docblock atop
 * `demo-fixture.mjs`): `raw` plus provenance, a `requestId`, and the image id(s) that seed's
 * references resolve against. `--raw` reads `imageIds` back out of this and stamps it onto the
 * freshly prepared image, which is the fix under test—replayed against `VALID_SEED_RAW`'s
 * all-null shape, the same fix would have nothing to prove itself against. `requestId` rides along
 * here so the "carries requestId through" test below has a real value to check for.
 */
const ENVELOPE_WITH_IMAGE_REFS_RAW = JSON.stringify({
	raw: SEED_WITH_IMAGE_REFS_RAW,
	provider: 'codex',
	model: 'gpt-5.6-terra',
	promptVersion: 'seed-v4',
	requestId: 'thread-replay-abc',
	imageIds: [REPLAYED_IMAGE_ID],
});

/**
 * `sha256:` plus the hex digest of `TEST_JPEG_BASE64`'s decoded bytes, computed once (`node -e`
 * over the same base64 string) and pinned here rather than derived at test time — deriving it here
 * would just be `prepareReferenceImage`'s own hash step re-run, which proves this suite agrees with
 * itself and not that the image and the envelope actually match.
 */
const TEST_JPEG_ORIGINAL_HASH =
	'sha256:bb97afa54be51ddde44d31dad47114303bc584334ca9255c5a811f2d8c4dece3';

/** A hash that cannot equal any real image's: 64 zeros is not a digest `sha256Hex` ever produces. */
const WRONG_ORIGINAL_HASH = `sha256:${'0'.repeat(64)}`;

/**
 * `ENVELOPE_WITH_IMAGE_REFS_RAW` plus the `originalHashes` a live run now records beside
 * `imageIds` (#144 review; see the module docblock atop `demo-fixture.mjs`). Pointed at
 * `writeTestImage`'s own file, whose hash is `TEST_JPEG_ORIGINAL_HASH`, this is the envelope a
 * correctly-bound replay reads.
 */
const ENVELOPE_WITH_MATCHING_HASH_RAW = JSON.stringify({
	raw: SEED_WITH_IMAGE_REFS_RAW,
	provider: 'codex',
	model: 'gpt-5.6-terra',
	promptVersion: 'seed-v4',
	requestId: 'thread-replay-hash',
	imageIds: [REPLAYED_IMAGE_ID],
	originalHashes: [TEST_JPEG_ORIGINAL_HASH],
});

/**
 * Same envelope, but recorded against an image `writeTestImage`'s file is not — the case the fix
 * under test refuses: pairing `--raw` with a different or since-replaced image binds that image's
 * new bytes to a seed that still describes the old one.
 */
const ENVELOPE_WITH_MISMATCHED_HASH_RAW = JSON.stringify({
	raw: SEED_WITH_IMAGE_REFS_RAW,
	provider: 'codex',
	model: 'gpt-5.6-terra',
	promptVersion: 'seed-v4',
	requestId: 'thread-replay-hash-mismatch',
	imageIds: [REPLAYED_IMAGE_ID],
	originalHashes: [WRONG_ORIGINAL_HASH],
});

/**
 * Normalises exactly the two fields a `--raw` replay is still allowed to vary on: the record `id`
 * and `versions[0].createdAt`. The image `id` was a third exception here before the `imageIds`
 * override existed, back when `prepareReferenceImage` minting a fresh one on every run made holding
 * it stable impossible; now that a replay stamps the envelope's recorded `imageIds` back onto the
 * image, the twice-run test asserts that id's equality directly instead of normalising it away,
 * since normalising it away is exactly what would hide the bug coming back.
 */
function withoutVolatileFields(record: { id: string; versions: { createdAt: string }[] }) {
	return {
		...record,
		id: null,
		versions: record.versions.map((version) => ({ ...version, createdAt: null })),
	};
}

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'cambium-demo-fixture-'));
	tempDirs.push(dir);
	return dir;
}

async function writeTestImage(dir: string): Promise<string> {
	const path = join(dir, 'source.jpg');
	await writeFile(path, Buffer.from(TEST_JPEG_BASE64, 'base64'));
	return path;
}

function runCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
	return execFileAsync(process.execPath, ['--import', REGISTER, CLI, ...args], { env });
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('fixture:demo CLI', () => {
	it.skipIf(!MAGICK_ON_PATH)(
		'writes a BrandRecordSchema-valid one-image record from a recorded --raw response',
		async () => {
			const dir = await makeTempDir();
			const image = await writeTestImage(dir);
			const rawPath = join(dir, 'raw.json');
			await writeFile(rawPath, VALID_SEED_RAW);

			const outDir = join(dir, 'out');

			await runCli([
				image,
				'--tag',
				'photo',
				'--raw',
				rawPath,
				'--provider',
				'codex',
				'--model',
				'gpt-5.6-terra',
				'--prompt-version',
				'seed-v4',
				'--out',
				outDir,
			]);

			const record = JSON.parse(await readFile(join(outDir, 'source.json'), 'utf8'));

			expect(() => BrandRecordSchema.parse(record)).not.toThrow();
			expect(record.images).toHaveLength(1);
			expect(record.images[0].tag).toBe('photo');
			expect(record.versions).toHaveLength(1);
			expect(record.versions[0]).toMatchObject({
				provider: 'codex',
				model: 'gpt-5.6-terra',
				promptVersion: 'seed-v4',
				rawResponse: VALID_SEED_RAW,
			});

			const rawEnvelope = JSON.parse(await readFile(join(outDir, 'source.raw.json'), 'utf8'));
			expect(rawEnvelope).toMatchObject({ raw: VALID_SEED_RAW, provider: 'codex' });
		},
	);

	it.skipIf(!MAGICK_ON_PATH)(
		'running --raw twice over one image differs only at id and versions[0].createdAt, holding the image id stable',
		async () => {
			const dir = await makeTempDir();
			const image = await writeTestImage(dir);
			const rawPath = join(dir, 'raw.json');
			await writeFile(rawPath, ENVELOPE_WITH_IMAGE_REFS_RAW);

			// No --provider/--model/--prompt-version: the envelope supplies all three, proving that path
			// works too, alongside the explicit-flag path the other tests in this suite exercise.
			const args = (outDir: string) => [image, '--tag', 'ui', '--raw', rawPath, '--out', outDir];

			const outA = join(dir, 'a');
			const outB = join(dir, 'b');

			await runCli(args(outA));
			await runCli(args(outB));

			const recordA = JSON.parse(await readFile(join(outA, 'source.json'), 'utf8'));
			const recordB = JSON.parse(await readFile(join(outB, 'source.json'), 'utf8'));

			// Prove the exclusion isn't vacuous: the two excepted fields really did change run to run.
			expect(recordA.id).not.toBe(recordB.id);
			expect(recordA.versions[0].createdAt).not.toBe(recordB.versions[0].createdAt);

			// The `imageIds` override, asserted directly rather than normalised away: without it,
			// `prepareReferenceImage`'s fresh mint would make these differ on every run, and the seed's
			// `keyColors[0].sourceImageId` / `imageClassifications[0].imageId` would point at whichever
			// run's id lost, which is exactly what made a real fixture's replay fail `BrandRecordSchema`.
			expect(recordA.images[0].id).toBe(REPLAYED_IMAGE_ID);
			expect(recordB.images[0].id).toBe(REPLAYED_IMAGE_ID);

			expect(withoutVolatileFields(recordA)).toEqual(withoutVolatileFields(recordB));
		},
	);

	it.skipIf(!MAGICK_ON_PATH)(
		'carries requestId through a --raw replay into the rewritten .raw.json',
		async () => {
			const dir = await makeTempDir();
			const image = await writeTestImage(dir);
			const rawPath = join(dir, 'raw.json');
			await writeFile(rawPath, ENVELOPE_WITH_IMAGE_REFS_RAW);

			const outDir = join(dir, 'out');

			await runCli([image, '--tag', 'ui', '--raw', rawPath, '--out', outDir]);

			const rawEnvelope = JSON.parse(await readFile(join(outDir, 'source.raw.json'), 'utf8'));

			expect(rawEnvelope.requestId).toBe('thread-replay-abc');
		},
	);

	it.skipIf(!MAGICK_ON_PATH)(
		'exits 1 naming both hashes and the raw path, and writes nothing, when --raw is bound to a different image',
		async () => {
			const dir = await makeTempDir();
			const image = await writeTestImage(dir);
			const rawPath = join(dir, 'raw.json');
			await writeFile(rawPath, ENVELOPE_WITH_MISMATCHED_HASH_RAW);

			const outDir = join(dir, 'out');

			const error = await runCli([image, '--tag', 'ui', '--raw', rawPath, '--out', outDir]).catch(
				(caught) => caught,
			);

			expect(error).toMatchObject({ code: 1 });
			expect(error.stderr).toContain(rawPath);
			expect(error.stderr).toContain(WRONG_ORIGINAL_HASH);
			expect(error.stderr).toContain(TEST_JPEG_ORIGINAL_HASH);

			await expect(readdir(outDir)).rejects.toMatchObject({ code: 'ENOENT' });
		},
	);

	it.skipIf(!MAGICK_ON_PATH)(
		'replays successfully and preserves the hashes when --raw is bound to the image it describes',
		async () => {
			const dir = await makeTempDir();
			const image = await writeTestImage(dir);
			const rawPath = join(dir, 'raw.json');
			await writeFile(rawPath, ENVELOPE_WITH_MATCHING_HASH_RAW);

			const outDir = join(dir, 'out');

			await runCli([image, '--tag', 'ui', '--raw', rawPath, '--out', outDir]);

			const record = JSON.parse(await readFile(join(outDir, 'source.json'), 'utf8'));
			expect(() => BrandRecordSchema.parse(record)).not.toThrow();

			const rawEnvelope = JSON.parse(await readFile(join(outDir, 'source.raw.json'), 'utf8'));
			expect(rawEnvelope.originalHashes).toEqual([TEST_JPEG_ORIGINAL_HASH]);
			expect(rawEnvelope.imageIds).toEqual([REPLAYED_IMAGE_ID]);
		},
	);

	it.skipIf(!MAGICK_ON_PATH)(
		'warns and replays successfully when an older --raw envelope carries imageIds but no originalHashes',
		async () => {
			const dir = await makeTempDir();
			const image = await writeTestImage(dir);
			const rawPath = join(dir, 'raw.json');
			await writeFile(rawPath, ENVELOPE_WITH_IMAGE_REFS_RAW);

			const outDir = join(dir, 'out');

			const { stderr } = await runCli([image, '--tag', 'ui', '--raw', rawPath, '--out', outDir]);

			expect(stderr).toContain('no recorded originalHash');

			const record = JSON.parse(await readFile(join(outDir, 'source.json'), 'utf8'));
			expect(() => BrandRecordSchema.parse(record)).not.toThrow();

			// The backfill this unblocks (#144's plan step 4) is exactly this: replaying an old
			// envelope into itself. That only backfills a hash for a later replay to check against if
			// this run's own rewritten envelope carries one, computed off the image actually at hand.
			const rawEnvelope = JSON.parse(await readFile(join(outDir, 'source.raw.json'), 'utf8'));
			expect(rawEnvelope.originalHashes).toEqual([TEST_JPEG_ORIGINAL_HASH]);
		},
	);

	it.skipIf(!MAGICK_ON_PATH)(
		'exits 1, names the failing path, and writes nothing when the --raw response fails schema validation',
		async () => {
			const dir = await makeTempDir();
			const image = await writeTestImage(dir);
			const rawPath = join(dir, 'raw-invalid.json');
			await writeFile(rawPath, INVALID_SEED_RAW);

			const outDir = join(dir, 'out');

			await expect(
				runCli([
					image,
					'--tag',
					'ui',
					'--raw',
					rawPath,
					'--provider',
					'codex',
					'--model',
					'gpt-5.6-terra',
					'--prompt-version',
					'seed-v4',
					'--out',
					outDir,
				]),
			).rejects.toMatchObject({
				code: 1,
				stderr: expect.stringContaining(rawPath),
			});

			await expect(readdir(outDir)).rejects.toMatchObject({ code: 'ENOENT' });
		},
	);

	it('exits 1 naming magick when it is not on PATH, and writes nothing', async () => {
		const dir = await makeTempDir();
		const image = await writeTestImage(dir);
		const rawPath = join(dir, 'raw.json');
		await writeFile(rawPath, VALID_SEED_RAW);

		const outDir = join(dir, 'out');
		const emptyPathDir = await makeTempDir();

		await expect(
			runCli(
				[
					image,
					'--tag',
					'ui',
					'--raw',
					rawPath,
					'--provider',
					'codex',
					'--model',
					'gpt-5.6-terra',
					'--prompt-version',
					'seed-v4',
					'--out',
					outDir,
				],
				// PATH pointed at an empty directory rather than cleared outright: `process.execPath` is
				// already absolute, so `execFileAsync` never consults PATH to find node itself. Only the
				// CLI's own `spawn('magick', ...)`—a bare command name—resolves against this PATH,
				// which is the lookup this test means to break. Independent of whether the host running
				// this suite has magick installed: it runs and passes either way.
				{ ...process.env, PATH: emptyPathDir },
			),
		).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('magick'),
		});

		await expect(readdir(outDir)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('exits 1 with usage when called without an image path', async () => {
		await expect(runCli([])).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('usage'),
		});
	});

	it('exits 1 naming the allowed tags when --tag is missing or invalid', async () => {
		const dir = await makeTempDir();
		const image = await writeTestImage(dir);

		await expect(runCli([image, '--tag', 'bogus'])).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('--tag must be one of'),
		});
	});

	it.skipIf(!MAGICK_ON_PATH)(
		'exits 1 naming which provenance flag is missing when --raw omits one',
		async () => {
			const dir = await makeTempDir();
			const image = await writeTestImage(dir);
			const rawPath = join(dir, 'raw.json');
			await writeFile(rawPath, VALID_SEED_RAW);

			await expect(
				runCli([image, '--tag', 'ui', '--raw', rawPath, '--provider', 'codex']),
			).rejects.toMatchObject({
				code: 1,
				stderr: expect.stringContaining('--model'),
			});
		},
	);
});

/**
 * One real-magick round trip through `prepareReferenceImage`, checked in the consumer's units:
 * `magick identify` on the decoded bytes, not the sizes this codec asked magick for. Everything
 * else in this file drives the CLI as a subprocess; this drives `createMagickCodec` and
 * `prepareReferenceImage` directly, because the assertions below need the intermediate decoded
 * data URL, which the CLI never exposes.
 */
describe('createMagickCodec via prepareReferenceImage (real magick)', () => {
	it.skipIf(!MAGICK_ON_PATH)(
		'downscales an oversized image to a WebP that magick identify confirms fits MAX_EDGE_PX, aspect preserved',
		async () => {
			const dir = await makeTempDir();
			const sourcePath = join(dir, 'oversized.png');
			const sourceWidth = 3000;
			const sourceHeight = 2000;

			// Built with magick itself rather than checked into the repo: it only has to be larger than
			// MAX_EDGE_PX on its long edge, and generating it here keeps a multi-megabyte binary out of
			// the repo for the sake of one size check.
			await execFileAsync('magick', [
				'-size',
				`${sourceWidth}x${sourceHeight}`,
				'xc:red',
				sourcePath,
			]);

			const blob = new Blob([await readFile(sourcePath)], { type: 'image/png' });
			const result = await prepareReferenceImage(blob, createMagickCodec());

			if (result.kind !== 'prepared') {
				throw new Error(`expected prepareReferenceImage to prepare the image, got ${result.kind}`);
			}

			const match = /^data:image\/webp;base64,(.+)$/.exec(result.prepared.image.downscaled);

			if (!match) throw new Error('downscaled image was not stored as a WebP data URL');

			const decodedBytes = Buffer.from(match[1]!, 'base64');

			// The consumer here is whatever decodes this data URL next, and a WebP consumer reads the
			// RIFF container header before anything codec-specific—the same header this checks,
			// rather than trusting the data URL's own declared media type.
			expect(decodedBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
			expect(decodedBytes.subarray(8, 12).toString('ascii')).toBe('WEBP');

			const decodedPath = join(dir, 'decoded.webp');
			await writeFile(decodedPath, decodedBytes);

			const { stdout } = await execFileAsync('magick', [
				'identify',
				'-format',
				'%w %h',
				decodedPath,
			]);
			const [width, height] = stdout.trim().split(/\s+/).map(Number);

			expect(Math.max(width!, height!)).toBe(MAX_EDGE_PX);

			const expectedShortEdge = Math.round((sourceHeight / sourceWidth) * MAX_EDGE_PX);
			expect(Math.abs(height! - expectedShortEdge)).toBeLessThanOrEqual(1);
		},
	);
});
