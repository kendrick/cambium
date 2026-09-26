import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { BrandRecordSchema } from '../core/brand-record';

const execFileAsync = promisify(execFile);

const CLI = fileURLToPath(new URL('./demo-fixture.mjs', import.meta.url));
const REGISTER = fileURLToPath(new URL('./lib/register-ts.mjs', import.meta.url));

// This suite runs the real `magick` binary rather than a stubbed codec (it is on PATH on this dev
// machine, per #18's plan). The test image is small enough to take `prepareReferenceImage`'s
// pass-through branch, so this suite exercises the CLI's own argument handling, provenance
// wiring, and error paths; `scripts/magick-codec.test.ts` already covers the resize and quality
// math under a stubbed `child_process`, so this suite doesn't re-prove that.
//
// A 2x3 red JPEG, the smallest valid file `sniffImageType` in `lib/image-intake.ts` accepts.
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
 * Normalises exactly the three fields the twice-run criterion excepts, id, the image id, and
 * `versions[0].createdAt`, and nothing else, per the wave's constraint against normalising extra
 * fields out of that comparison. Module scope rather than inside the test: it captures nothing
 * from its caller, so oxlint's `consistent-function-scoping` asks for it up here.
 */
function withoutVolatileFields(record: {
	id: string;
	images: { id: string }[];
	versions: { createdAt: string }[];
}) {
	return {
		...record,
		id: null,
		images: record.images.map((refImage) => ({ ...refImage, id: null })),
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
	it('writes a BrandRecordSchema-valid one-image record from a recorded --raw response', async () => {
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
	});

	it('running --raw twice over one image differs only at id, versions[0].createdAt, and the image id', async () => {
		const dir = await makeTempDir();
		const image = await writeTestImage(dir);
		const rawPath = join(dir, 'raw.json');
		await writeFile(rawPath, VALID_SEED_RAW);

		const args = (outDir: string) => [
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
		];

		const outA = join(dir, 'a');
		const outB = join(dir, 'b');

		await runCli(args(outA));
		await runCli(args(outB));

		const recordA = JSON.parse(await readFile(join(outA, 'source.json'), 'utf8'));
		const recordB = JSON.parse(await readFile(join(outB, 'source.json'), 'utf8'));

		// Prove the exclusion isn't vacuous: the three excepted fields really did change run to run.
		expect(recordA.id).not.toBe(recordB.id);
		expect(recordA.images[0].id).not.toBe(recordB.images[0].id);
		expect(recordA.versions[0].createdAt).not.toBe(recordB.versions[0].createdAt);

		expect(withoutVolatileFields(recordA)).toEqual(withoutVolatileFields(recordB));
	});

	it('exits 1, names the failing path, and writes nothing when the --raw response fails schema validation', async () => {
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
	});

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
				// PATH pointed at an empty directory rather than cleared outright: `execFileAsync` still
				// has to resolve `node --import ...` itself on some platforms, and `process.execPath` is
				// already absolute so only the child's own `magick` lookup is affected.
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

	it('exits 1 naming which provenance flag is missing when --raw omits one', async () => {
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
	});
});
