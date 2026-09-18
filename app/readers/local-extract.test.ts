import { describe, expect, it } from 'vitest';

import { BrandSeedSchema, type KeyColor } from '../../core/brand-seed';
import { hueDistance, oklchDistance, readOklch } from '../../core/oklch';
import { MIN_ACCENT_SEPARATION } from '../../core/oklch-scale-engine';
import { parseSeed } from '../../core/parse-seed';

import {
	KNOWN_COLOR_TOLERANCE,
	LOGO_FIXTURE,
	NEUTRAL_PAGE_FIXTURE,
	PHOTOGRAPH_FIXTURE,
	SCREENSHOT_FIXTURE,
} from './fixtures/brand-images';
import {
	type Candidate,
	chooseKeyColors,
	type ImageOpinions,
	MAX_HUE_DISAGREEMENT,
	MIN_BRAND_CHROMA,
	readImageOpinions,
	seedPayload,
} from './local-extract';
import { LOCAL_EXTRACT_VERSION, LOCAL_EXTRACTOR_MODEL, LOCAL_PROVIDER } from './local-reader';

function keyColor(extraction: ReturnType<typeof chooseKeyColors>, role: KeyColor['proposedRole']) {
	return extraction.keyColors?.find((color) => color.proposedRole === role);
}

/** How far a read colour landed from the colour the fixture states it is. */
function distanceFromHex(color: KeyColor | undefined, hex: string): number {
	if (!color) return Number.POSITIVE_INFINITY;

	const [l, c, h] = color.oklch;

	return oklchDistance({ l, c, h }, readOklch(hex));
}

async function extract(fixture: typeof LOGO_FIXTURE) {
	return chooseKeyColors([await readImageOpinions(fixture.id, fixture.sample)]);
}

/** A hand-built opinion, for the branches no fixture provokes. */
function candidate(hex: string, share: number): Candidate {
	const oklch = readOklch(hex);

	return { oklch, share, score: oklch.c * Math.sqrt(share) };
}

function opinions(
	imageId: string,
	primary: Candidate[],
	secondOpinion: Candidate[],
): ImageOpinions {
	return { imageId, primary, secondOpinion };
}

describe('local extraction', () => {
	it.each([
		['a logo', LOGO_FIXTURE],
		['a photograph', PHOTOGRAPH_FIXTURE],
		['an application screenshot', SCREENSHOT_FIXTURE],
	])('reads %s within tolerance of its known brand colour', async (_kind, fixture) => {
		const extraction = await extract(fixture);

		expect(extraction.kind).toBe('read');
		expect(distanceFromHex(keyColor(extraction, 'brand'), fixture.brandHex!)).toBeLessThanOrEqual(
			KNOWN_COLOR_TOLERANCE,
		);
	});

	/**
	 * Pins the figure `MAX_HUE_DISAGREEMENT` is set against. That constant is the alarm, and this
	 * is the room between the alarm and where the two libraries actually sit, so a library update
	 * that moves them apart fails here first and says by how much.
	 */
	it.each([
		['a logo', LOGO_FIXTURE],
		['a photograph', PHOTOGRAPH_FIXTURE],
		['an application screenshot', SCREENSHOT_FIXTURE],
	])('has both libraries agreeing on %s to within two degrees of hue', async (_kind, fixture) => {
		const { primary, secondOpinion } = await readImageOpinions(fixture.id, fixture.sample);
		const nearest = Math.min(
			...secondOpinion.map((other) => hueDistance(other.oklch.h, primary[0]!.oklch.h)),
		);

		expect(nearest).toBeLessThan(2);
		expect(nearest).toBeLessThan(MAX_HUE_DISAGREEMENT);
	});

	it.each([
		["a logo's second mark", LOGO_FIXTURE],
		["a photograph's sky", PHOTOGRAPH_FIXTURE],
	])('reads %s as an accent', async (_kind, fixture) => {
		const extraction = await extract(fixture);

		expect(distanceFromHex(keyColor(extraction, 'accent'), fixture.accentHex!)).toBeLessThanOrEqual(
			KNOWN_COLOR_TOLERANCE,
		);
	});

	it('proposes no accent where the image holds only one colour', async () => {
		const extraction = await extract(SCREENSHOT_FIXTURE);

		expect(keyColor(extraction, 'accent')).toBeUndefined();
	});

	/**
	 * The whole point of the ticket. Over four fifths of this fixture is off-white and grey, and
	 * the dark text alone covers nearly ten times as many pixels as the brand button does.
	 */
	it('returns the button rather than the page background of a screenshot', async () => {
		const brand = keyColor(await extract(SCREENSHOT_FIXTURE), 'brand');
		const [, chroma] = brand!.oklch;

		expect(chroma).toBeGreaterThanOrEqual(MIN_BRAND_CHROMA);
		expect(distanceFromHex(brand, '#fafafa')).toBeGreaterThan(0.3);
		expect(distanceFromHex(brand, '#111827')).toBeGreaterThan(0.3);
	});

	it('claims no brand colour from an image that holds only neutrals', async () => {
		const extraction = await extract(NEUTRAL_PAGE_FIXTURE);

		expect(extraction).toEqual({ kind: 'no-brand-color', reason: 'all-neutral' });
	});

	it('offers no candidate at all from an image that holds only neutrals', async () => {
		const read = await readImageOpinions(NEUTRAL_PAGE_FIXTURE.id, NEUTRAL_PAGE_FIXTURE.sample);

		expect(read.primary).toEqual([]);
		expect(read.secondOpinion).toEqual([]);
	});

	/**
	 * MMCQ quantization is the part of this most likely to drift, and the photograph is where it
	 * would show: it is the only fixture with no flat region, so every candidate is a centroid
	 * rather than a colour read off a byte.
	 */
	it.each([
		['a logo', LOGO_FIXTURE],
		['a photograph', PHOTOGRAPH_FIXTURE],
		['an application screenshot', SCREENSHOT_FIXTURE],
		['a page of greys', NEUTRAL_PAGE_FIXTURE],
	])('returns identical results for repeated extraction from %s', async (_kind, fixture) => {
		const first = await extract(fixture);
		const second = await extract(fixture);

		expect(seedPayload(second)).toBe(seedPayload(first));
	});

	it('names the image each colour came from when several were uploaded', async () => {
		const extraction = chooseKeyColors([
			await readImageOpinions(LOGO_FIXTURE.id, LOGO_FIXTURE.sample),
			await readImageOpinions(SCREENSHOT_FIXTURE.id, SCREENSHOT_FIXTURE.sample),
		]);

		for (const color of extraction.keyColors ?? []) {
			expect([LOGO_FIXTURE.id, SCREENSHOT_FIXTURE.id]).toContain(color.sourceImageId);
		}

		// The logo's mark covers a third of its frame and the screenshot's button covers under two
		// per cent of its own, so the logo has to win the brand slot.
		expect(keyColor(extraction, 'brand')?.sourceImageId).toBe(LOGO_FIXTURE.id);
	});
});

