import type { AuthoredRow } from '../../../core/font-table';

/**
 * Quota: 10 families, all on `/Monospace/Monospace`.
 *
 * No tone floor, because the taxonomy carries no tones under monospace. All three mono pairs a
 * seed can express fall back to the category and therefore to this file, which is why ten
 * families still has to read as a real choice rather than a formality.
 *
 * At least one family here also carries a `/Theme/*` tag. The whole table owes #42's
 * display-versus-body filter four of them, and four agents curating in parallel only reach that
 * total if each file carries its own share.
 *
 * Every family also carries both `/Quality/*` rows and at least three `/Expressive/*` rows,
 * because #42 ranks on the seed's expressive axes and a family tagged on tone alone can never
 * place on them.
 */
export const MONO_ROWS: readonly AuthoredRow[] = [];
