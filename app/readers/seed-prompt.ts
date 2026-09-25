import { ExpressiveAxisSchema } from '../../core/brand-seed';

/**
 * Stamped onto every `RawReaderResponse`, so a stored generation stays reproducible by
 * reference. Move it whenever the prompt or the schema below changes in a way that changes what
 * a model returns: the recorded fixtures under `core/fixtures/raw-responses/` are pinned to a
 * version, and a silently edited prompt makes them lie about what produced them.
 */
export const SEED_PROMPT_VERSION = 'seed-v4';

export const SEED_TOOL_NAME = 'emit_brand_seed';

export const SEED_TOOL_DESCRIPTION =
	'Record the Brand Seed read off the reference images. Call once, with all ten fields present and null wherever the images do not answer the question.';

/**
 * Nullability as `anyOf`, never the `nullable` keyword, which is OpenAPI and not JSON Schema.
 * A validator that does not recognise `nullable` drops the constraint on the floor, and the
 * model is never told that null is an allowed answer.
 */
function nullable(description: string, schema: object) {
	return { description, anyOf: [schema, { type: 'null' }] };
}

/**
 * Structured outputs accept a subset of JSON Schema that leaves out every range keyword:
 * `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`. They are not ignored, they are
 * rejected. So every bound `BrandSeedSchema` enforces has to travel in a `description` instead,
 * which is the half of the schema the model actually reads. A bound stated in neither place is
 * a round trip spent on a rejected response.
 */
const oklchTriple = {
	type: 'array',
	description:
		'Exactly three numbers, [lightness, chroma, hue]. Lightness is a 0-to-1 ratio, never a percentage: 0.62, not 62. Chroma starts at 0 and rarely passes 0.37. Hue is degrees, 0 to 360.',
	items: { type: 'number' },
};

const sourceRegion = {
	type: 'object',
	additionalProperties: false,
	required: ['x', 'y', 'width', 'height'],
	properties: {
		x: { type: 'number', description: 'Left edge, 0 to 1, measured from the left of the image.' },
		y: { type: 'number', description: 'Top edge, 0 to 1, measured from the top of the image.' },
		width: {
			type: 'number',
			description: 'Width as a fraction of the image, above 0 and at most 1.',
		},
		height: {
			type: 'number',
			description: 'Height as a fraction of the image, above 0 and at most 1.',
		},
	},
};

const keyColor = {
	type: 'object',
	additionalProperties: false,
	required: ['oklch', 'proposedRole', 'sourceImageId', 'sourceRegion'],
	properties: {
		oklch: oklchTriple,
		proposedRole: {
			type: 'string',
			enum: ['brand', 'accent', 'danger', 'warning', 'success', 'info'],
			description:
				'What this colour is for. Brand is the colour someone would name if asked what colour the brand is. Accent is a genuine second colour, not a tint of the first. Claim danger, warning, success, or info only when the images really show a status colour.',
		},
		sourceImageId: {
			type: 'string',
			description: 'The id of the image you read this colour from, copied exactly as given.',
		},
		sourceRegion: nullable(
			'Where in that image the colour sits, in fractions of the image rather than pixels, so it still points somewhere after the image is downscaled. x plus width and y plus height must each stay at or below 1, so the rectangle cannot run off the edge. Null when no single region is responsible.',
			sourceRegion,
		),
	},
};

/**
 * Provenance is the discriminator, mirroring `FontCandidateSchema`. Two closed objects under
 * `anyOf`, each pinning `provenance` with `const`, is the only shape that stops a model from
 * pairing an invented family with a confident-looking score.
 */
const fontCandidate = {
	anyOf: [
		{
			type: 'object',
			additionalProperties: false,
			required: ['provenance', 'family', 'score', 'rationale'],
			description:
				'A candidate you chose because its published characteristics match the classification above.',
			properties: {
				provenance: { type: 'string', const: 'derived' },
				family: { type: 'string', description: 'The Google Fonts family name.' },
				score: {
					type: 'number',
					description: 'How well the family matches the classification, 0 to 100.',
				},
				rationale: {
					type: 'string',
					description: 'One line naming what it matches. Shown to the user beside the family.',
				},
			},
		},
		{
			type: 'object',
			additionalProperties: false,
			required: ['provenance', 'family', 'score', 'rationale'],
			description: 'A candidate you named from memory as a good fit, with no matching behind it.',
			properties: {
				provenance: { type: 'string', const: 'invented' },
				family: { type: 'string', description: 'The Google Fonts family name.' },
				score: { type: 'null', description: 'Always null: nothing ranked this candidate.' },
				rationale: {
					type: 'string',
					description: 'One line on why you named it. Shown to the user beside the family.',
				},
			},
		},
	],
};

