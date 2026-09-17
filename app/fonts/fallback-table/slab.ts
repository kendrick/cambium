import type { AuthoredRow } from '../../../core/font-table';

/**
 * Quota: 10 families.
 *
 * Tone floor: three families under `/Slab/Geometric` and three under `/Slab/Humanist`. A seed asking
 * for a grotesque slab falls back to every `/Slab/*` row in this file, `/Slab/Clarendon` included,
 * so that pair is covered as soon as the other two are.
 *
 * At least one family here also carries a `/Theme/*` tag. The whole table owes #42's
 * display-versus-body filter four of them, and four agents curating in parallel only reach that
 * total if each file carries its own share.
 *
 * Every family also carries both `/Quality/*` rows and at least three `/Expressive/*` rows,
 * because #42 ranks on the seed's expressive axes and a family tagged on tone alone can never
 * place on them.
 */
export const SLAB_ROWS: readonly AuthoredRow[] = [];
