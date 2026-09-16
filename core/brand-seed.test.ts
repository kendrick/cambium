import { describe, expect, it } from 'vitest';

import { BrandSeedSchema, FontCandidateSchema, OklchColorSchema } from './brand-seed';

describe('OklchColorSchema', () => {
	it('parses a colour with a role and a source reference', () => {
		const parsed = OklchColorSchema.parse({
			l: 0.62,
			c: 0.19,
			h: 259.8,
			role: 'primary',
			source: { imageIndex: 0, note: 'logo mark' },
		});

		expect(parsed.l).toBe(0.62);
		expect(parsed.role).toBe('primary');
	});

	// OKLCH lightness is a 0-1 ratio. A model that hands back 62 meaning "62%" would
	// otherwise sail through and produce a ramp anchored far outside the gamut.
	it('rejects a lightness outside 0 to 1 and names the offending path', () => {
		const result = OklchColorSchema.safeParse({
			l: 62,
			c: 0.19,
			h: 259.8,
			role: 'primary',
			source: null,
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['l']);
	});
});

describe('BrandSeedSchema absence semantics', () => {
	const colorsOnly = {
		keyColors: [{ l: 0.62, c: 0.19, h: 259.8, role: 'primary', source: null }],
		neutralTemperature: null,
		surfacePolarity: null,
		radiusCharacter: null,
		shadowCharacter: null,
		trackingFeel: null,
		typeClassification: null,
		fontCandidates: null,
		typeScaleRatio: null,
		imageClassifications: null,
	};

	it('accepts a seed where only the colour fields are populated', () => {
		const result = BrandSeedSchema.safeParse(colorsOnly);
		expect(result.success).toBe(true);
	});

	it('keeps an absent field distinguishable from a populated one after parsing', () => {
		const parsed = BrandSeedSchema.parse(colorsOnly);

		expect(parsed.radiusCharacter).toBeNull();
		expect(parsed.keyColors).toHaveLength(1);
	});

	// The keyless local extractor fills colours and nothing else, and that seed gets
	// persisted. `undefined` would vanish through JSON.stringify and a later read could
	// not tell "nothing informed this" from "this key was never in the schema".
	it('keeps gaps visible through a JSON round trip', () => {
		const parsed = BrandSeedSchema.parse(colorsOnly);
		const roundTripped = JSON.parse(JSON.stringify(parsed));

		expect('radiusCharacter' in roundTripped).toBe(true);
		expect(roundTripped.radiusCharacter).toBeNull();
	});

	it('rejects a seed that omits a field rather than stating it absent', () => {
		const { radiusCharacter: _omitted, ...missingKey } = colorsOnly;

		const result = BrandSeedSchema.safeParse(missingKey);

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['radiusCharacter']);
	});
});

describe('FontCandidateSchema', () => {
	it('carries a family, a score, a rationale, and its provenance', () => {
		const parsed = FontCandidateSchema.parse({
			family: 'Inter',
			score: 100,
			rationale: 'Scores 100 on /Sans/Neo Grotesque, matching the seed tone.',
			provenance: 'derived',
		});

		expect(parsed.family).toBe('Inter');
		expect(parsed.provenance).toBe('derived');
	});

	// A model-named font has no derivation edge behind it, so it can only be `invented`.
	// Letting it claim `derived` would make the whole provenance field decorative.
	it('accepts a model-named candidate only as invented', () => {
		const modelNamed = {
			family: 'Poppins',
			score: null,
			rationale: 'Named by the model from the reference image.',
			provenance: 'invented',
		};

		expect(FontCandidateSchema.parse(modelNamed).score).toBeNull();
		expect(FontCandidateSchema.safeParse({ ...modelNamed, provenance: 'observed' }).success).toBe(
			false,
		);
	});
});
