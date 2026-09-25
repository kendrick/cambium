import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { type BrandSeed, BrandSeedSchema, ExpressiveAxisSchema } from '../../core/brand-seed';
import {
	SEED_JSON_SCHEMA,
	SEED_PROMPT_VERSION,
	SEED_SYSTEM_PROMPT,
	SEED_TOOL_DESCRIPTION,
	SEED_TOOL_NAME,
	SEED_USER_DIRECTIVE,
} from './seed-prompt';

type SchemaNode = Record<string, unknown>;

/** Every object in the schema, at every depth. Spot-checking three of them is how the fourth drifts. */
function walk(node: unknown): SchemaNode[] {
	if (Array.isArray(node)) return node.flatMap(walk);
	if (typeof node !== 'object' || node === null) return [];

	const self = node as SchemaNode;

	return [self, ...Object.values(self).flatMap(walk)];
}

function at(path: string): unknown {
	return path
		.split('.')
		.reduce<unknown>((node, key) => (node as SchemaNode | undefined)?.[key], SEED_JSON_SCHEMA);
}

const seedKeys = Object.keys(BrandSeedSchema.shape);

// The same schema the reader hands the model, compiled here so "schema-shaped" is checked rather
// than asserted. Without it the example objects below only prove that Zod likes what a human
// hand-wrote, which is the easier half of the agreement.
const validate = new Ajv({ allErrors: true, strict: true }).compile(SEED_JSON_SCHEMA);

