import type { BrandSeed, KeyColor, OklchTriple } from '../../core/brand-seed';
import { hueDistance, type Oklch, quantizeToSrgb, readOklch } from '../../core/oklch';
import { MIN_ACCENT_SEPARATION } from '../../core/oklch-scale-engine';

/**
 * Decoded pixels, the shape `CanvasRenderingContext2D.getImageData` already returns. RGBA, four
 * bytes per pixel, row-major.
 *
 * This module takes pixels rather than an image because decoding is the only part of local
 * extraction that needs a browser. Everything below is arithmetic, which is what lets the whole
 * heuristic run under Vitest's `node` environment with no canvas; see docs/agents/testing.md.
 */
export type PixelSample = {
	data: Uint8ClampedArray;
	width: number;
	height: number;
};

/** A quantized colour and the share of the image's pixels that landed in its bucket. */
export type Candidate = {
	oklch: Oklch;
	share: number;
	/** `chroma * sqrt(share)`. See `scoreCandidates` for why that shape. */
	score: number;
};

/**
 * What one image's pixels told each library, strongest candidate first.
 *
 * Both lists are already past the neutral floor, so an empty list means the image offered no
 * colour at all rather than that a library failed.
 */
export type ImageOpinions = {
	imageId: string;
	/** colorthief, quantizing in OKLCH. */
	primary: Candidate[];
	/** `@vibrant/quantizer-mmcq` through vibrant's own palette generator, quantizing in RGB. */
	secondOpinion: Candidate[];
};

export type LocalExtraction =
	| { kind: 'read'; keyColors: KeyColor[]; reason?: never }
	| {
			kind: 'no-brand-color';
			keyColors?: never;
			/**
			 * `all-neutral`: nothing in any image cleared the chroma floor. A page of greys reads this
			 * way, and so does a screenshot whose only candidates are its background and its text.
			 *
			 * `uncorroborated`: the two libraries read different structure out of the same pixels,
			 * which per ADR-0002 means the image has no clear brand colour.
			 *
			 * Only a caller of `chooseKeyColors` can tell the two apart today. `seedPayload` flattens
			 * both to `keyColors: null`, because `RawReaderResponse` has no field for a reason and
			 * `BrandSeedSchema` is a `z.strictObject` that would reject one. So ADR-0002's "worth
			 * surfacing rather than hiding" is honoured as far as this module reaches and no
			 * further; carrying it to the user needs a seam change nobody has asked for yet.
			 */
			reason: 'all-neutral' | 'uncorroborated';
	  };

/**
 * The chroma below which a colour is a neutral.
 *
 * The issue asks for two things here, "reject near-neutrals" and "apply a minimum saturation
 * floor", and they are one gate rather than two: a candidate under this floor is grey, and grey is
 * what a page background and a paragraph of text are made of.
 *
 * Set from the measured ceiling of the neutrals real interfaces ship. Tailwind slate binds it:
 * slate-500 (`#64748b`) reads 0.0407 and slate-950 reads 0.0406, with five more steps between
 * 0.035 and 0.040. Every other family sits far below, gray peaking at 0.0318, zinc at 0.0146,
 * stone at 0.0116, and neutral achromatic throughout. So this clears slate-500 by more than 0.004,
 * where a floor of 0.04 did not clear it at all: `SLATE_CHROME_FIXTURE` is the interface that held
 * no brand colour and got its own body text returned as one.
 *
 * What the floor cannot do is separate slate from every slate-like colour, and no value here
 * would. The neutral band runs to 0.041 and washed-out brand colours start around 0.046, so a
 * dusty teal (`#4a7c7c`) at 0.054 and a muted blue-grey (`#5b7c8d`) at 0.046 sit just above a
 * band that three bytes per channel of drift on slate-500 already reaches (0.0494). The guard is
 * exact against the palette values interfaces paste in and a heuristic against everything else.
 * Where the two error modes are returning a page background and returning nothing, it prefers
 * nothing: a background presented as a brand colour is a wrong answer the user cannot see, and a
 * null is a gap they can.
 *
 * No lightness cap sits beside this. Near-white and near-black fall out for free, because the sRGB
 * gamut pinches to zero chroma at both ends of lightness, and a cap would instead reject the
 * colours it pinches around: pure yellow is a brand colour at 0.968 lightness, and any cap low
 * enough to catch `#fafafa` catches it too.
 */
export const MIN_BRAND_CHROMA = 0.045;