const rankedCandidates = {
	type: 'array',
	description:
		'Candidates for this role, derived ones highest score first. An empty array is fine.',
	items: fontCandidate,
};

/**
 * One schema, authored once, handed to both `output_config.format.schema` and the tool's
 * `input_schema`. Two copies of a shape this fiddly drift, and the drift shows up as a parse
 * failure against `BrandSeedSchema` long after the edit that caused it.
 *
 * `additionalProperties: false` on every object, because `BrandSeedSchema` is `z.strictObject`
 * all the way down and rejects an undeclared key rather than stripping it.
 */
export const SEED_JSON_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	// Every field is a required key holding a nullable value, never an optional key. An omitted
	// key is a parse failure in the core, not a gap, because a seed that survives a JSON round
	// trip has to keep saying "nothing in the images informed this".
	required: [
		'keyColors',
		'neutralTemperature',
		'radiusCharacter',
		'shadowCharacter',
		'trackingFeel',
		'typeClassification',
		'suggestedPairing',
		'typeScaleRatio',
		'imageClassifications',
		'expressive',
	],
	properties: {
		keyColors: nullable(
			'The one to three colours that carry the brand, each with a proposed semantic role.',
			{ type: 'array', items: keyColor },
		),
		neutralTemperature: nullable('The hue and chroma of the brand’s greys.', {
			type: 'object',
			additionalProperties: false,
			required: ['hue', 'chroma'],
			properties: {
				hue: { type: 'number', description: 'Degrees, 0 to 360.' },
				chroma: {
					type: 'number',
					description:
						'0 or above. Brand greys are rarely pure; 0.004 to 0.02 is typical, and 0 is a real answer for a genuinely neutral brand.',
				},
			},
		}),
		radiusCharacter: nullable('How the brand treats corners.', {
			type: 'object',
			additionalProperties: false,
			required: ['base', 'progression'],
			properties: {
				base: {
					type: 'number',
					description:
						'Corner radius in CSS pixels at the brand’s ordinary component size. 0 or above.',
				},
				progression: {
					type: 'string',
					enum: ['sharp', 'soft', 'pill'],
					description: 'How that radius behaves as components get larger.',
				},
			},
		}),
		shadowCharacter: nullable('How elevation reads.', {
			type: 'object',
			additionalProperties: false,
			required: ['spread', 'tintFromSurface'],
			properties: {
				spread: { type: 'string', enum: ['tight', 'diffuse'] },
				tintFromSurface: {
					type: 'boolean',
					description:
						'True when shadows take a tint from the surface beneath them rather than being neutral black.',
				},
			},
		}),
		trackingFeel: nullable('The brand’s letter-spacing character in display type.', {
			type: 'string',
			enum: ['tight', 'normal', 'wide'],
		}),
		typeClassification: nullable(
			'What the brand’s lettering is like. Characteristics, not an identification.',
			{
				type: 'object',
				additionalProperties: false,
				required: ['category', 'tone', 'xHeight', 'displayDiffersFromBody'],
				properties: {
					category: { type: 'string', enum: ['serif', 'sans', 'slab', 'mono'] },
					tone: { type: 'string', enum: ['geometric', 'humanist', 'grotesque'] },
					xHeight: { type: 'string', enum: ['low', 'medium', 'high'] },
					displayDiffersFromBody: {
						type: 'boolean',
						description: 'True when headings and running text are set in different faces.',
					},
				},
			},
		),
		suggestedPairing: nullable(
			'Candidate families for each role, drawn from Google Fonts so a static site can load them.',
			{
				type: 'object',
				additionalProperties: false,
				required: ['display', 'body', 'mono'],
				properties: {
					display: rankedCandidates,
					body: rankedCandidates,
					mono: rankedCandidates,
				},
			},
		),
		typeScaleRatio: nullable(
			'The ratio between adjacent steps of the brand’s type scale, above 0. Common values run from about 1.067 to 1.618. Measure it from relative sizes you can actually see, and return null rather than a guess.',
			{ type: 'number' },
		),
		imageClassifications: nullable(
			'What each image actually is, in your read. Classify every image you were given, on what you see rather than on any tag the user applied.',
			{
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					required: ['imageId', 'detected'],
					properties: {
						imageId: { type: 'string', description: 'The image id, copied exactly as given.' },
						detected: { type: 'string', enum: ['logo', 'ui', 'photo', 'artwork'] },
					},
				},
			},
		),
		expressive: nullable(
			'The brand’s personality as scores on named axes, highest first, no axis twice.',
			{
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					required: ['axis', 'score'],
					properties: {
						axis: {
							type: 'string',
							// Built from the enum rather than retyped beside it. A hand-copied vocabulary
							// drifts silently the moment the upstream taxonomy moves, and the failure lands
							// downstream in #42's ranking rather than here.
							enum: [...ExpressiveAxisSchema.options],
							description: 'One of the twenty expressive axes. A near-synonym is a parse error.',
						},
						score: {
							type: 'number',
							description: 'How strongly the brand reads this way, 0 to 100.',
						},
					},
				},
			},
		),
	},
};

