/**
 * The model this prototype generates with, and its published per-token rates.
 *
 * Anthropic's first-party API pricing for Claude Opus 5.5, checked 2026-09-24: $4 per million
 * input tokens, $20 per million output tokens. `cost-estimate.ts` prices a generation call before
 * it runs, so this pairing has to change together if the model or its rate card ever does.
 */
export const GENERATION_MODEL = 'claude-opus-5-5';

export const GENERATION_PRICING = {
	inputUsdPerMTok: 4,
	outputUsdPerMTok: 20,
} as const;

/**
 * Named here, not left to the reader's default, because the cost estimate measures the request body
 * this mode builds, and the two modes carry the schema in different places.
 */
export const GENERATION_OUTPUT_MODE = 'structured' as const;
