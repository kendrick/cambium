import type { AuthoredRow } from '../../../core/font-table';

/**
 * Quota: 16 families.
 *
 * Tone floor: four families under `/Serif/Humanist Venetian` or `/Serif/Old Style Garalde`, which
 * is the one serif tone the taxonomy has tags for. A seed asking for a geometric or grotesque
 * serif falls back to every `/Serif/*` row in this file, so breadth across `/Serif/Didone`,
 * `/Serif/Modern`, `/Serif/Scotch`, `/Serif/Transitional`, and `/Serif/Fat Face` is what answers
 * those two pairs.
 *
 * At least one family here also carries a `/Theme/*` tag. The whole table owes #42's
 * display-versus-body filter four of them, and four agents curating in parallel only reach that
 * total if each file carries its own share.
 *
 * Every family also carries both `/Quality/*` rows and at least three `/Expressive/*` rows,
 * because #42 ranks on the seed's expressive axes and a family tagged on tone alone can never
 * place on them.
 */
export const SERIF_ROWS: readonly AuthoredRow[] = [];
