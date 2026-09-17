import type { AuthoredRow } from '../../../core/font-table';

/**
 * Quota: 22 families, the largest share of the table's sixty. Sans is the only category where all
 * three tones have tags of their own, so it is the only one that has to answer three pairs on
 * tone alone.
 *
 * Tone floor: four families each under `/Sans/Geometric` or `/Sans/Superellipse`, under
 * `/Sans/Humanist` or `/Sans/Rounded`, and under `/Sans/Grotesque` or `/Sans/Neo Grotesque`. The
 * coverage test demands three; the fourth is what keeps one disputed call from dropping a pair
 * below the line. Spend the rest on `/Sans/Glyphic` and on second tags for faces that earn them.
 *
 * At least one family here also carries a `/Theme/*` tag. The whole table owes #42's
 * display-versus-body filter four of them, and four agents curating in parallel only reach that
 * total if each file carries its own share.
 *
 * Every family also carries both `/Quality/*` rows and at least three `/Expressive/*` rows,
 * because #42 ranks on the seed's expressive axes and a family tagged on tone alone can never
 * place on them.
 */
export const SANS_ROWS: readonly AuthoredRow[] = [];