/**
 * How far apart in hue the two libraries' answers may sit and still count as the same answer.
 *
 * Wide on purpose, because the gate does not arbitrate between two plausible readings. It catches
 * the case where one library found structure the other never saw.
 *
 * `local-extract.test.ts` pins the two libraries to under two degrees of each other on every
 * fixture that offers a candidate at all, which is where the room between that figure and this one
 * comes from. Both are median-cut quantizers reading identical pixels, so close agreement is the
 * expected case and this bound is the alarm.
 */
export const MAX_HUE_DISAGREEMENT = 15;

/**
 * How many buckets each quantizer gets. Generous on both sides, and not the same number, because
 * the two libraries take different ranges: colorthief accepts 2 through 20 and vibrant defaults
 * to 64.
 *
 * A screenshot is the reason they are generous. Its background and chrome are a dozen
 * near-identical off-whites, and a quantizer given few buckets spends all of them there and never
 * isolates the one small saturated region the brand colour lives in. Levelling the two down to a
 * shared number would cost the case the heuristic exists for and buy nothing: the scores are
 * shares of each library's own palette, so they already compare across two palettes of different
 * sizes.
 */
const COLORTHIEF_PALETTE_SIZE = 16;
const VIBRANT_PALETTE_SIZE = 64;

/**
 * Every role vibrant's generator fills, because reading all six is what makes this a usable
 * second opinion. Vibrant bands its roles by HSL lightness, so a brand colour reaches the
 * `Vibrant` slot only if it happens to sit mid-band: the logo fixture's deep green lands in
 * `DarkVibrant` instead, and taking `Vibrant` alone would report no colour found for it.
 *
 * The order is not a ranking and nothing here depends on it. `scoreCandidates` ranks what comes
 * back, and corroboration asks whether any of them matches rather than which came first.
 */
const VIBRANT_ROLES = [
	'Vibrant',
	'LightVibrant',
	'DarkVibrant',
	'Muted',
	'LightMuted',
	'DarkMuted',
] as const;

type QuantizedColor = { hex: string; population: number };

/**
 * Loaded once per page rather than per read, and dynamically so neither library reaches
 * first-load JavaScript.
 *
 * ADR-0002 leaves 24 kB of headroom under a 200 kB gzipped ceiling to force every pipeline
 * library behind a boundary like this one, and the landing route is an upload screen that needs
 * none of them. Nothing in the repo imports the reader yet, so reproducing the split means wiring
 * `createLocalBrandReader` into a `'use client'` page, running `pnpm build`, and measuring with
 * `lib/bundle-size.ts`. Done that way it came to 1.2 kB of first-load against 22 kB left lazy.
 *
 * Both import shapes here fail at runtime rather than at build time, and ADR-0002 writes down
 * why. `colorthief` has no default export, so the named exports are the only way in.
 * `node-vibrant`'s own main entry is a `throw` pointing at its subpaths, so the scoped
 * `@vibrant/*` packages are the only ones that load.
 */
async function loadQuantizers() {
	const [colorthief, mmcq, generator] = await Promise.all([
		import('colorthief/internals'),
		import('@vibrant/quantizer-mmcq'),
		import('@vibrant/generator-default'),
	]);

	const quantizer = new colorthief.MmcqQuantizer();
	await quantizer.init();

	return { colorthief, quantizer, mmcq, generator };
}

let quantizers: ReturnType<typeof loadQuantizers> | null = null;

function quantizerModules() {
	// Dropped on failure, not kept. A rejected promise stays rejected for as long as it is held, so
	// caching one would turn a single dropped chunk request into a page that can never run a local
	// read again. Clearing it costs nothing and lets the next read try the import afresh.
	quantizers ??= loadQuantizers().catch((cause: unknown) => {
		quantizers = null;

		throw cause;
	});

	return quantizers;
}

/**
 * Asks colorthief for a palette with every filter of its own turned off.
 *
 * `ignoreWhite` defaults on and `minSaturation` is a knob for exactly the rejection this module
 * performs, and letting the library do either would mean two different neutral floors disagreeing
 * about the same pixels, with only one of them tested. It also would not be a second opinion any
 * more: vibrant's quantizer has no equivalent filter, so the two libraries would be reading
 * different images.
 */
