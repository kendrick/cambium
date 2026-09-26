import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMagickCodec, MagickExecError } from './magick-codec';

// `magick-codec.ts` shells out for real, so every test here replaces the module the same way
// `scripts/codex-reader.test.ts` does for `codex exec`: a stray call reaching an actual `magick`
// binary would make these tests depend on what happens to be installed, rather than on what this
// codec sends it.
vi.mock('node:child_process', () => ({
	spawn: vi.fn<(file: string, args: string[], options?: unknown) => EventEmitter>(),
}));

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

function fakeChild() {
	const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();

	return proc;
}

afterEach(() => {
	spawnMock.mockReset();
});

describe('createMagickCodec', () => {
	describe('decode', () => {
		it('writes the blob to a temp file and reads its width and height off magick info:', async () => {
			let capturedArgs: string[] = [];
			let capturedFile = '';

			spawnMock.mockImplementation((file: string, args: string[]) => {
				capturedFile = file;
				capturedArgs = args;

				// The input file exists, with the blob's own bytes, before magick "runs" — proof this
				// codec wrote real bytes rather than just naming a path in argv.
				expect(existsSync(args[0]!)).toBe(true);

				const proc = fakeChild();

				queueMicrotask(() => {
					proc.stdout.emit('data', Buffer.from('64 48\n'));
					proc.emit('close', 0);
				});

				return proc;
			});

			const codec = createMagickCodec();
			const blob = new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
			const decoded = await codec.decode(blob);

			expect(capturedFile).toBe('magick');
			expect(capturedArgs.slice(1)).toEqual(['-format', '%w %h', 'info:']);
			expect(decoded).toMatchObject({ width: 64, height: 48 });
			decoded.close();

			// The temp dir is removed once decode resolves, so nothing this run wrote survives it.
			expect(existsSync(capturedArgs[0]!)).toBe(false);
		});

		it('asks magick to resize before reporting dimensions when a resize is requested', async () => {
			let capturedArgs: string[] = [];

			spawnMock.mockImplementation((_file: string, args: string[]) => {
				capturedArgs = args;

				const proc = fakeChild();

				queueMicrotask(() => {
					proc.stdout.emit('data', Buffer.from('10 10\n'));
					proc.emit('close', 0);
				});

				return proc;
			});

			const codec = createMagickCodec();
			const blob = new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
			const decoded = await codec.decode(blob, { width: 10, height: 10 });

			expect(capturedArgs.slice(1)).toEqual(['-resize', '10x10!', '-format', '%w %h', 'info:']);
			expect(decoded).toMatchObject({ width: 10, height: 10 });
		});
	});

	describe('encode', () => {
		it('resizes to the requested size, writes WebP at the scaled quality, and returns those bytes', async () => {
			let capturedArgs: string[] = [];
			const encodedBytes = Buffer.from('fake-webp-bytes');

			spawnMock.mockImplementation((_file: string, args: string[]) => {
				capturedArgs = args;

				const inputPath = args[0]!;
				const outputPath = args.at(-1)!;

				expect(existsSync(inputPath)).toBe(true);

				// magick writes the resized file at the output path this codec named; the test stands
				// in for that by writing it directly, the same way codex-reader.test.ts writes the
				// `-o` path before its own fake child closes.
				writeFileSync(outputPath, encodedBytes);

				const proc = fakeChild();

				queueMicrotask(() => proc.emit('close', 0));

				return proc;
			});

			const codec = createMagickCodec();
			const source = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
			const encoded = await codec.encode(source, { width: 32, height: 24 });

			expect(capturedArgs.slice(1, -1)).toEqual(['-resize', '32x24!', '-quality', '85']);
			expect(encoded.type).toBe('image/webp');
			expect(Buffer.from(await encoded.arrayBuffer())).toEqual(encodedBytes);

			// Same cleanup guarantee as decode: the temp dir is gone once encode resolves.
			expect(existsSync(capturedArgs[0]!)).toBe(false);
			expect(existsSync(capturedArgs.at(-1)!)).toBe(false);
		});
	});

	// One case covers both decode and encode: both run every call through the same `runMagick`,
	// so proving the ENOENT message once is proving it for either entry point.
	it('names magick by name when the binary is not on PATH', async () => {
		spawnMock.mockImplementation(() => {
			const proc = fakeChild();
			const error = new Error('spawn magick ENOENT') as NodeJS.ErrnoException;
			error.code = 'ENOENT';

			queueMicrotask(() => proc.emit('error', error));

			return proc;
		});

		const codec = createMagickCodec();
		const blob = new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

		await expect(codec.decode(blob)).rejects.toThrow(MagickExecError);
		await expect(codec.decode(blob)).rejects.toThrow(/magick is not installed, or not on PATH/);
	});

	it('rejects with magick stderr in the message on a non-zero exit', async () => {
		spawnMock.mockImplementation(() => {
			const proc = fakeChild();

			queueMicrotask(() => {
				proc.stderr.emit('data', Buffer.from('unable to open image'));
				proc.emit('close', 1);
			});

			return proc;
		});

		const codec = createMagickCodec();
		const blob = new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

		await expect(codec.decode(blob)).rejects.toThrow(/unable to open image/);
	});
});
