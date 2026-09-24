import { describe, expect, it } from 'vitest';

import { estimateGenerationCost } from './cost-estimate';

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
