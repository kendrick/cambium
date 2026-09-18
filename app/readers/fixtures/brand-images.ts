import type { PixelSample } from '../local-extract';

/**
 * Reference images drawn in code rather than vendored as files.
 *
 * Two reasons. The ticket asks for extraction "within a stated tolerance of that image's known
 * brand colour", and a colour is only known if something states it. A downloaded logo's brand
 * colour is whatever the file happens to hold after whoever made the PNG picked a profile and a
 * compressor, which is a value to measure rather than an expectation to assert against. The
 * second reason is licensing: ADR-0001 already refuses to vendor a file whose licence is unclear,
 * and there is nothing here worth reopening that for.
 *
 * Colours are stated as sRGB hex rather than as OKLCH triples. Hex is what a pixel buffer
 * actually holds, so the stated value reaches the extractor with no gamut mapping and no rounding
 * in between; the expected OKLCH comes from `readOklch` on the same hex, which is the conversion
 * the extractor itself runs.
 */
export type BrandImageFixture = {
	id: string;
	kind: 'logo' | 'photo' | 'ui';
	sample: PixelSample;
	/**
	 * The colour a person would name if asked what colour this brand is, and null for an image
	 * that has no such colour. Null is a real expectation rather than a gap: the extractor is
	 * supposed to refuse an image of nothing but greys.
	 */
	brandHex: string | null;
	/** A genuine second colour, where the image has one. */
	accentHex: string | null;
};

const OPAQUE = 255;

function hexToBytes(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.slice(1), 16);

	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function fill(width: number, height: number, hex: string): PixelSample {
	const data = new Uint8ClampedArray(width * height * 4);
	const [r, g, b] = hexToBytes(hex);

	for (let pixel = 0; pixel < width * height; pixel += 1) {
		const i = pixel * 4;
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
		data[i + 3] = OPAQUE;
	}

	return { data, width, height };
}

function rect(
	sample: PixelSample,
	x0: number,
	y0: number,
	width: number,
	height: number,
	hex: string,
) {
	const [r, g, b] = hexToBytes(hex);

	for (let y = y0; y < y0 + height; y += 1) {
		for (let x = x0; x < x0 + width; x += 1) {
			const i = (y * sample.width + x) * 4;
			sample.data[i] = r;
			sample.data[i + 1] = g;
			sample.data[i + 2] = b;
			sample.data[i + 3] = OPAQUE;
		}
	}
}

/**
 * A 32-bit linear congruential generator, seeded per fixture.
 *
 * Seeded rather than `Math.random` because determinism is an acceptance criterion: repeated
 * extraction has to return identical results, and it cannot if the image changes every run.
 */
function seededNoise(seed: number) {
	let state = seed;

	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;

		return state / 0x7fffffff - 0.5;
	};
}

const SIDE = 256;

/**
 * A wordmark: one large saturated mark on white, with a counter knocked out of it and a second
 * colour inside. The easy case, and the one that says the extractor reads a flat region exactly.
 */
function drawLogo(): PixelSample {
	const sample = fill(SIDE, SIDE, '#ffffff');

	rect(sample, 48, 48, 160, 160, '#0b6e4f');
	rect(sample, 96, 96, 64, 64, '#ffffff');
	rect(sample, 112, 112, 32, 32, '#e8a13a');

	return sample;
}

/**
 * An application screenshot, which is the case the ticket is actually worried about: over four
 * fifths of it is near-white and neutral grey, the dark text outweighs everything coloured ten to
 * one, and the brand colour is one small button. Naive extraction returns `#fafafa` here.
 */
function drawScreenshot(): PixelSample {
	const sample = fill(SIDE, SIDE, '#fafafa');

	rect(sample, 0, 0, SIDE, 40, '#f3f4f6');
	rect(sample, 0, 40, 56, SIDE - 40, '#f3f4f6');

	for (let row = 0; row < 12; row += 1) {
		rect(sample, 72, 60 + row * 14, 150, 6, '#111827');
	}

	rect(sample, 190, 10, 56, 20, '#7c3aed');
	rect(sample, 72, 230, 40, 12, '#e5e7eb');

	return sample;
}

/**
 * A photograph: a noisy terracotta field under a blue sky, with no flat region anywhere.
 *
 * The sky is a third of the frame and genuinely coloured rather than grey, so it is a real rival
 * to the terracotta rather than something the neutral floor disposes of. Chroma weighting is what
 * has to pick between them.
 *
 * The terracotta's brightness ramp is symmetric about the stated colour, which is why the ramp is
 * measured across the band it covers rather than across the whole frame. Scaled against the full
 * height it would average brighter than the colour it claims to be, and the extractor would be
 * asked to match a value no part of the image is centred on.
 */
