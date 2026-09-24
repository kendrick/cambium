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

/**
 * A seed the model did answer with, handed back for one correction. `rawResponse` is the seed text
 * the reader took from that answer: a text block verbatim, or a tool call's input re-serialized.
 * It's never the response envelope, since a response with no seed text has nothing to correct.
 * `issues` is why the core or the record refused it, one line each, already worded for the model.
 */
export type SeedRepair = {
	rawResponse: string;
	issues: string[];
};

export type SeedRequestInput = {
	images: ReferenceImage[];
	model: string;
	outputMode: AnthropicOutputMode;
	repair?: SeedRepair;
};

/**
 * A seed is a handful of fields, not a document, so the response itself needs little headroom.
 * The API documents no default here, so some value has to be picked: 16000 is Anthropic's
 * recommendation for a non-streaming request, and it leaves room for the seed's pairing arrays
 * (`suggestedPairing` can hold several ranked candidates per role) without approaching the
 * ceiling where a non-streaming call risks an HTTP timeout.
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

function repairDirective(issues: string[]): string {
	const listed =
		issues.length > 0
			? issues.map((issue) => `- ${issue}`).join('\n')
			: '- The response could not be read as a seed.';

	return [
		'Your previous response could not be used as a brand seed, for these reasons:',
		listed,
		'Reply with a corrected seed for the same reference images, in the same format as before.',
	].join('\n\n');
}

/**
 * The repair is a conversation rather than a patched prompt: the original turn unchanged, the
 * model's own answer, then a user turn naming what was wrong with it. Ending on a user turn is the
 * point. An assistant turn last would be a prefill, and Opus 5.5 rejects prefill with a 400.
 *
 * The assistant turn carries no thinking block, because the reader never kept one. The API accepts
 * a history with thinking stripped, which is its own documented recovery for a history it cannot
 * bind, so this costs the model its earlier reasoning and nothing else.
 */
function buildMessages(content: Record<string, unknown>[], repair: SeedRepair | undefined) {
	const original = { role: 'user', content };

	if (!repair) {
		return [original];
	}

	// An empty text block is a 400 from the API, and a blank answer gives the model nothing to
	// correct anyway. Failing here names the caller's mistake instead of spending a request on it.
	if (repair.rawResponse.trim().length === 0) {
		throw new Error('a repair needs the response being repaired, and this one is empty');
	}

	return [
		original,
		{ role: 'assistant', content: [{ type: 'text', text: repair.rawResponse }] },
		{ role: 'user', content: [{ type: 'text', text: repairDirective(repair.issues) }] },
	];
}

/**
 * Builds the request body for `POST /v1/messages` only. No `fetch`, no headers, no API key: the
 * reader owns transport, and keeping this module blind to the key is what makes "no key reaches
 * the payload" a property a test can check here rather than a claim the reader has to be trusted
 * on.
 *
 * Neither branch below sends `temperature`, `top_p`, or `top_k`. All three are removed on
 * claude-opus-5 and any of them returns a 400. Issue #1 pins temperature to zero "because it is
 * free"—that line predates this model, and this code deliberately does not follow it.
 *
 * Neither branch sends a `thinking` key either, so Opus 5 runs its adaptive default, which is
 * what a vision task wants. Anthropic's structured outputs documentation records no
 * incompatibility with extended thinking, and the thinking documentation does not exclude
 * structured outputs, so there is no constraint here to work around. Disabling thinking on Opus 5
 * would cost something real: it can leak `<thinking>` tags into the visible response, and it can
 * write a tool call as visible text instead of a `tool_use` block. No live call has confirmed
 * that structured outputs and adaptive thinking work together on this model. The claim here is
 * only that nothing documented forbids it.
 */
export function buildSeedRequestBody(input: SeedRequestInput): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: input.model,
		max_tokens: SEED_REQUEST_MAX_TOKENS,
		system: SEED_SYSTEM_PROMPT,
		messages: buildMessages(buildContent(input.images), input.repair),
	};

	if (input.outputMode === 'structured') {
		body.output_config = {
			format: { type: 'json_schema', schema: SEED_JSON_SCHEMA },
			// `high` is already the default, stated rather than omitted so that a change to what the
			// API defaults to cannot silently re-price a structured read. Forced-tool sends no
			// `output_config` at all and stays exposed to that drift, which is one more thing the
			// two modes do not share.
			effort: 'high',
		};
	} else {
		body.tools = [
			{
				name: SEED_TOOL_NAME,
				description: SEED_TOOL_DESCRIPTION,
				input_schema: SEED_JSON_SCHEMA,
				strict: true,
			},
		];
		// Forcing the call is the one axis this mode trades away: `tool_choice` of `tool` or `any`
		// is a 400 on Claude Fable 5.1, so a model swap there costs this branch and not the other.
		body.tool_choice = { type: 'tool', name: SEED_TOOL_NAME };
	}

	// `stream` is deliberately absent: issue #17 puts streaming out of scope for a seed request,
	// since the whole response is small enough to arrive in one shot.

	return body;
}

/**
 * How many characters of text a request body carries, for the cost estimate. Counted from the body
 * this module would actually send, so the estimate follows the prompt, the schema, the per-image id
 * lines and any repair turns as they change, with nothing restated by hand.
 *
 * Image blocks are left out, since the API prices an image by its pixels, not by the length of its
 * base64. Everything else is text the model reads, including the schema inside `output_config` or
 * `tools`, so it's counted as JSON.
 */
export function seedRequestTextChars(input: SeedRequestInput): number {
	const { system, messages, output_config, tools } = buildSeedRequestBody(input) as {
		system: string;
		messages: { content: { type: string; text?: string }[] }[];
		output_config?: unknown;
		tools?: unknown;
	};

	const messageChars = messages
		.flatMap((message) => message.content)
		.reduce((total, block) => total + (block.type === 'text' ? (block.text?.length ?? 0) : 0), 0);

	return (
		system.length +
		messageChars +
		(output_config === undefined ? 0 : JSON.stringify(output_config).length) +
		(tools === undefined ? 0 : JSON.stringify(tools).length)
	);
}