const fullExample = {
	keyColors: [
		{
			oklch: [0.62, 0.19, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: { x: 0.08, y: 0.1, width: 0.24, height: 0.18 },
		},
		{
			oklch: [0.74, 0.16, 72.4],
			proposedRole: 'accent',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: { hue: 259.8, chroma: 0.008 },
	radiusCharacter: { base: 8, progression: 'soft' },
	shadowCharacter: { spread: 'diffuse', tintFromSurface: true },
	trackingFeel: 'normal',
	typeClassification: {
		category: 'sans',
		tone: 'geometric',
		xHeight: 'high',
		displayDiffersFromBody: true,
	},
	suggestedPairing: {
		display: [
			{
				provenance: 'derived',
				family: 'Poppins',
				score: 92,
				rationale: 'Geometric sans with the tall x-height classified above.',
			},
			{
				provenance: 'derived',
				family: 'Outfit',
				score: 78,
				rationale: 'Also geometric, a little narrower.',
			},
		],
		body: [
			{
				provenance: 'derived',
				family: 'Inter',
				score: 88,
				rationale: 'Humanist sans that holds up at small sizes.',
			},
		],
		mono: [
			{
				provenance: 'invented',
				family: 'Berkeley Mono',
				score: null,
				rationale: 'Named from memory; nothing ranked it.',
			},
		],
	},
	typeScaleRatio: 1.25,
	imageClassifications: [{ imageId: 'img-1', detected: 'logo' }],
	expressive: [
		{ axis: 'Calm', score: 82 },
		{ axis: 'Competent', score: 65 },
	],
};

// What #33's keyless extractor produces, and what a model answers when it is shown a photograph
// with no lettering in it. Every key present, every unread one null.
const coloursOnlyExample = {
	keyColors: [
		{
			oklch: [0.62, 0.19, 259.8],
			proposedRole: 'brand',
			sourceImageId: 'img-1',
			sourceRegion: null,
		},
	],
	neutralTemperature: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

describe('seed prompt version', () => {
	// #77 dropped surfacePolarity from the seed, which is a shape change a fixture captured under
	// seed-v3 cannot describe: bumping here is what lets a stored promptVersion say which prompt
	// produced a given record, per the docblock above SEED_PROMPT_VERSION.
	it('moved to seed-v4 when surfacePolarity left the seed', () => {
		expect(SEED_PROMPT_VERSION).toBe('seed-v4');
	});
});

describe('SEED_JSON_SCHEMA', () => {
	it('requires exactly the keys the core seed declares', () => {
		expect(SEED_JSON_SCHEMA.required).toEqual(seedKeys);
		expect(Object.keys(SEED_JSON_SCHEMA.properties)).toEqual(seedKeys);
	});

	// The core reads an omitted key as a parse failure, not a gap, so a key that is required there
	// and optional here costs a round trip. Deriving the list means a twelfth field in the core
	// fails this test instead of quietly never being asked for.
	it('makes every field nullable rather than optional', () => {
		for (const key of seedKeys) {
			expect(at(`properties.${key}.anyOf.1`)).toEqual({ type: 'null' });
		}
	});

	it('closes every object at every depth', () => {
		const objects = walk(SEED_JSON_SCHEMA).filter((node) => node.type === 'object');

		expect(objects.length).toBeGreaterThan(8);
		expect(objects.filter((node) => node.additionalProperties !== false)).toEqual([]);
	});

	// Structured outputs reject these outright rather than ignoring them, which turns a habit into
	// a failed request. The bounds live in the description strings instead.
	it('uses no range keyword the structured-output subset rejects', () => {
		const banned = new Set(['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength']);
		const used = walk(SEED_JSON_SCHEMA).flatMap((node) =>
			Object.keys(node).filter((key) => banned.has(key)),
		);

		expect(used).toEqual([]);
	});

	it('takes the expressive vocabulary from the core enum rather than a copy of it', () => {
		expect(at('properties.expressive.anyOf.0.items.properties.axis.enum')).toEqual(
			ExpressiveAxisSchema.options,
		);
	});

	// A typeface is never read off an image, so the union has no observed arm and an invented
	// candidate must not be able to present an unranked guess as a ranked result.
	it('splits font candidates on provenance, with a score only on the derived arm', () => {
		const candidate = 'properties.suggestedPairing.anyOf.0.properties.display.items.anyOf';

		expect(at(`${candidate}.0.properties.provenance.const`)).toBe('derived');
		expect(at(`${candidate}.0.properties.score.type`)).toBe('number');
		expect(at(`${candidate}.1.properties.provenance.const`)).toBe('invented');
		expect(at(`${candidate}.1.properties.score.type`)).toBe('null');
	});

	it('names display, body, and mono and nothing else in a pairing', () => {
		expect(at('properties.suggestedPairing.anyOf.0.required')).toEqual(['display', 'body', 'mono']);
	});
});

// The point of the whole file: what a compliant model emits is what the core accepts. If these
// two ever disagree, a generation fails after the user has already paid for it.
describe('a response shaped by SEED_JSON_SCHEMA', () => {
	it.each([
		['fills every field', fullExample],
		['fills the colours and states the rest absent', coloursOnlyExample],
	])('parses under BrandSeedSchema when it %s', (_label, example) => {
		validate(example);

		expect(validate.errors ?? []).toEqual([]);

		const parsed = BrandSeedSchema.safeParse(example);

		expect(parsed.error?.issues ?? []).toEqual([]);
		expect(parsed.success).toBe(true);
	});

	it('round-trips through JSON with every key still present', () => {
		const parsed = BrandSeedSchema.parse(coloursOnlyExample) satisfies BrandSeed;

		expect(Object.keys(JSON.parse(JSON.stringify(parsed)))).toEqual(seedKeys);
	});
});

describe('the prompt', () => {
	// Behavioral rather than a snapshot: a field added to the seed without a prompt change fails
	// here, and an ordinary edit to the prose does not.
	it('asks for every field the seed declares', () => {
		expect(seedKeys.filter((key) => !SEED_SYSTEM_PROMPT.includes(key))).toEqual([]);
	});

	// One prompt feeds both request shapes, so it cannot name a tool: `structured` mode sends no
	// tools at all, and an instruction to call one there is an instruction the model cannot obey.
	// Only the forced-tool body names the tool, and it does so in `tools[0].name`.
	it('says nothing about how the seed travels back', () => {
		expect(SEED_SYSTEM_PROMPT).not.toContain(SEED_TOOL_NAME);
		expect(SEED_USER_DIRECTIVE).not.toContain(SEED_TOOL_NAME);
	});

	// #1 forbids asking for an identification, so the prompt has to carry the vocabulary that
	// makes a pairing a suggestion.
	it('frames typography as classification and proposal', () => {
		for (const term of ['derived', 'invented', 'rationale']) {
			expect(SEED_TOOL_DESCRIPTION + SEED_SYSTEM_PROMPT).toContain(term);
		}
	});

	// The system half is the cacheable prefix and the user half rides with the images. A prompt
	// that leaked the images into the standing text would break the split without failing anything.
	it('keeps the standing instruction longer than the line that accompanies the images', () => {
		expect(SEED_SYSTEM_PROMPT.length).toBeGreaterThan(SEED_USER_DIRECTIVE.length * 4);
	});

	// #77 retired surfacePolarity from the seed. Deriving the count from BrandSeedSchema.shape,
	// rather than writing 10 here, is what makes an eleventh field added later fail this test
	// instead of leaving a stale field count in the prose.
	it('says the field count the schema actually has, and drops the retired field', () => {
		expect(seedKeys).toHaveLength(10);
		expect(SEED_TOOL_DESCRIPTION).toContain('ten fields');
		expect(SEED_SYSTEM_PROMPT).toContain('ten fields');
		expect(SEED_TOOL_DESCRIPTION).not.toContain('surfacePolarity');
		expect(SEED_SYSTEM_PROMPT).not.toContain('surfacePolarity');
	});
});