async function primaryPalette(sample: PixelSample): Promise<QuantizedColor[]> {
	const { colorthief, quantizer } = await quantizerModules();
	const options = colorthief.validateOptions({
		colorCount: COLORTHIEF_PALETTE_SIZE,
		quality: 1,
		colorSpace: 'oklch',
		ignoreWhite: false,
		minSaturation: 0,
	});

	const palette =
		colorthief.extractPalette(sample.data, sample.width, sample.height, options, quantizer) ?? [];

	return palette.map((color) => ({ hex: color.hex(), population: color.population }));
}

/**
 * Asks vibrant for the same image's colours, keeping only the swatches it actually observed.
 *
 * Vibrant's generator fills any role it could not fill from the image by darkening or lightening
 * one it could, and marks those with a population of zero. Those are inventions, and a second
 * opinion made of inventions would corroborate anything.
 */
async function secondOpinionPalette(sample: PixelSample): Promise<QuantizedColor[]> {
	const { mmcq, generator } = await quantizerModules();
	const swatches = await mmcq.MMCQ(sample.data, { colorCount: VIBRANT_PALETTE_SIZE });
	const palette = await generator.DefaultGenerator(swatches);

	return VIBRANT_ROLES.flatMap((role) => {
		const swatch = palette[role];

		return swatch && swatch.population > 0
			? [{ hex: swatch.hex, population: swatch.population }]
			: [];
	});
}

/**
 * Weights a quantizer's palette by chroma, drops the neutrals, and ranks what is left.
 *
 * `chroma * sqrt(share)` rather than either factor alone. Population alone returns the page
 * background, which is the failure the ticket names. Chroma alone returns whichever stray pixel
 * is most saturated, and one JPEG artifact would then decide a brand's colour. The square root is
 * what puts them on speaking terms: it keeps area relevant while letting a colour that covers two
 * per cent of a screenshot outrank one that covers half of it, as a button outranks a background.
 *
 * Shares are computed over the palette rather than over the image, because a quantizer's buckets
 * already account for every pixel it sampled and the two libraries sample different numbers of
 * them. Dividing by a common total is what makes the scores comparable across libraries.
 */
function scoreCandidates(palette: readonly QuantizedColor[]): Candidate[] {
	const total = palette.reduce((sum, color) => sum + color.population, 0);

	if (total === 0) return [];

	return (
		palette
			.map((color) => {
				const oklch = readOklch(color.hex);
				const share = color.population / total;

				return { oklch, share, score: oklch.c * Math.sqrt(share) };
			})
			.filter((candidate) => candidate.oklch.c >= MIN_BRAND_CHROMA)
			// `map` and `filter` each returned a fresh array, so this sort mutates nothing the caller
			// can see. `toSorted` is ES2023 and tsconfig targets ES2022.
			// oxlint-disable-next-line unicorn/no-array-sort
			.sort((a, b) => b.score - a.score)
	);
}

/**
 * Runs both quantizers over one image and ranks each one's answer by the same rule.
 *
 * The two libraries see the identical buffer. Nothing is downsampled on the way in: the stored
 * reference image is already the downscaled one, a second resample would be the browser's own and
 * so would put a cross-browser variable inside a result the record claims is reproducible, and
 * both quantizers finish a one-megapixel image in well under a second anyway.
 */
export async function readImageOpinions(
	imageId: string,
	sample: PixelSample,
): Promise<ImageOpinions> {
	const [primary, secondOpinion] = await Promise.all([
		primaryPalette(sample),
		secondOpinionPalette(sample),
	]);

	return {
		imageId,
		primary: scoreCandidates(primary),
		secondOpinion: scoreCandidates(secondOpinion),
	};
}

function corroborates(candidate: Candidate, secondOpinion: readonly Candidate[]): boolean {
	return secondOpinion.some(
		(other) => hueDistance(other.oklch.h, candidate.oklch.h) <= MAX_HUE_DISAGREEMENT,
	);
}

function toTriple(color: Oklch): OklchTriple {
	const { l, c, h } = quantizeToSrgb(color);

	return [l, c, h];
}

/**
 * Picks the key colours out of what the images offered.
 *
 * Pure and synchronous, and separate from the quantizing above, because this is the part with
 * decisions in it. Every rule the ticket states lands here, and a test can drive it with two
 * candidate lists instead of an image that happens to provoke the branch.
 *
 * Candidates compete across images once their own image is trusted. A visitor uploading a logo
 * and a screenshot of the same product is offering two views of one brand, not two brands.
 */