/**
 * Split from `SEED_USER_DIRECTIVE` so the standing half stays byte-identical across every
 * generation. The images vary, this does not, which is the prefix stability a cache breakpoint
 * would need. Nothing sets one yet: `buildSeedRequestBody` sends this as a bare `system` string
 * with no `cache_control`, and whether this prefix even clears the model's minimum cacheable
 * length is unmeasured. The split costs nothing and leaves that door open.
 *
 * Says nothing about how the seed travels back. One prompt serves both request shapes: in
 * forced-tool mode the JSON arrives as the tool call's input, in structured mode as the whole
 * response. Naming a tool here would be a lie in one of them, and the model has no way to tell
 * that from an instruction it simply cannot follow.
 *
 * No role-play preamble, no "think step by step", no scratchpad scaffolding. Those are dated
 * idioms that current models do not need and that cost quality on a task this constrained.
 */
export const SEED_SYSTEM_PROMPT = `You are reading reference images for a brand and returning a Brand Seed.

A Brand Seed is a compact description of a brand's visual character. A deterministic pipeline downstream expands it into a full design token set: colour ramps, radii, shadows, a type scale, independent light and dark palettes, contrast repair. You are producing the seed all of that derives from. Give the handful of decisions that characterise the brand; an inventory of every colour in the image is not a seed.

This is interpretation, not extraction. A logo or a screenshot almost never contains a destructive colour, a full neutral ramp, or a popover surface, and the pipeline invents those from what you give it. Your job is to be right about the few things the images actually show.

Return the seed as a single JSON object. All ten fields must be present: keyColors, neutralTemperature, radiusCharacter, shadowCharacter, trackingFeel, typeClassification, suggestedPairing, typeScaleRatio, imageClassifications, expressive. Where the images do not answer a question, the value is null. Null is a real answer and beats a plausible guess, because a user can see a null and fill it in but cannot tell an invented value from an observed one.

Read the field descriptions in the JSON schema. They say what each field means and what range it takes.

Typography works differently from the rest. You are never asked to identify a typeface, and you should not try. A family name read off an image is a guess, and the interface has no way to mark it as one. Classify the characteristics you can see in typeClassification, then propose families that match them in suggestedPairing. A candidate is derived when you chose it because its published characteristics match that classification, and it carries a 0-to-100 score for how well. A candidate is invented when you named it from memory as a good fit with no matching behind it, and its score is null. Either way it carries a one-line rationale, which the user reads beside the family name.

imageClassifications is where your read of each image goes. The user may already have tagged an image, and you are not being asked to agree with the tag. The user sees the disagreement, because that is what catches a misread input.

expressive is what makes font ranking work downstream, so do not skip it. Score only the axes that actually separate this brand from others. Three to five is usually right. Leave out anything that would score near the middle. Padding the list with axes scored 50 is worse than a short list.

Some rules the schema cannot state:

Ranked means ordered. Within each of display, body, and mono, derived candidates run highest score first. Expressive axes run highest score first too.

One reading per expressive axis. A repeated axis is an error rather than a second opinion.

Lightness is a 0-to-1 ratio, never a percentage: 0.62, not 62.

A source region is expressed in fractions of the image rather than in pixels, and it has to stay inside the image: x plus width and y plus height each land at or below 1.

Do not add fields. A closed schema validates the seed, and a key it does not declare fails the whole response instead of being ignored.`;

/**
 * The varying half: it rides with the images, after the cacheable prefix above. It names the
 * image ids because `keyColors.sourceImageId` and `imageClassifications.imageId` both point back
 * at them, and a model that never saw an id has nothing to point with.
 */
export const SEED_USER_DIRECTIVE = `These are the reference images for one brand, each preceded by its image id. Read them together as a single brand and return one seed.`;
