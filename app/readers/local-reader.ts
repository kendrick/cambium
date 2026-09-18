import type { BrandReader } from '../../core/brand-reader';
import type { ReferenceImage } from '../../core/brand-record';

export const LOCAL_PROVIDER = 'local';

/**
 * No model answers a local read, and the field still has to say what did. These are the two
 * quantizers whose agreement produced the seed, which is what somebody diagnosing a stored version
 * needs to explain why one image gave two different answers on two different days.
 */
export const LOCAL_EXTRACTOR_MODEL = 'colorthief-mmcq+vibrant-mmcq';

/**
 * The heuristic's version, standing where a prompt version stands for a model reader.
 *
 * Move it whenever anything changes what the same pixels yield: the chroma floor, the scoring
 * weights, the corroboration rule, or the pinned version of either extraction library. ADR-0002
 * pins those exactly, so a library moving is always a deliberate commit and can carry this bump
 * with it. Without that, a stored version would claim reproducibility it does not have.
 */
export const LOCAL_EXTRACT_VERSION = 'local-extract-v1';

/**
 * Decoding is the only part of a local read that needs a browser, so it is the only part injected.
 *
 * A test drives the reader with pixel buffers instead of standing up a canvas; the default below
 * is the real thing. `docs/agents/testing.md` leaves an I/O shell untested, and this keeps the
 * shell down to what genuinely is one.
 */
export type ReferenceImageDecoder = (
	image: ReferenceImage,
) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>;

export type LocalReaderConfig = {
	decode?: ReferenceImageDecoder;
};

/**
 * Turns a stored `data:` URL back into bytes without `fetch`.
 *
 * `fetch` reads a data URL perfectly well and makes no request. But the ticket's criterion is that
 * extraction runs "with no network request", and a claim resting on everyone who edits this file
 * knowing that `fetch` short-circuits `data:` is one refactor from being false. `atob` cannot
 * reach the network at all.
 */
function dataUrlToBlob(dataUrl: string): Blob {
	const comma = dataUrl.indexOf(',');

	if (comma === -1 || !dataUrl.startsWith('data:')) {
		throw new Error('a stored reference image must be a base64 data URL');
	}

	const mediaType = dataUrl.slice('data:'.length, comma).split(';')[0];
	const binary = atob(dataUrl.slice(comma + 1));
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}

	return new Blob([bytes], { type: mediaType });
}

async function decodeInBrowser(image: ReferenceImage) {
	const bitmap = await createImageBitmap(dataUrlToBlob(image.downscaled));

	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext('2d');

		if (!context) {
			throw new Error('a 2d canvas context is required to read pixels out of an image');
		}

		context.drawImage(bitmap, 0, 0);

		return context.getImageData(0, 0, bitmap.width, bitmap.height);
	} finally {
		// An ImageBitmap holds its decoded pixels outside the JS heap, so the collector has no
		// reason to hurry. A visitor comparing a dozen uploads would otherwise carry every one of
		// them until the tab closed.
		bitmap.close();
	}
}

/**
 * The reader interface, implemented with no credential and no network.
 *
 * Colours only, and the seam says so by what it returns rather than by implying parity. Every
 * field a colour cannot inform comes back null, which is how the gap between this path and the
 * keyed one stays visible downstream. #33's non-goals rule out type classification, radius,
 * shadow, tracking and surface polarity, none of which survives a quantizer.
 *
 * `options.auth` is ignored. `core/brand-reader.ts` makes an absent provider first-class for
 * exactly this implementation, and a key that happens to be present buys a local read nothing, so
 * refusing one would be a rule with no purpose behind it.
 */
export function createLocalBrandReader(config: LocalReaderConfig = {}): BrandReader {
	const decode = config.decode ?? decodeInBrowser;

	return {
		async read(images) {
			// Dynamic, so neither extraction library nor culori reaches first-load JavaScript. The
			// landing route holds the button that starts a keyless read and none of the weight
			// behind it; see ADR-0002 on the headroom this budget deliberately leaves.
			const { chooseKeyColors, readImageOpinions, seedPayload } = await import('./local-extract');

			const opinions = await Promise.all(
				images.map(async (image) => readImageOpinions(image.id, await decode(image))),
			);

			return {
				raw: seedPayload(chooseKeyColors(opinions)),
				provider: LOCAL_PROVIDER,
				model: LOCAL_EXTRACTOR_MODEL,
				promptVersion: LOCAL_EXTRACT_VERSION,
			};
		},
	};
}
