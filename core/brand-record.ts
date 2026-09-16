import { z } from 'zod';

import { BrandSeedSchema } from './brand-seed';
import { TokenSetSchema } from './token-set';

/**
 * Bumped whenever a stored record's shape changes. Parsing rejects anything else, because
 * the export archive is the only migration path and it only works if a mismatch is loud.
 */
export const SCHEMA_VERSION = 1;

/**
 * Only the downscaled image actually sent to the model is stored, plus a hash of the
 * original. That is the true model input, so it is what makes a version reproducible, and
 * it costs a fraction of the original's storage.
 */
export const ReferenceImageSchema = z.object({
	downscaled: z.string().min(1),
	originalHash: z.string().min(1),
});

/**
 * Stage 1 is not bit-reproducible, so reproducibility is achieved by reference: a version
 * names every input that can change its output. `scaleEngine` matters because the same seed
 * under a different engine produces different ramps, and `fontTable` matters because a client
 * that fell back to the in-repo table ranks the same seed differently from one that fetched
 * the full taxonomy. See docs/adr/0001-fetch-google-fonts-tags-at-runtime.md.
 */
export const FontTableRefSchema = z.object({
	source: z.string().min(1),
	version: z.string().min(1),
});

export const BrandVersionSchema = z.object({
	createdAt: z.iso.datetime(),
	seed: BrandSeedSchema.nullable(),
	tokenSet: TokenSetSchema.nullable(),
	provider: z.string().min(1),
	model: z.string().min(1),
	promptVersion: z.string().min(1),
	scaleEngine: z.string().min(1),
	fontTable: FontTableRefSchema,
});

/** Versions are append-only and ordered oldest first, so a record is a history rather than a current value. */
export const BrandRecordSchema = z.object({
	id: z.uuid(),
	schemaVersion: z.literal(SCHEMA_VERSION),
	images: z.array(ReferenceImageSchema),
	versions: z.array(BrandVersionSchema),
});

export type ReferenceImage = z.infer<typeof ReferenceImageSchema>;
export type FontTableRef = z.infer<typeof FontTableRefSchema>;
export type BrandVersion = z.infer<typeof BrandVersionSchema>;
export type BrandRecord = z.infer<typeof BrandRecordSchema>;
