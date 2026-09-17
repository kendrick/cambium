import type { AuthoredRow } from '../../../core/font-table';

/**
 * Quota: 10 families.
 *
 * Tone floor: three families under `/Slab/Geometric` and three under `/Slab/Humanist`. A seed asking
 * for a grotesque slab falls back to every `/Slab/*` row in this file, `/Slab/Clarendon` included,
 * so that pair is covered as soon as the other two are.
 *
 * At least one family here also carries a `/Theme/*` tag. The table owes #42's
 * display-versus-body filter four of them, asserted table-wide in `fallback-table.test.ts`, and
 * dropping this file's share is what would put that floor at risk.
 *
 * Every family also carries both `/Quality/*` rows and at least three `/Expressive/*` rows,
 * because #42 ranks on the seed's expressive axes and a family tagged on tone alone can never
 * place on them.
 */
export const SLAB_ROWS: readonly AuthoredRow[] = [
	// Tone follows the skeleton under the letters. Even strokes on a compass-drawn frame put a
	// family under geometric, modulated strokes on a pen-drawn frame put it under humanist, and the
	// serif shape decides only Clarendon. Three families per tone is the floor, so a face filed on
	// the wrong side of that line leaves a tone short.
	{ family: 'Arvo', tag: '/Slab/Geometric', score: 100 },
	{ family: 'Arvo', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Arvo', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Arvo', tag: '/Expressive/Competent', score: 80 },
	{ family: 'Arvo', tag: '/Expressive/Business', score: 70 },
	{ family: 'Arvo', tag: '/Expressive/Stiff', score: 60 },
	{ family: 'Arvo', tag: '/Expressive/Sincere', score: 60 },

	{ family: 'Rokkitt', tag: '/Slab/Geometric', score: 90 },
	{ family: 'Rokkitt', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Rokkitt', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Rokkitt', tag: '/Expressive/Competent', score: 60 },
	{ family: 'Rokkitt', tag: '/Expressive/Active', score: 60 },
	{ family: 'Rokkitt', tag: '/Expressive/Vintage', score: 50 },
	{ family: 'Rokkitt', tag: '/Expressive/Sincere', score: 50 },

	{ family: 'Josefin Slab', tag: '/Slab/Geometric', score: 80 },
	{ family: 'Josefin Slab', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Josefin Slab', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Josefin Slab', tag: '/Expressive/Vintage', score: 90 },
	{ family: 'Josefin Slab', tag: '/Expressive/Fancy', score: 70 },
	{ family: 'Josefin Slab', tag: '/Expressive/Sophisticated', score: 70 },
	{ family: 'Josefin Slab', tag: '/Expressive/Artistic', score: 60 },
	{ family: 'Josefin Slab', tag: '/Expressive/Calm', score: 50 },

	{ family: 'Roboto Slab', tag: '/Slab/Geometric', score: 70 },
	{ family: 'Roboto Slab', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Roboto Slab', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Roboto Slab', tag: '/Expressive/Competent', score: 90 },
	{ family: 'Roboto Slab', tag: '/Expressive/Business', score: 80 },
	{ family: 'Roboto Slab', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Roboto Slab', tag: '/Expressive/Calm', score: 60 },

	// The file's one `/Theme/*` family. #42 reads that prefix to keep a display face out of body
	// copy, and the filter has nothing to act on unless each category file carries one.
	{ family: 'Stardos Stencil', tag: '/Slab/Geometric', score: 60 },
	{ family: 'Stardos Stencil', tag: '/Theme/Stencil', score: 100 },
	// A low score rather than a missing row. The two `/Quality/*` tags are #42's body signal, so a
	// family without them drops out of `craft` ranking instead of ranking last, and this face
	// belongs last.
	{ family: 'Stardos Stencil', tag: '/Quality/Spacing', score: 50 },
	{ family: 'Stardos Stencil', tag: '/Quality/Wordspace', score: 40 },
	{ family: 'Stardos Stencil', tag: '/Expressive/Rugged', score: 90 },
	{ family: 'Stardos Stencil', tag: '/Expressive/Loud', score: 70 },
	{ family: 'Stardos Stencil', tag: '/Expressive/Active', score: 60 },
	{ family: 'Stardos Stencil', tag: '/Expressive/Awkward', score: 50 },

	{ family: 'Enriqueta', tag: '/Slab/Humanist', score: 90 },
	{ family: 'Enriqueta', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Enriqueta', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Enriqueta', tag: '/Expressive/Sincere', score: 80 },
	{ family: 'Enriqueta', tag: '/Expressive/Calm', score: 70 },
	{ family: 'Enriqueta', tag: '/Expressive/Competent', score: 70 },
	{ family: 'Enriqueta', tag: '/Expressive/Sophisticated', score: 60 },

	{ family: 'Crete Round', tag: '/Slab/Humanist', score: 90 },
	{ family: 'Crete Round', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Crete Round', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Crete Round', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Crete Round', tag: '/Expressive/Happy', score: 60 },
	{ family: 'Crete Round', tag: '/Expressive/Playful', score: 60 },
	{ family: 'Crete Round', tag: '/Expressive/Calm', score: 50 },
	{ family: 'Crete Round', tag: '/Expressive/Artistic', score: 50 },

	{ family: 'Bitter', tag: '/Slab/Humanist', score: 80 },
	{ family: 'Bitter', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Bitter', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Bitter', tag: '/Expressive/Competent', score: 80 },
	{ family: 'Bitter', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Bitter', tag: '/Expressive/Business', score: 60 },
	{ family: 'Bitter', tag: '/Expressive/Calm', score: 50 },

	// Clarendon also answers a grotesque-slab seed. The taxonomy has no grotesque slab tag, so that
	// pair falls back to the whole category, these rows included.
	{ family: 'Sanchez', tag: '/Slab/Clarendon', score: 90 },
	{ family: 'Sanchez', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Sanchez', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Sanchez', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Sanchez', tag: '/Expressive/Competent', score: 70 },
	{ family: 'Sanchez', tag: '/Expressive/Sophisticated', score: 60 },
	{ family: 'Sanchez', tag: '/Expressive/Vintage', score: 60 },

	{ family: 'Alfa Slab One', tag: '/Slab/Clarendon', score: 100 },
	{ family: 'Alfa Slab One', tag: '/Quality/Spacing', score: 50 },
	{ family: 'Alfa Slab One', tag: '/Quality/Wordspace', score: 50 },
	{ family: 'Alfa Slab One', tag: '/Expressive/Loud', score: 100 },
	{ family: 'Alfa Slab One', tag: '/Expressive/Excited', score: 70 },
	{ family: 'Alfa Slab One', tag: '/Expressive/Vintage', score: 60 },
	{ family: 'Alfa Slab One', tag: '/Expressive/Active', score: 60 },
	{ family: 'Alfa Slab One', tag: '/Expressive/Rugged', score: 50 },
];