export function chooseKeyColors(opinions: readonly ImageOpinions[]): LocalExtraction {
	const offered = opinions.filter((image) => image.primary.length > 0);

	if (offered.length === 0) return { kind: 'no-brand-color', reason: 'all-neutral' };

	// Corroboration is scoped to one image, because that is the scope ADR-0002 gives it:
	// disagreement means "the image has no clear brand colour". So an image whose own strongest
	// candidate is one only colorthief saw contributes nothing and the rest of the upload carries
	// on without it.
	//
	// Both halves of that matter. Within an image there is still no falling through to a
	// runner-up, which would hide the murk the ADR asks to have surfaced. Across images, refusing
	// a logo's corroborated colour because a screenshot beside it was ambiguous would discard
	// evidence without surfacing anything, since the envelope cannot say why it refused.
	const trusted = offered.filter((image) => corroborates(image.primary[0]!, image.secondOpinion));

	if (trusted.length === 0) return { kind: 'no-brand-color', reason: 'uncorroborated' };

	const ranked = trusted
		.flatMap((image) => image.primary.map((candidate) => ({ candidate, image })))
		// Fresh from `flatMap`, so nothing outside this function sees the mutation.
		// oxlint-disable-next-line unicorn/no-array-sort
		.sort((a, b) => b.candidate.score - a.candidate.score);

	// The global maximum is also its own image's maximum, so it is one of the corroborated
	// candidates the filter above kept.
	const best = ranked[0]!;

	const keyColors: KeyColor[] = [
		{
			oklch: toTriple(best.candidate.oklch),
			proposedRole: 'brand',
			sourceImageId: best.image.imageId,
			// A quantizer reports which colours an image holds, never where. The bucket a pixel
			// landed in says nothing about the pixel's coordinates, and a region covering the
			// scattered pixels of one bucket would be the whole image. Null is the honest answer,
			// and `BrandSeedSchema` makes it a legal one.
			sourceRegion: null,
		},
	];

	// An accent has to be a genuine second colour rather than a tint of the first, so it clears
	// the same separation a derived accent has to clear. Reusing the engine's constant keeps the
	// two in step: an observed accent inside that arc would ship two ramps that read as one.
	const accent = ranked.find(
		(entry) =>
			hueDistance(entry.candidate.oklch.h, best.candidate.oklch.h) >= MIN_ACCENT_SEPARATION &&
			corroborates(entry.candidate, entry.image.secondOpinion),
	);

	if (accent) {
		keyColors.push({
			oklch: toTriple(accent.candidate.oklch),
			proposedRole: 'accent',
			sourceImageId: accent.image.imageId,
			sourceRegion: null,
		});
	}

	return { kind: 'read', keyColors };
}

/**
 * Every field a local read cannot inform, spelled out.
 *
 * `BrandSeedSchema` is a `z.strictObject` whose fields are nullable and never optional, and
 * `parseSeed` hands it the payload with no preprocessing, so a reader that omitted a key would
 * fail validation on every question colour cannot answer. Null is also the answer the interface
 * wants: it records the gap rather than leaving a later reader unable to tell "nothing in the
 * image informed this" from "this field is not in the schema".
 *
 * `neutralTemperature` is the one entry worth arguing about, because a neutral is a colour and the
 * candidates this module rejects are exactly the image's neutrals. It stays null because stating it
 * makes the output worse. `neutralAnchor` in `core/oklch-scale-engine.ts` treats a stated
 * temperature as evidence and overrides its tinting parameter outright, and the neutral a logo on
 * white offers is `{ hue: 0, chroma: 0 }`. Reading that off the page would flatten every neutral
 * ramp to dead grey, overruling the brand tint the engine derives when the field is absent. The
 * greys in an upload are the page's own furniture, and the seed has no way to say so.
 */
const UNINFORMED: Omit<BrandSeed, 'keyColors'> = {
	neutralTemperature: null,
	surfacePolarity: null,
	radiusCharacter: null,
	shadowCharacter: null,
	trackingFeel: null,
	typeClassification: null,
	suggestedPairing: null,
	typeScaleRatio: null,
	imageClassifications: null,
	expressive: null,
};

/**
 * Serializes the findings into the JSON envelope `parseSeed` consumes.
 *
 * A reader returns a string, not a seed. Parsing is the core's job at a trust boundary that every
 * reader has to cross the same way, and a reader that handed back a parsed object would be the one
 * implementation of the seam that skipped it.
 */
export function seedPayload(extraction: LocalExtraction): string {
	return JSON.stringify({
		keyColors: extraction.kind === 'read' ? extraction.keyColors : null,
		...UNINFORMED,
	});
}
