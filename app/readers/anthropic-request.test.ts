import { describe, expect, it } from 'vitest';

import type { ReferenceImage } from '../../core/brand-record';
import {
	type AnthropicOutputMode,
	buildSeedRequestBody,
	SEED_REQUEST_MAX_TOKENS,
} from './anthropic-request';
import { SEED_JSON_SCHEMA, SEED_TOOL_NAME } from './seed-prompt';

function image(id: string, downscaled: string): ReferenceImage {
	return { id, downscaled, originalHash: `sha256:${id}` };
}

const MODEL = 'claude-opus-5';
const oneImage = [image('img-1', 'data:image/webp;base64,AA')];

/** The model is fixed in every case below; the mode and the images are what each test varies. */
function bodyFor(outputMode: AnthropicOutputMode, images: ReferenceImage[] = oneImage) {
	return buildSeedRequestBody({ images, model: MODEL, outputMode });
}

/**
 * Forbidden regardless of where in the body they might appear, because a body assembled by hand
 * is exactly the kind of code that can grow a stray `temperature` on a later edit without anyone
 * noticing it landed three levels deep.
 */
const FORBIDDEN_KEYS = ['temperature', 'top_p', 'top_k'];

function collectKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectKeys(item, found);
		}
	} else if (value && typeof value === 'object') {
		for (const [key, nested] of Object.entries(value)) {
			found.add(key);
			collectKeys(nested, found);
		}
	}

	return found;
}

describe('buildSeedRequestBody', () => {
	it.each(['structured', 'forced-tool'] as const)(
		'never sends temperature, top_p, or top_k in %s mode',
		(outputMode) => {
			const body = bodyFor(outputMode);
			const keys = collectKeys(body);

			for (const forbidden of FORBIDDEN_KEYS) {
				expect(keys.has(forbidden)).toBe(false);
			}
		},
	);

	// Both modes leave Opus 5 on its adaptive default. Nothing documented makes structured outputs
	// incompatible with extended thinking, and disabling it on this model can leak `<thinking>`
	// tags into the visible response or turn a tool call into visible text.
	it.each(['structured', 'forced-tool'] as const)(
		'sends no thinking key in %s mode',
		(outputMode) => {
			expect(bodyFor(outputMode)).not.toHaveProperty('thinking');
		},
	);

	it('does not set stream', () => {
		const body = bodyFor('structured');

		expect(body).not.toHaveProperty('stream');
	});

	it('sends the chosen model and max_tokens', () => {
		const body = bodyFor('structured');

		expect(body.model).toBe(MODEL);
		expect(body.max_tokens).toBe(SEED_REQUEST_MAX_TOKENS);
	});

	describe('structured mode', () => {
		it('carries output_config.format.schema identical to SEED_JSON_SCHEMA and no tools', () => {
			const body = bodyFor('structured');

			const outputConfig = body.output_config as { format: { type: string; schema: unknown } };
			expect(outputConfig.format.type).toBe('json_schema');
			expect(outputConfig.format.schema).toBe(SEED_JSON_SCHEMA);
			expect(body).not.toHaveProperty('tools');
			expect(body).not.toHaveProperty('tool_choice');
		});

		it('pins effort to high', () => {
			const body = bodyFor('structured');

			expect((body.output_config as { effort: string }).effort).toBe('high');
		});
	});

	describe('forced-tool mode', () => {
		it('carries exactly one strict tool named SEED_TOOL_NAME and a matching tool_choice', () => {
			const body = bodyFor('forced-tool');

			const tools = body.tools as { name: string; strict: boolean; input_schema: unknown }[];
			expect(tools).toHaveLength(1);
			expect(tools[0].name).toBe(SEED_TOOL_NAME);
			expect(tools[0].strict).toBe(true);
			expect(body.tool_choice).toEqual({ type: 'tool', name: SEED_TOOL_NAME });
			expect(body).not.toHaveProperty('output_config');
		});
	});

	it('sends the same schema object from both modes, so the two cannot drift apart', () => {
		const structured = bodyFor('structured');
		const forcedTool = bodyFor('forced-tool');

		const structuredSchema = (structured.output_config as { format: { schema: unknown } }).format
			.schema;
		const forcedToolSchema = (forcedTool.tools as { input_schema: unknown }[])[0].input_schema;

		expect(structuredSchema).toBe(SEED_JSON_SCHEMA);
		expect(forcedToolSchema).toBe(SEED_JSON_SCHEMA);
	});

	describe('images', () => {
		it('produces one text block naming the id and one image block per image, in order, with the directive last', () => {
			const images = [
				image('logo', 'data:image/png;base64,AAA'),
				image('screenshot', 'data:image/jpeg;base64,BBB'),
				image('swatch', 'data:image/gif;base64,CCC'),
			];

			const body = bodyFor('structured', images);
			const content = (body.messages as { content: Record<string, unknown>[] }[])[0].content;

			expect(content).toHaveLength(images.length * 2 + 1);

			for (const [index, source] of images.entries()) {
				const textBlock = content[index * 2] as { type: string; text: string };
				const imageBlock = content[index * 2 + 1] as {
					type: string;
					source: { type: string; media_type: string; data: string };
				};

				expect(textBlock.type).toBe('text');
				expect(textBlock.text).toContain(source.id);

				expect(imageBlock.type).toBe('image');
				expect(imageBlock.source.type).toBe('base64');
			}

			const lastBlock = content[content.length - 1] as { type: string; text: string };
			expect(lastBlock.type).toBe('text');
		});

		it('takes media_type and data from the data URL', () => {
			const body = bodyFor('structured', [image('img-1', 'data:image/png;base64,SGVsbG8=')]);
			const content = (body.messages as { content: Record<string, unknown>[] }[])[0].content;
			const imageBlock = content[1] as { source: { media_type: string; data: string } };

			expect(imageBlock.source.media_type).toBe('image/png');
			expect(imageBlock.source.data).toBe('SGVsbG8=');
		});

		it('throws, naming the offending image id, when downscaled is not a base64 image data URL', () => {
			const images = [
				image('good', 'data:image/png;base64,AAA'),
				image('bad-svg', 'data:image/svg+xml;base64,AAA'),
			];

			expect(() => bodyFor('structured', images)).toThrow(/bad-svg/);
		});

		it('throws, naming the offending image id, when downscaled has no data URL prefix at all', () => {
			const images = [image('plain', 'AAAA')];

			expect(() => bodyFor('structured', images)).toThrow(/plain/);
		});

		it('refuses zero images rather than send a request with no way to name provenance', () => {
			expect(() => bodyFor('structured', [])).toThrow(/at least one reference image/);
		});
	});
});
