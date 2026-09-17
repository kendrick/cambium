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
 * No family here carries a `/Theme/*` tag, because no serif in this list honestly reads as one of
 * the five theme names. The table owes #42's display-versus-body filter four themed families and
 * the other three category files supply them, which `fallback-table.test.ts` asserts table-wide.
 *
 * Every family also carries both `/Quality/*` rows and at least three `/Expressive/*` rows,
 * because #42 ranks on the seed's expressive axes and a family tagged on tone alone can never
 * place on them.
 */
export const SERIF_ROWS: readonly AuthoredRow[] = [
	// Seven families here, against a tone floor of four. These rows are the entire pool a
	// `serif / humanist` seed ever ranks, and at four families #42 hands back near enough the
	// same list to every seed that asks for the tone.
	{ family: 'EB Garamond', tag: '/Serif/Old Style Garalde', score: 100 },
	{ family: 'EB Garamond', tag: '/Serif/Humanist Venetian', score: 60 },
	{ family: 'EB Garamond', tag: '/Quality/Spacing', score: 90 },
	{ family: 'EB Garamond', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'EB Garamond', tag: '/Expressive/Sophisticated', score: 80 },
	{ family: 'EB Garamond', tag: '/Expressive/Vintage', score: 70 },
	{ family: 'EB Garamond', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'EB Garamond', tag: '/Expressive/Calm', score: 60 },
	{ family: 'EB Garamond', tag: '/Expressive/Competent', score: 60 },

	{ family: 'Sorts Mill Goudy', tag: '/Serif/Old Style Garalde', score: 90 },
	{ family: 'Sorts Mill Goudy', tag: '/Serif/Humanist Venetian', score: 80 },
	{ family: 'Sorts Mill Goudy', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Sorts Mill Goudy', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Sorts Mill Goudy', tag: '/Expressive/Vintage', score: 90 },
	{ family: 'Sorts Mill Goudy', tag: '/Expressive/Sincere', score: 80 },
	{ family: 'Sorts Mill Goudy', tag: '/Expressive/Artistic', score: 60 },
	{ family: 'Sorts Mill Goudy', tag: '/Expressive/Calm', score: 50 },

	{ family: 'Cardo', tag: '/Serif/Humanist Venetian', score: 90 },
	{ family: 'Cardo', tag: '/Serif/Old Style Garalde', score: 70 },
	{ family: 'Cardo', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Cardo', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Cardo', tag: '/Expressive/Vintage', score: 80 },
	{ family: 'Cardo', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Cardo', tag: '/Expressive/Calm', score: 60 },
	{ family: 'Cardo', tag: '/Expressive/Competent', score: 50 },

	{ family: 'Alegreya', tag: '/Serif/Humanist Venetian', score: 70 },
	{ family: 'Alegreya', tag: '/Serif/Old Style Garalde', score: 60 },
	{ family: 'Alegreya', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Alegreya', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Alegreya', tag: '/Expressive/Artistic', score: 70 },
	{ family: 'Alegreya', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Alegreya', tag: '/Expressive/Competent', score: 60 },
	{ family: 'Alegreya', tag: '/Expressive/Active', score: 50 },
	{ family: 'Alegreya', tag: '/Expressive/Happy', score: 40 },

	{ family: 'Crimson Pro', tag: '/Serif/Old Style Garalde', score: 90 },
	{ family: 'Crimson Pro', tag: '/Serif/Transitional', score: 50 },
	{ family: 'Crimson Pro', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Crimson Pro', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Crimson Pro', tag: '/Expressive/Competent', score: 70 },
	{ family: 'Crimson Pro', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Crimson Pro', tag: '/Expressive/Calm', score: 60 },
	{ family: 'Crimson Pro', tag: '/Expressive/Sophisticated', score: 60 },

	{ family: 'Cormorant Garamond', tag: '/Serif/Old Style Garalde', score: 80 },
	{ family: 'Cormorant Garamond', tag: '/Serif/Modern', score: 50 },
	{ family: 'Cormorant Garamond', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Cormorant Garamond', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Cormorant Garamond', tag: '/Expressive/Fancy', score: 90 },
	{ family: 'Cormorant Garamond', tag: '/Expressive/Sophisticated', score: 90 },
	{ family: 'Cormorant Garamond', tag: '/Expressive/Artistic', score: 70 },
	{ family: 'Cormorant Garamond', tag: '/Expressive/Calm', score: 50 },

	{ family: 'Source Serif 4', tag: '/Serif/Transitional', score: 90 },
	{ family: 'Source Serif 4', tag: '/Serif/Old Style Garalde', score: 40 },
	{ family: 'Source Serif 4', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Source Serif 4', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Source Serif 4', tag: '/Expressive/Competent', score: 90 },
	{ family: 'Source Serif 4', tag: '/Expressive/Business', score: 70 },
	{ family: 'Source Serif 4', tag: '/Expressive/Calm', score: 60 },
	{ family: 'Source Serif 4', tag: '/Expressive/Innovative', score: 50 },

	// A seed asking for a geometric or grotesque serif gets the whole category back, so these
	// faces carry the high `/Quality/*` scores that keep #42 from answering an ordinary
	// paragraph with a Didone.
	{ family: 'Libre Baskerville', tag: '/Serif/Transitional', score: 100 },
	{ family: 'Libre Baskerville', tag: '/Serif/Scotch', score: 50 },
	{ family: 'Libre Baskerville', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Libre Baskerville', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Libre Baskerville', tag: '/Expressive/Competent', score: 80 },
	{ family: 'Libre Baskerville', tag: '/Expressive/Business', score: 70 },
	{ family: 'Libre Baskerville', tag: '/Expressive/Sincere', score: 60 },
	{ family: 'Libre Baskerville', tag: '/Expressive/Stiff', score: 50 },

	{ family: 'PT Serif', tag: '/Serif/Transitional', score: 80 },
	{ family: 'PT Serif', tag: '/Serif/Modern', score: 50 },
	{ family: 'PT Serif', tag: '/Quality/Spacing', score: 90 },
	{ family: 'PT Serif', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'PT Serif', tag: '/Expressive/Competent', score: 80 },
	{ family: 'PT Serif', tag: '/Expressive/Business', score: 70 },
	{ family: 'PT Serif', tag: '/Expressive/Stiff', score: 60 },
	{ family: 'PT Serif', tag: '/Expressive/Sincere', score: 50 },

	{ family: 'Lora', tag: '/Serif/Transitional', score: 70 },
	{ family: 'Lora', tag: '/Serif/Scotch', score: 50 },
	{ family: 'Lora', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Lora', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Lora', tag: '/Expressive/Calm', score: 70 },
	{ family: 'Lora', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Lora', tag: '/Expressive/Artistic', score: 60 },
	{ family: 'Lora', tag: '/Expressive/Sophisticated', score: 50 },

	{ family: 'Spectral', tag: '/Serif/Modern', score: 70 },
	{ family: 'Spectral', tag: '/Serif/Transitional', score: 60 },
	{ family: 'Spectral', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Spectral', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Spectral', tag: '/Expressive/Competent', score: 70 },
	{ family: 'Spectral', tag: '/Expressive/Innovative', score: 60 },
	{ family: 'Spectral', tag: '/Expressive/Calm', score: 60 },
	{ family: 'Spectral', tag: '/Expressive/Business', score: 50 },
	{ family: 'Spectral', tag: '/Expressive/Futuristic', score: 40 },

	{ family: 'Gelasio', tag: '/Serif/Scotch', score: 80 },
	{ family: 'Gelasio', tag: '/Serif/Transitional', score: 60 },
	{ family: 'Gelasio', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Gelasio', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Gelasio', tag: '/Expressive/Business', score: 70 },
	{ family: 'Gelasio', tag: '/Expressive/Competent', score: 70 },
	{ family: 'Gelasio', tag: '/Expressive/Sincere', score: 60 },
	{ family: 'Gelasio', tag: '/Expressive/Calm', score: 50 },

	// `/Serif/Fat Face` rides on the black weights of Playfair Display and Bodoni Moda because
	// the faces that are only fat faces, Abril Fatface among them, file under display or slab on
	// Google Fonts. Authoring one here would file that family under two categories at once, and
	// the coverage test rejects exactly that.
	{ family: 'Playfair Display', tag: '/Serif/Didone', score: 90 },
	{ family: 'Playfair Display', tag: '/Serif/Scotch', score: 70 },
	{ family: 'Playfair Display', tag: '/Serif/Fat Face', score: 60 },
	{ family: 'Playfair Display', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Playfair Display', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Playfair Display', tag: '/Expressive/Fancy', score: 90 },
	{ family: 'Playfair Display', tag: '/Expressive/Sophisticated', score: 80 },
	{ family: 'Playfair Display', tag: '/Expressive/Vintage', score: 60 },
	{ family: 'Playfair Display', tag: '/Expressive/Loud', score: 60 },

	{ family: 'Bodoni Moda', tag: '/Serif/Didone', score: 100 },
	{ family: 'Bodoni Moda', tag: '/Serif/Modern', score: 80 },
	{ family: 'Bodoni Moda', tag: '/Serif/Fat Face', score: 50 },
	{ family: 'Bodoni Moda', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Bodoni Moda', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Bodoni Moda', tag: '/Expressive/Sophisticated', score: 100 },
	{ family: 'Bodoni Moda', tag: '/Expressive/Fancy', score: 90 },
	{ family: 'Bodoni Moda', tag: '/Expressive/Stiff', score: 60 },
	{ family: 'Bodoni Moda', tag: '/Expressive/Business', score: 50 },

	{ family: 'Prata', tag: '/Serif/Didone', score: 80 },
	{ family: 'Prata', tag: '/Serif/Modern', score: 60 },
	{ family: 'Prata', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Prata', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Prata', tag: '/Expressive/Fancy', score: 80 },
	{ family: 'Prata', tag: '/Expressive/Sophisticated', score: 80 },
	{ family: 'Prata', tag: '/Expressive/Calm', score: 50 },
	{ family: 'Prata', tag: '/Expressive/Vintage', score: 50 },

	// Grenze carries no `/Theme/*` row. It is a sharp-cut latin serif, and the blackletter face
	// that shares its name is Grenze Gotisch, a different family. The table's four themed
	// families all sit in the other three category files.
	{ family: 'Grenze', tag: '/Serif/Transitional', score: 50 },
	{ family: 'Grenze', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Grenze', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Grenze', tag: '/Expressive/Vintage', score: 80 },
	{ family: 'Grenze', tag: '/Expressive/Rugged', score: 70 },
	{ family: 'Grenze', tag: '/Expressive/Artistic', score: 60 },
	{ family: 'Grenze', tag: '/Expressive/Awkward', score: 50 },
	{ family: 'Grenze', tag: '/Expressive/Loud', score: 40 },
];
