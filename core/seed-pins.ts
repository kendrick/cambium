import { z } from 'zod';

import { type BrandSeed, BrandSeedSchema, type KeyColor } from './brand-seed';
import { type PinKey, pinKey } from './contrast/repair';
import { SCHEME_NAMES } from './scale-engine';
import { BRAND_STEP } from './step-roles';

/**
 * A seed field a person has pinned. Key colours pin one entry at a time, by index, because each is
 * edited in place and pinned on its own; every other field pins whole. An index stays stable within
 * a version since the rail can't add or remove a key colour.
 */
export type SeedPinPath = Exclude<keyof BrandSeed, 'keyColors'> | `keyColors.${number}`;

// `z.templateLiteral` over a non-negative int still accepts `keyColors.-1` and `keyColors.01`, so
// the index is matched by hand. `01` would give one pin two spellings that a set keeps apart.
const KEY_COLOR_PIN = /^keyColors\.(0|[1-9]\d*)$/;

export const SeedPinPathSchema = z.union([
	BrandSeedSchema.keyof().exclude(['keyColors']),
	z.custom<`keyColors.${number}`>(
		(value) => typeof value === 'string' && KEY_COLOR_PIN.test(value),
		{ message: 'expected keyColors.<index>' },
	),
]);

/** The key colour index a pin names, or null for a pin on a whole field. */
export function keyColorIndex(pin: SeedPinPath): number | null {
	const match = KEY_COLOR_PIN.exec(pin);

	return match ? Number(match[1]) : null;
}

/**
 * Every key colour, since each was read out of an image and so is the one thing a person can check
 * against it. Nothing else starts pinned: the other fields are the model's interpretation, which is
 * what a person is most likely to want to move.
 */
export function defaultSeedPins(seed: BrandSeed): SeedPinPath[] {
	return (seed.keyColors ?? []).map((_, index) => `keyColors.${index}` as const);
}

/**
 * The same choice `createOklchScaleEngine` makes: the first key colour proposed for a role wins.
 * Brand falls back to the first key colour of any role, since a seed with colour but no brand still
 * builds one; accent has no fallback, since the engine derives it instead. Restated rather than
 * imported so the engine keeps its picker private, and `core/seed-pins.test.ts` holds the two
 * together by comparing against the steps the engine marks `observed`.
 */
function placedIndices(keyColors: readonly KeyColor[]): { brand: number; accent: number } {
	const firstFor = (role: KeyColor['proposedRole']) =>
		keyColors.findIndex((candidate) => candidate.proposedRole === role);
	const brand = firstFor('brand');

	return { brand: brand === -1 && keyColors.length > 0 ? 0 : brand, accent: firstFor('accent') };
}

/**
 * The steps contrast repair must leave alone for these seed pins. Only a key colour the engine
 * places lands on a step, and it lands on step 9 of its ramp in both schemes. A pinned key colour
 * the engine never placed, or a pin on any other field, protects nothing repair could move.
 */
export function repairPinsFor(seed: BrandSeed, pins: Iterable<SeedPinPath>): Set<PinKey> {
	const keyColors = seed.keyColors ?? [];
	const placed = placedIndices(keyColors);
	const pinnedIndices = new Set<number>();

	for (const pin of pins) {
		const index = keyColorIndex(pin);

		if (index !== null && index < keyColors.length) pinnedIndices.add(index);
	}

	const result = new Set<PinKey>();

	for (const ramp of ['brand', 'accent'] as const) {
		if (!pinnedIndices.has(placed[ramp])) continue;

		for (const scheme of SCHEME_NAMES) result.add(pinKey(scheme, ramp, BRAND_STEP));
	}

	return result;
}
