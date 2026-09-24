import type { ReferenceImage } from '../../core/brand-record';
import {
	SEED_REQUEST_MAX_TOKENS,
	type SeedRepair,
	seedRequestTextChars,
} from '../readers/anthropic-request';

import { GENERATION_MODEL, GENERATION_OUTPUT_MODE, GENERATION_PRICING } from './model';

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

/**
 * Character count of the prompt text a generation sends for these images, measured from the body
 * itself. Pass the repair for a repair run. A repair is a whole second request that resends the
 * images and adds the answer being fixed and the directive, so pricing it as a first generation
 * would understate it.
 */
export function generationPromptChars(images: ReferenceImage[], repair?: SeedRepair): number {
	return seedRequestTextChars({
		images,
		model: GENERATION_MODEL,
		outputMode: GENERATION_OUTPUT_MODE,
		repair,
	});
}

/**
 * Enough decimals to hold any `maxUsd` exactly. Every term is a whole token count times a
 * whole-dollar rate over a million, so the true value never has more than six decimal places of a
 * dollar, which is four of a cent.
 */
const CENT_PRECISION = 6;

/**
 * Dollars rounded up to the cent, as the person reads them. Up, because the figure is a ceiling and
 * rounding it down would promise less than a run can spend.
 *
 * The cents are rounded to `CENT_PRECISION` before the ceiling, because binary floating point
 * nudges some exact amounts just past a whole cent. `0.07 * 100` is `7.000000000000001`, and a bare
 * `Math.ceil` turns that into eight cents.
 */
export function formatUsdCeiling(amount: number): string {
	const cents = Math.ceil(Number((amount * 100).toFixed(CENT_PRECISION)));

	return `$${(cents / 100).toFixed(2)}`;
}