function drawPhotograph(): PixelSample {
	const sample = fill(SIDE, SIDE, '#7ea8d8');
	const horizon = 80;
	const [r, g, b] = hexToBytes('#b5451f');
	const noise = seededNoise(20_260_917);

	for (let y = horizon; y < SIDE; y += 1) {
		const ramp = 0.82 + 0.36 * ((y - horizon) / (SIDE - 1 - horizon));

		for (let x = 0; x < SIDE; x += 1) {
			const i = (y * SIDE + x) * 4;
			const grain = noise() * 24;
			sample.data[i] = r * ramp + grain;
			sample.data[i + 1] = g * ramp + grain;
			sample.data[i + 2] = b * ramp + grain;
			sample.data[i + 3] = OPAQUE;
		}
	}

	for (let y = 0; y < horizon; y += 1) {
		for (let x = 0; x < SIDE; x += 1) {
			const i = (y * SIDE + x) * 4;
			const grain = noise() * 14;
			sample.data[i] += grain;
			sample.data[i + 1] += grain;
			sample.data[i + 2] += grain;
		}
	}

	return sample;
}

/**
 * A dark interface chromed in Tailwind slate, drawn twice: once with a brand button and once
 * without.
 *
 * Slate is the regression case, because it is the one neutral family chromatic enough to reach a
 * plausible floor; `MIN_BRAND_CHROMA` carries the measurements. The variant with no button is the
 * one that caught the bug, because an interface holding no brand colour is the only image where a
 * surviving neutral has nothing to lose to.
 */
function drawSlateUi(withButton: boolean): PixelSample {
	const sample = fill(SIDE, SIDE, '#0f172a');

	rect(sample, 0, 0, SIDE, 40, '#1e293b');
	rect(sample, 0, 40, 64, SIDE - 40, '#1e293b');
	rect(sample, 80, 56, 160, 120, '#334155');

	// slate-500, the family's chroma ceiling at 0.0407 and so the step that binds the floor.
	for (let row = 0; row < 8; row += 1) {
		rect(sample, 92, 68 + row * 14, 130, 6, '#64748b');
	}

	rect(sample, 92, 200, 60, 14, '#475569');

	if (withButton) {
		rect(sample, 190, 10, 52, 20, '#7c3aed');
	}

	return sample;
}

/**
 * Nothing coloured at all: a page of greys. Every candidate sits under the neutral floor, so this
 * is the fixture that proves the extractor returns no brand colour rather than the background.
 */
function drawNeutralPage(): PixelSample {
	const sample = fill(SIDE, SIDE, '#f5f5f5');

	rect(sample, 0, 0, SIDE, 80, '#e5e5e5');
	rect(sample, 0, 80, SIDE, 80, '#9ca3af');
	rect(sample, 0, 160, SIDE, 96, '#374151');

	return sample;
}

export const LOGO_FIXTURE: BrandImageFixture = {
	id: 'fixture-logo',
	kind: 'logo',
	sample: drawLogo(),
	brandHex: '#0b6e4f',
	accentHex: '#e8a13a',
};

export const SCREENSHOT_FIXTURE: BrandImageFixture = {
	id: 'fixture-screenshot',
	kind: 'ui',
	sample: drawScreenshot(),
	brandHex: '#7c3aed',
	accentHex: null,
};

export const PHOTOGRAPH_FIXTURE: BrandImageFixture = {
	id: 'fixture-photograph',
	kind: 'photo',
	sample: drawPhotograph(),
	brandHex: '#b5451f',
	// The sky. A third of the frame and genuinely coloured, so it is a real second colour rather
	// than something the neutral floor was always going to dispose of.
	accentHex: '#7ea8d8',
};

export const SLATE_UI_FIXTURE: BrandImageFixture = {
	id: 'fixture-slate-ui',
	kind: 'ui',
	sample: drawSlateUi(true),
	brandHex: '#7c3aed',
	accentHex: null,
};

export const SLATE_CHROME_FIXTURE: BrandImageFixture = {
	id: 'fixture-slate-chrome',
	kind: 'ui',
	sample: drawSlateUi(false),
	// No brand colour, because the image holds none. Every colour in it is a slate step.
	brandHex: null,
	accentHex: null,
};

export const NEUTRAL_PAGE_FIXTURE: BrandImageFixture = {
	id: 'fixture-neutral-page',
	kind: 'ui',
	sample: drawNeutralPage(),
	brandHex: null,
	accentHex: null,
};

/**
 * The stated tolerance, as one OKLCH distance rather than three per-channel bounds.
 *
 * `oklchDistance` is the same measure `BrandAnchor.deviation` reports, so a figure here means what
 * it means everywhere else in the pipeline, and 0.02 is `ANCHOR_TOLERANCE` in
 * `core/scale-engine.ts`: the deviation the engine already accepts between the brand colour a
 * seed asked for and the one a ramp achieved. A colour closer than that is the same colour as far
 * as anything downstream is concerned. The number is restated here rather than imported, because
 * it answers a different question and should not move when that one does.
 *
 * Measured, so the margin is known rather than hoped for. Both flat fixtures land at 0, because
 * MMCQ returns a flat region's colour byte for byte. The photograph is what sets the figure,
 * because it has no flat region anywhere: the answer there is the centroid of a distribution, and
 * its terracotta lands 0.011 out with its sky 0.014 out.
 */
export const KNOWN_COLOR_TOLERANCE = 0.02;
