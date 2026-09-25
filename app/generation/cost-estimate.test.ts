import { describe, expect, it } from 'vitest';

import { estimateGenerationCost, formatUsdCeiling, generationPromptChars } from './cost-estimate';

describe('estimateGenerationCost', () => {
	it('sums per-image and prompt tokens, and prices output at the request ceiling', () => {
		// image tokens, per Anthropic's vision-docs approximation of width*height/750:
		//   1568*1176/750 = 1,843,968/750 = 2458.624 -> 2459 tokens
		//    800*600 /750 =   480,000/750 =  640      ->  640 tokens
		// prompt tokens: 5000 chars/4 = 1250 exactly -> 1250 tokens
		// inputTokens = 2459 + 640 + 1250 = 4349
		//
		// maxOutputTokens is fixed at SEED_REQUEST_MAX_TOKENS (16000; app/readers/anthropic-request.ts),
		// not a guess at the true completion length, because thinking tokens count toward that ceiling.
		//
		// maxUsd = 4349 * $4/MTok + 16000 * $20/MTok
		//        = (4349*4)/1e6 + (16000*20)/1e6
		//        =    17,396/1e6 +   320,000/1e6
		//        = 0.017396 + 0.32 = 0.337396
		const estimate = estimateGenerationCost({
			images: [
				{ width: 1568, height: 1176 },
				{ width: 800, height: 600 },
			],
			promptChars: 5000,
		});

		expect(estimate.inputTokens).toBe(4349);
		expect(estimate.maxOutputTokens).toBe(16000);
		expect(estimate.maxUsd).toBeCloseTo(0.337396, 9);
	});

	it('prices a prompt-only call with no images, rounding the odd remainder up', () => {
		// no images, so inputTokens is just the prompt: 843 chars/4 = 210.75 -> 211 tokens
		// maxUsd = 211 * $4/MTok + 16000 * $20/MTok
		//        = (211*4)/1e6 + (16000*20)/1e6
		//        =     844/1e6 +   320,000/1e6
		//        = 0.000844 + 0.32 = 0.320844
		const estimate = estimateGenerationCost({ images: [], promptChars: 843 });

		expect(estimate.inputTokens).toBe(211);
		expect(estimate.maxOutputTokens).toBe(16000);
		expect(estimate.maxUsd).toBeCloseTo(0.320844, 9);
	});
});

/**
 * The string is what the person reads, so it's the thing asserted. Each expected value is worked
 * out by hand from the rule "round up to the next whole cent", not from the code.
 */
describe('formatUsdCeiling', () => {
	it.each([
		// 32.0844 cents rounds up to 33.
		{ amount: 0.320844, rendered: '$0.33' },
		// A hundred-thousandth of a cent past 33 still rounds up to 34.
		{ amount: 0.3300001, rendered: '$0.34' },
		// Exactly 33 cents stays 33.
		{ amount: 0.33, rendered: '$0.33' },
		// Exactly 7 cents stays 7, though 0.07 * 100 is 7.000000000000001 in floating point.
		{ amount: 0.07, rendered: '$0.07' },
		// Exactly $1.10 stays $1.10, though 1.1 * 100 is 110.00000000000001.
		{ amount: 1.1, rendered: '$1.10' },
		// 1234.5 cents rounds up to 1235.
		{ amount: 12.345, rendered: '$12.35' },
		{ amount: 0, rendered: '$0.00' },
	])('renders $amount as $rendered', ({ amount, rendered }) => {
		expect(formatUsdCeiling(amount)).toBe(rendered);
	});

	// The sum `estimateGenerationCost` actually produces, rendered: 0.337396 is 33.7396 cents, so 34.
	it('renders a computed estimate rounded up to the cent', () => {
		const { maxUsd } = estimateGenerationCost({
			images: [
				{ width: 1568, height: 1176 },
				{ width: 800, height: 600 },
			],
			promptChars: 5000,
		});

		expect(formatUsdCeiling(maxUsd)).toBe('$0.34');
	});
});

/**
 * A repair resends the first request's text and adds two turns: the answer being fixed, played back
 * verbatim, and a directive naming every issue. So its text is at least the first request's plus
 * both of those strings, whatever the directive's own wording adds around them.
 */
describe('generationPromptChars', () => {
	const images = [
		{
			id: 'img-logo',
			downscaled: 'data:image/png;base64,Ag==',
			originalHash: 'sha256-logo',
			tag: 'auto' as const,
		},
	];

	it('prices a repair as the first request plus the answer and every issue it names', () => {
		const repair = {
			rawResponse: 'Here is the brand palette you asked for, in prose rather than JSON.',
			issues: ['Unexpected token H in JSON at position 0', 'keyColors: Required'],
		};

		const first = generationPromptChars(images);
		const repaired = generationPromptChars(images, repair);
		const added = repair.rawResponse.length + repair.issues.join('').length;

		expect(repaired).toBeGreaterThanOrEqual(first + added);
	});
});