describe('the corroboration rule', () => {
	it('claims nothing when only one library saw the strongest colour', () => {
		const extraction = chooseKeyColors([
			opinions('img-1', [candidate('#7c3aed', 0.4)], [candidate('#16a34a', 0.4)]),
		]);

		expect(extraction).toEqual({ kind: 'no-brand-color', reason: 'uncorroborated' });
	});

	it('does not fall through to a runner-up both libraries did see', () => {
		const extraction = chooseKeyColors([
			opinions(
				'img-1',
				[candidate('#7c3aed', 0.4), candidate('#16a34a', 0.2)],
				[candidate('#16a34a', 0.2)],
			),
		]);

		expect(extraction.kind).toBe('no-brand-color');
	});

	it('accepts a second opinion that agrees on hue while disagreeing on lightness', () => {
		// Vibrant bands its palette roles by HSL lightness, so its reading of one brand colour
		// routinely arrives lighter or darker than the colour itself.
		const extraction = chooseKeyColors([
			opinions('img-1', [candidate('#7c3aed', 0.4)], [candidate('#c4a4f4', 0.4)]),
		]);

		expect(extraction.kind).toBe('read');
	});

	it('rejects a second opinion further away in hue than the tolerance allows', () => {
		const brand = readOklch('#7c3aed');
		const near = readOklch('#3a7ced');

		expect(Math.abs(((near.h - brand.h + 540) % 360) - 180)).toBeGreaterThan(MAX_HUE_DISAGREEMENT);
		expect(
			chooseKeyColors([opinions('img-1', [candidate('#7c3aed', 0.4)], [candidate('#3a7ced', 0.4)])])
				.kind,
		).toBe('no-brand-color');
	});
});

describe('the accent rule', () => {
	it('refuses an accent sitting inside the brand hue arc', () => {
		const brand = readOklch('#0b6e4f');
		const tint = readOklch('#14a375');

		expect(Math.abs(((tint.h - brand.h + 540) % 360) - 180)).toBeLessThan(MIN_ACCENT_SEPARATION);

		const extraction = chooseKeyColors([
			opinions(
				'img-1',
				[candidate('#0b6e4f', 0.4), candidate('#14a375', 0.2)],
				[candidate('#0b6e4f', 0.4), candidate('#14a375', 0.2)],
			),
		]);

		expect(extraction.keyColors).toHaveLength(1);
	});

	it('refuses an accent only one library saw', () => {
		const extraction = chooseKeyColors([
			opinions(
				'img-1',
				// The brand's share has to carry it past the amber, which is half again as chromatic.
				[candidate('#0b6e4f', 0.8), candidate('#e8a13a', 0.2)],
				[candidate('#0b6e4f', 0.8)],
			),
		]);

		expect(extraction.keyColors).toHaveLength(1);
	});
});

describe('the seed envelope', () => {
	it('parses through the core, which is the only thing that parses a reader response', async () => {
		const result = parseSeed({
			raw: seedPayload(await extract(SCREENSHOT_FIXTURE)),
			provider: LOCAL_PROVIDER,
			model: LOCAL_EXTRACTOR_MODEL,
			promptVersion: LOCAL_EXTRACT_VERSION,
		});

		expect(result.error).toBeUndefined();
		expect(result.seed?.keyColors).toHaveLength(1);
	});

	/**
	 * `BrandSeedSchema` is a `z.strictObject` whose fields are nullable and never optional, so
	 * "leave the field absent" means a present key holding null. A payload that dropped the keys
	 * would fail validation on every one of them.
	 */
	it('emits every key colour cannot inform, holding null', async () => {
		const payload: unknown = JSON.parse(seedPayload(await extract(LOGO_FIXTURE)));
		const uninformed = Object.keys(BrandSeedSchema.shape).filter((key) => key !== 'keyColors');

		expect(new Set(Object.keys(payload as object))).toEqual(
			new Set(Object.keys(BrandSeedSchema.shape)),
		);

		for (const key of uninformed) {
			expect((payload as Record<string, unknown>)[key]).toBeNull();
		}
	});

	it('emits a null keyColors rather than an empty list when it found no colour', async () => {
		const payload = JSON.parse(seedPayload(await extract(NEUTRAL_PAGE_FIXTURE))) as {
			keyColors: unknown;
		};

		expect(payload.keyColors).toBeNull();
		expect(BrandSeedSchema.safeParse(payload).success).toBe(true);
	});
});
