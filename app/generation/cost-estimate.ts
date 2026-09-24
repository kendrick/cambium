import { SEED_REQUEST_MAX_TOKENS } from '../readers/anthropic-request';
import { GENERATION_PRICING } from './model';

export interface ImageDimensions {
	width: number;
	height: number;
}

export interface CostEstimateInput {
	images: ImageDimensions[];
	promptChars: number;
}

export interface CostEstimate {
	inputTokens: number;
	maxOutputTokens: number;
	maxUsd: number;
}

const TOKENS_PER_MILLION = 1_000_000;

/** Anthropic's vision-docs approximation: a decoded image costs about one token per 750 px². */
const PIXELS_PER_IMAGE_TOKEN = 750;

/** Rough English-text estimate; good enough for a pre-flight ceiling, not a bill. */
const CHARS_PER_TEXT_TOKEN = 4;

/**
 * Pure token and dollar estimate for a generation call, shown before the call is made.
 *
 * Takes dimensions rather than image bytes because decoding is the caller's job (via
 * `createImageBitmap`); keeping this function free of the DOM lets it run in a test with plain
 * numbers. Output is priced at `SEED_REQUEST_MAX_TOKENS`, the request's hard ceiling, rather than
 * a guess at the true completion length, because thinking tokens count toward that ceiling and a
 * refusal or a long chain of thought can consume it even when the visible seed is short.
 */
export function estimateGenerationCost({ images, promptChars }: CostEstimateInput): CostEstimate {
	const imageTokens = images.reduce(
		(total, { width, height }) => total + Math.ceil((width * height) / PIXELS_PER_IMAGE_TOKEN),
		0,
	);
	const promptTokens = Math.ceil(promptChars / CHARS_PER_TEXT_TOKEN);
	const inputTokens = imageTokens + promptTokens;
	const maxOutputTokens = SEED_REQUEST_MAX_TOKENS;

	const maxUsd =
		(inputTokens * GENERATION_PRICING.inputUsdPerMTok) / TOKENS_PER_MILLION +
		(maxOutputTokens * GENERATION_PRICING.outputUsdPerMTok) / TOKENS_PER_MILLION;

	return { inputTokens, maxOutputTokens, maxUsd };
}
