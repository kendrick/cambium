import { describe, expect, it } from 'vitest';

import { BrandSeedSchema, FontCandidateSchema, KeyColorSchema } from './brand-seed';

const derivedCandidate = {
	family: 'Inter',
	score: 100,
	rationale: 'Scores 100 on /Sans/Neo Grotesque, matching the seed tone.',
	provenance: 'derived',
};

export const colorsOnly = {
	keyColors: [
		{
			oklch: [0.62, 0.19, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	surfacePolarity: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
};

describe('KeyColorSchema', () => {
	it('parses an OKLCH triple with a proposed role and a source image', () => {
		const parsed = KeyColorSchema.parse(colorsOnly.keyColors[0]);

		expect(parsed.oklch).toEqual([0.62, 0.19, 259.8]);
		expect(parsed.proposedRole).toBe('brand');
	});

	it('rejects a role outside the six the seed defines', () => {
		const result = KeyColorSchema.safeParse({
			...colorsOnly.keyColors[0],
			proposedRole: 'primary',
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['proposedRole']);
	});

	// Hue is an angle, so 360 and 0 name the same colour. Accepting both would give one
	// value two representations and quietly break "identical seeds produce identical tokens".
	it('normalises a hue of 360 to 0 rather than keeping both spellings', () => {
		const parsed = KeyColorSchema.parse({
			...colorsOnly.keyColors[0],
			oklch: [0.62, 0.19, 360],
		});

		expect(parsed.oklch[2]).toBe(0);
	});

	it('rejects a lightness outside 0 to 1 and names the offending path', () => {
		const result = KeyColorSchema.safeParse({
			...colorsOnly.keyColors[0],
			oklch: [62, 0.19, 259.8],
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['oklch', 0]);
	});
});

describe('FontCandidateSchema', () => {
	it('parses a derived candidate carrying the score that ranked it', () => {
		expect(FontCandidateSchema.parse(derivedCandidate).score).toBe(100);
	});

	// The two provenances are different kinds of claim, so the schema discriminates on it
	// rather than letting any combination through. An invented candidate with a score would
	// let an unranked model guess masquerade as a ranked result.
	it('rejects a derived candidate with no score', () => {
		expect(FontCandidateSchema.safeParse({ ...derivedCandidate, score: null }).success).toBe(false);
	});

	it('rejects an invented candidate that carries a score', () => {
		const invented = { ...derivedCandidate, provenance: 'invented' };

		expect(FontCandidateSchema.safeParse(invented).success).toBe(false);
		expect(FontCandidateSchema.safeParse({ ...invented, score: null }).success).toBe(true);
	});
});

describe('BrandSeedSchema', () => {
	it('accepts a seed where only the colour fields are populated', () => {
		expect(BrandSeedSchema.safeParse(colorsOnly).success).toBe(true);
	});

	it('keeps gaps visible through a JSON round trip', () => {
		const roundTripped = JSON.parse(JSON.stringify(BrandSeedSchema.parse(colorsOnly)));

		expect('radiusCharacter' in roundTripped).toBe(true);
		expect(roundTripped.radiusCharacter).toBeNull();
	});

	it('rejects a seed that omits a field rather than stating it absent', () => {
		const { radiusCharacter: _omitted, ...missingKey } = colorsOnly;

		const result = BrandSeedSchema.safeParse(missingKey);

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['radiusCharacter']);
	});

	// These four were strings or `unknown` before, which left the widest part of the model
	// trust boundary unvalidated in the schema whose whole job is guarding it.
	it('parses the composite character fields the spec defines', () => {
		const parsed = BrandSeedSchema.parse({
			...colorsOnly,
			neutralTemperature: { hue: 259.8, chroma: 0.01 },
			surfacePolarity: 'light-first',
			radiusCharacter: { base: 8, progression: 'soft' },
			shadowCharacter: { spread: 'diffuse', tintFromSurface: true },
			trackingFeel: 'normal',
			typeClassification: {
				category: 'sans',
				tone: 'grotesque',
				xHeight: 'high',
				displayDiffersFromBody: false,
			},
			imageClassifications: [{ imageId: 'img-1', detected: 'logo' }],
		});

		expect(parsed.typeClassification?.tone).toBe('grotesque');
		expect(parsed.radiusCharacter?.progression).toBe('soft');
		expect(parsed.imageClassifications?.[0]?.detected).toBe('logo');
	});

	it.each(['light', 'dark'])('rejects %j, which is not how the spec spells polarity', (value) => {
		expect(BrandSeedSchema.safeParse({ ...colorsOnly, surfacePolarity: value }).success).toBe(
			false,
		);
	});

	// A brand needs a display face and a body face, and `displayDiffersFromBody` in the type
	// classification only means something if the two are addressed separately.
	it('ranks pairing candidates per role rather than as one flat list', () => {
		const parsed = BrandSeedSchema.parse({
			...colorsOnly,
			suggestedPairing: { display: [derivedCandidate], body: [derivedCandidate], mono: [] },
		});

		expect(parsed.suggestedPairing?.display[0]?.family).toBe('Inter');
		expect(parsed.suggestedPairing?.mono).toEqual([]);
	});

	it('requires all three pairing roles to be present', () => {
		const result = BrandSeedSchema.safeParse({
			...colorsOnly,
			suggestedPairing: { display: [derivedCandidate], body: [derivedCandidate] },
		});

		expect(result.success).toBe(false);
	});
});

describe('SuggestedPairingSchema ordering', () => {
	const at = (score: number) => ({ ...derivedCandidate, score });

	// The candidates are documented as ranked, and the score is what ranks them. A consumer
	// taking the first entry would otherwise get the worst face in the list.
	it('rejects derived candidates that do not descend by score', () => {
		const result = BrandSeedSchema.safeParse({
			...colorsOnly,
			suggestedPairing: { display: [at(10), at(90)], body: [], mono: [] },
		});

		expect(result.success).toBe(false);
	});

	it('accepts derived candidates in descending order', () => {
		const parsed = BrandSeedSchema.parse({
			...colorsOnly,
			suggestedPairing: { display: [at(90), at(10)], body: [], mono: [] },
		});

		expect(parsed.suggestedPairing?.display[0]?.score).toBe(90);
	});

	// An invented candidate has no score, so it cannot participate in an ordering built on one.
	it('ignores invented candidates when checking the order', () => {
		const invented = { ...derivedCandidate, provenance: 'invented' as const, score: null };

		const result = BrandSeedSchema.safeParse({
			...colorsOnly,
			suggestedPairing: { display: [at(90), invented, at(10)], body: [], mono: [] },
		});

		expect(result.success).toBe(true);
	});
});
