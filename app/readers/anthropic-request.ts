import type { ReferenceImage } from '../../core/brand-record';
import {
	SEED_JSON_SCHEMA,
	SEED_SYSTEM_PROMPT,
	SEED_TOOL_DESCRIPTION,
	SEED_TOOL_NAME,
	SEED_USER_DIRECTIVE,
} from './seed-prompt';

/**
 * The Messages API accepts exactly these four raster types for an image block. Anything else
 * (an SVG data URL, say) is a caller bug: `core/purity.test.ts` fixtures and every reader
 * upstream of this module are supposed to have downscaled to one of these already.
 */
const ACCEPTED_IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

type AcceptedImageMediaType = (typeof ACCEPTED_IMAGE_MEDIA_TYPES)[number];

export type AnthropicOutputMode = 'structured' | 'forced-tool';

export type SeedRequestInput = {
	images: ReferenceImage[];
	model: string;
	outputMode: AnthropicOutputMode;
};

/**
 * A seed is a handful of fields, not a document, so the response itself needs little headroom.
 * 16000 is Anthropic's documented default for a non-streaming request and leaves room for the
 * seed's pairing arrays (`suggestedPairing` can hold several ranked candidates per role) without
 * approaching the ceiling where a non-streaming call risks a timeout.
 */
export const SEED_REQUEST_MAX_TOKENS = 16000;

function isAcceptedImageMediaType(value: string): value is AcceptedImageMediaType {
	return (ACCEPTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * `downscaled` is a data URL (`data:image/webp;base64,AA`), not bare base64, because
 * `ReferenceImageSchema` stores exactly what was sent to the model, header included. The
 * Messages API wants the header and the payload apart, so every image block construction has to
 * split it back out; this is the one place that does, so a malformed URL fails at the boundary
 * where the offending image id is still in scope, rather than as an opaque 400 from the API.
 */
function splitDownscaledDataUrl(image: ReferenceImage): {
	mediaType: AcceptedImageMediaType;
	data: string;
} {
	const match = /^data:([^;,]+);base64,(.+)$/s.exec(image.downscaled);

	if (!match) {
		throw new Error(`reference image "${image.id}" is not a base64 image data URL`);
	}

	const [, mediaType, data] = match;

	if (!isAcceptedImageMediaType(mediaType)) {
		throw new Error(
			`reference image "${image.id}" has media type "${mediaType}", which the Messages API does not accept as an image`,
		);
	}

	return { mediaType, data };
}

function buildContent(images: ReferenceImage[]) {
	// Zero images would still pass a well-formed body to the API, but the response could never
	// carry provenance for anything: `keyColors.sourceImageId` and `imageClassifications.imageId`
	// both have to name a real image, and there is none to name. Refusing locally turns that into
	// a clear message at the call site instead of a confusing 400 (an empty `content` array) from
	// the API, or a seed the core would reject anyway.
	if (images.length === 0) {
		throw new Error('buildSeedRequestBody requires at least one reference image');
	}

	const blocks: Record<string, unknown>[] = [];

	for (const image of images) {
		const { mediaType, data } = splitDownscaledDataUrl(image);

		blocks.push({ type: 'text', text: `Image id: ${image.id}` });
		blocks.push({
			type: 'image',
			source: { type: 'base64', media_type: mediaType, data },
		});
	}

	blocks.push({ type: 'text', text: SEED_USER_DIRECTIVE });

	return blocks;
}

/**
 * Builds the request body for `POST /v1/messages` only. No `fetch`, no headers, no API key: the
 * next wave's reader owns transport, and keeping this module blind to the key is what makes "no
 * key reaches the payload" a property a test can check here rather than a claim the reader has
 * to be trusted on.
 */
export function buildSeedRequestBody(input: SeedRequestInput): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: input.model,
		max_tokens: SEED_REQUEST_MAX_TOKENS,
		system: SEED_SYSTEM_PROMPT,
		messages: [{ role: 'user', content: buildContent(input.images) }],
	};

	// `temperature`, `top_p`, and `top_k` are removed on claude-opus-5 and any of the three
	// returns a 400. Issue #1 says temperature is pinned to zero "because it is free" — that line
	// predates this model and this code deliberately does not follow it.
	if (input.outputMode === 'structured') {
		body.output_config = {
			format: { type: 'json_schema', schema: SEED_JSON_SCHEMA },
			effort: 'high',
		};
		// Opus 5 only accepts `thinking: disabled` at effort `high` or below, so the two are
		// pinned together: raising `effort` past `high` while thinking is disabled is a 400.
		body.thinking = { type: 'disabled' };
	} else {
		body.tools = [
			{
				name: SEED_TOOL_NAME,
				description: SEED_TOOL_DESCRIPTION,
				input_schema: SEED_JSON_SCHEMA,
				strict: true,
			},
		];
		body.tool_choice = { type: 'tool', name: SEED_TOOL_NAME };
		// `thinking` is left unset rather than `{ type: 'adaptive' }`: Opus 5's default is already
		// adaptive, and a forced tool choice is the one axis this mode already trades away (a
		// `tool_choice` of `tool`/`any` is a 400 on Claude Fable 5.1), so it should not also pin
		// down thinking mode for no reason.
	}

	// `stream` is deliberately absent: issue #17 puts streaming out of scope for a seed request,
	// since the whole response is small enough to arrive in one shot.

	return body;
}
