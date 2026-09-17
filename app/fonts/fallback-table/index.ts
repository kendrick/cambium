import type { FontTableRef } from '../../../core/brand-record';
import type { FontTable } from '../../../core/font-table';

import { MONO_ROWS } from './mono';
import { SANS_ROWS } from './sans';
import { SERIF_ROWS } from './serif';
import { SLAB_ROWS } from './slab';

/**
 * The table Cambium authors itself, split one module per category so four people can curate
 * without colliding.
 *
 * ADR-0001 keeps any copy of Google's `tags/all/families.csv` out of this repo, so these rows are
 * what answer when the runtime fetch of that file fails: a blocked CDN, an offline visitor, or a
 * content security policy that refuses jsDelivr. The keyless demo is meant to work with no network
 * at all, which makes the failure path ordinary rather than exceptional.
 */
export const FALLBACK_FONT_TABLE: FontTable = [
	...SANS_ROWS,
	...SERIF_ROWS,
	...SLAB_ROWS,
	...MONO_ROWS,
];

/**
 * Stamped onto every version that ranked against `FALLBACK_FONT_TABLE`. A client that fell back
 * ranks a seed differently from one that fetched the full taxonomy, so without this identity the
 * promise that the same seed always produces the same tokens is false across the boundary between
 * them.
 *
 * Bump `version` whenever a row changes, for the same reason. The literal already appears as a
 * fixture in the record, strictness, and RecordStore tests; these rows are what it names.
 */
export const FALLBACK_FONT_TABLE_REF: FontTableRef = {
	source: 'in-repo',
	version: 'cambium-curated-1',
};
