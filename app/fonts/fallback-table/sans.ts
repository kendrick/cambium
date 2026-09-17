import type { AuthoredRow } from '../../../core/font-table';

/**
 * Quota: 22 families, the largest share of the table's fifty-eight. Sans is the only category where all
 * three tones have tags of their own, so it is the only one that has to answer three pairs on
 * tone alone.
 *
 * Tone floor: four families each under `/Sans/Geometric` or `/Sans/Superellipse`, under
 * `/Sans/Humanist` or `/Sans/Rounded`, and under `/Sans/Grotesque` or `/Sans/Neo Grotesque`. The
 * coverage test demands three; the fourth is what keeps one disputed call from dropping a pair
 * below the line. Spend the rest on `/Sans/Glyphic` and on second tags for faces that earn them.
 *
 * At least one family here also carries a `/Theme/*` tag. The table owes #42's
 * display-versus-body filter four of them, asserted table-wide in `fallback-table.test.ts`, and
 * dropping this file's share is what would put that floor at risk.
 *
 * Every family also carries both `/Quality/*` rows and at least three `/Expressive/*` rows,
 * because #42 ranks on the seed's expressive axes and a family tagged on tone alone can never
 * place on them.
 */
export const SANS_ROWS: readonly AuthoredRow[] = [
	// Geometric runs nine families deep against a floor of four because four of them carry it as a
	// second reading under a rounded or grotesque first tag. Without those, a geometric seed would
	// rank five variations on the same circle and line.
	{ family: 'Poppins', tag: '/Sans/Geometric', score: 100 },
	{ family: 'Poppins', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Poppins', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Poppins', tag: '/Expressive/Playful', score: 70 },
	{ family: 'Poppins', tag: '/Expressive/Happy', score: 70 },
	{ family: 'Poppins', tag: '/Expressive/Innovative', score: 60 },
	{ family: 'Poppins', tag: '/Expressive/Childlike', score: 50 },

	{ family: 'Jost', tag: '/Sans/Geometric', score: 100 },
	{ family: 'Jost', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Jost', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Jost', tag: '/Expressive/Sophisticated', score: 70 },
	{ family: 'Jost', tag: '/Expressive/Business', score: 70 },
	{ family: 'Jost', tag: '/Expressive/Stiff', score: 60 },
	{ family: 'Jost', tag: '/Expressive/Vintage', score: 50 },

	{ family: 'Outfit', tag: '/Sans/Geometric', score: 90 },
	{ family: 'Outfit', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Outfit', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Outfit', tag: '/Expressive/Innovative', score: 70 },
	{ family: 'Outfit', tag: '/Expressive/Calm', score: 60 },
	{ family: 'Outfit', tag: '/Expressive/Competent', score: 60 },

	// Montserrat's capitals are circle and line; its lowercase carries enough grotesque weight to
	// set at text size. Both readings are real, so both get a row.
	{ family: 'Montserrat', tag: '/Sans/Geometric', score: 80 },
	{ family: 'Montserrat', tag: '/Sans/Grotesque', score: 50 },
	{ family: 'Montserrat', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Montserrat', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Montserrat', tag: '/Expressive/Business', score: 80 },
	{ family: 'Montserrat', tag: '/Expressive/Competent', score: 80 },
	{ family: 'Montserrat', tag: '/Expressive/Sincere', score: 60 },

	// Orbitron and Michroma are drawn for headlines, and the fit shows it in a paragraph. The low
	// `/Quality/*` scores are what stops #42 from offering either as body text.
	{ family: 'Orbitron', tag: '/Sans/Superellipse', score: 100 },
	{ family: 'Orbitron', tag: '/Sans/Geometric', score: 70 },
	{ family: 'Orbitron', tag: '/Quality/Spacing', score: 50 },
	{ family: 'Orbitron', tag: '/Quality/Wordspace', score: 40 },
	{ family: 'Orbitron', tag: '/Expressive/Futuristic', score: 100 },
	{ family: 'Orbitron', tag: '/Expressive/Stiff', score: 70 },
	{ family: 'Orbitron', tag: '/Expressive/Loud', score: 60 },
	{ family: 'Orbitron', tag: '/Expressive/Excited', score: 50 },

	{ family: 'Michroma', tag: '/Sans/Superellipse', score: 100 },
	{ family: 'Michroma', tag: '/Quality/Spacing', score: 50 },
	{ family: 'Michroma', tag: '/Quality/Wordspace', score: 40 },
	{ family: 'Michroma', tag: '/Expressive/Futuristic', score: 90 },
	{ family: 'Michroma', tag: '/Expressive/Stiff', score: 80 },
	{ family: 'Michroma', tag: '/Expressive/Competent', score: 50 },

	{ family: 'Open Sans', tag: '/Sans/Humanist', score: 90 },
	{ family: 'Open Sans', tag: '/Quality/Spacing', score: 100 },
	{ family: 'Open Sans', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Open Sans', tag: '/Expressive/Sincere', score: 80 },
	{ family: 'Open Sans', tag: '/Expressive/Competent', score: 80 },
	{ family: 'Open Sans', tag: '/Expressive/Calm', score: 60 },

	{ family: 'Source Sans 3', tag: '/Sans/Humanist', score: 100 },
	{ family: 'Source Sans 3', tag: '/Quality/Spacing', score: 100 },
	{ family: 'Source Sans 3', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Source Sans 3', tag: '/Expressive/Competent', score: 90 },
	{ family: 'Source Sans 3', tag: '/Expressive/Business', score: 70 },
	{ family: 'Source Sans 3', tag: '/Expressive/Sincere', score: 70 },

	{ family: 'Lato', tag: '/Sans/Humanist', score: 80 },
	{ family: 'Lato', tag: '/Sans/Neo Grotesque', score: 50 },
	{ family: 'Lato', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Lato', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Lato', tag: '/Expressive/Sincere', score: 80 },
	{ family: 'Lato', tag: '/Expressive/Calm', score: 70 },
	{ family: 'Lato', tag: '/Expressive/Competent', score: 70 },

	{ family: 'Fira Sans', tag: '/Sans/Humanist', score: 90 },
	{ family: 'Fira Sans', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Fira Sans', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Fira Sans', tag: '/Expressive/Competent', score: 80 },
	{ family: 'Fira Sans', tag: '/Expressive/Innovative', score: 60 },
	{ family: 'Fira Sans', tag: '/Expressive/Active', score: 50 },

	// `/Sans/Rounded` is the only tag in the whole table that reads as warmth, so a cute or
	// childlike seed has nowhere else to land. Four families carry it, which is enough to rank.
	{ family: 'Nunito', tag: '/Sans/Rounded', score: 90 },
	{ family: 'Nunito', tag: '/Sans/Humanist', score: 60 },
	{ family: 'Nunito', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Nunito', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Nunito', tag: '/Expressive/Happy', score: 70 },
	{ family: 'Nunito', tag: '/Expressive/Calm', score: 70 },
	{ family: 'Nunito', tag: '/Expressive/Cute', score: 60 },
	{ family: 'Nunito', tag: '/Expressive/Sincere', score: 50 },

	{ family: 'Quicksand', tag: '/Sans/Rounded', score: 100 },
	{ family: 'Quicksand', tag: '/Sans/Geometric', score: 80 },
	{ family: 'Quicksand', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Quicksand', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Quicksand', tag: '/Expressive/Cute', score: 80 },
	{ family: 'Quicksand', tag: '/Expressive/Childlike', score: 70 },
	{ family: 'Quicksand', tag: '/Expressive/Calm', score: 70 },
	{ family: 'Quicksand', tag: '/Expressive/Happy', score: 60 },

	{ family: 'Varela Round', tag: '/Sans/Rounded', score: 100 },
	{ family: 'Varela Round', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Varela Round', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Varela Round', tag: '/Expressive/Cute', score: 70 },
	{ family: 'Varela Round', tag: '/Expressive/Happy', score: 70 },
	{ family: 'Varela Round', tag: '/Expressive/Calm', score: 60 },

	{ family: 'Comfortaa', tag: '/Sans/Rounded', score: 100 },
	{ family: 'Comfortaa', tag: '/Sans/Geometric', score: 70 },
	{ family: 'Comfortaa', tag: '/Quality/Spacing', score: 60 },
	{ family: 'Comfortaa', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'Comfortaa', tag: '/Expressive/Cute', score: 90 },
	{ family: 'Comfortaa', tag: '/Expressive/Childlike', score: 70 },
	{ family: 'Comfortaa', tag: '/Expressive/Playful', score: 70 },
	{ family: 'Comfortaa', tag: '/Expressive/Awkward', score: 40 },

	// Grotesque and neo grotesque split on a judgment call for almost every face. Each family below
	// carries whichever reading leads, and a second row only where both are legible.
	{ family: 'Roboto', tag: '/Sans/Neo Grotesque', score: 90 },
	{ family: 'Roboto', tag: '/Sans/Grotesque', score: 60 },
	{ family: 'Roboto', tag: '/Quality/Spacing', score: 100 },
	{ family: 'Roboto', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Roboto', tag: '/Expressive/Competent', score: 90 },
	{ family: 'Roboto', tag: '/Expressive/Business', score: 70 },
	{ family: 'Roboto', tag: '/Expressive/Stiff', score: 50 },

	{ family: 'Inter', tag: '/Sans/Neo Grotesque', score: 100 },
	{ family: 'Inter', tag: '/Quality/Spacing', score: 100 },
	{ family: 'Inter', tag: '/Quality/Wordspace', score: 100 },
	{ family: 'Inter', tag: '/Expressive/Competent', score: 100 },
	{ family: 'Inter', tag: '/Expressive/Business', score: 80 },
	{ family: 'Inter', tag: '/Expressive/Innovative', score: 60 },
	{ family: 'Inter', tag: '/Expressive/Stiff', score: 50 },

	{ family: 'Work Sans', tag: '/Sans/Grotesque', score: 80 },
	{ family: 'Work Sans', tag: '/Sans/Neo Grotesque', score: 60 },
	{ family: 'Work Sans', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Work Sans', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Work Sans', tag: '/Expressive/Competent', score: 70 },
	{ family: 'Work Sans', tag: '/Expressive/Sincere', score: 60 },
	{ family: 'Work Sans', tag: '/Expressive/Active', score: 60 },

	{ family: 'Archivo', tag: '/Sans/Grotesque', score: 90 },
	{ family: 'Archivo', tag: '/Quality/Spacing', score: 80 },
	{ family: 'Archivo', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Archivo', tag: '/Expressive/Active', score: 70 },
	{ family: 'Archivo', tag: '/Expressive/Competent', score: 70 },
	{ family: 'Archivo', tag: '/Expressive/Loud', score: 60 },
	{ family: 'Archivo', tag: '/Expressive/Business', score: 60 },

	{ family: 'Space Grotesk', tag: '/Sans/Grotesque', score: 90 },
	{ family: 'Space Grotesk', tag: '/Sans/Geometric', score: 50 },
	{ family: 'Space Grotesk', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Space Grotesk', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Space Grotesk', tag: '/Expressive/Innovative', score: 80 },
	{ family: 'Space Grotesk', tag: '/Expressive/Futuristic', score: 70 },
	{ family: 'Space Grotesk', tag: '/Expressive/Artistic', score: 60 },
	{ family: 'Space Grotesk', tag: '/Expressive/Awkward', score: 50 },

	// `/Sans/Glyphic` has no entry in `TONE_TAGS`, so these two reach a seed only through the
	// category fallback. They are here so a ceremonial brand finds something other than a
	// workhorse grotesque waiting for it.
	{ family: 'Julius Sans One', tag: '/Sans/Glyphic', score: 90 },
	{ family: 'Julius Sans One', tag: '/Quality/Spacing', score: 50 },
	{ family: 'Julius Sans One', tag: '/Quality/Wordspace', score: 50 },
	{ family: 'Julius Sans One', tag: '/Expressive/Fancy', score: 80 },
	{ family: 'Julius Sans One', tag: '/Expressive/Sophisticated', score: 80 },
	{ family: 'Julius Sans One', tag: '/Expressive/Vintage', score: 60 },
	{ family: 'Julius Sans One', tag: '/Expressive/Artistic', score: 50 },

	{ family: 'Tenor Sans', tag: '/Sans/Glyphic', score: 70 },
	{ family: 'Tenor Sans', tag: '/Sans/Humanist', score: 60 },
	{ family: 'Tenor Sans', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Tenor Sans', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Tenor Sans', tag: '/Expressive/Sophisticated', score: 70 },
	{ family: 'Tenor Sans', tag: '/Expressive/Fancy', score: 60 },
	{ family: 'Tenor Sans', tag: '/Expressive/Calm', score: 60 },

	// Saira Stencil One is this file's share of the four `/Theme/*` rows the table owes #42's
	// display-versus-body filter. The stencil cuts are the whole point of the face, so its quality
	// scores sit at the floor. Nothing should rank it into a paragraph.
	{ family: 'Saira Stencil One', tag: '/Sans/Grotesque', score: 70 },
	{ family: 'Saira Stencil One', tag: '/Theme/Stencil', score: 100 },
	{ family: 'Saira Stencil One', tag: '/Quality/Spacing', score: 40 },
	{ family: 'Saira Stencil One', tag: '/Quality/Wordspace', score: 40 },
	{ family: 'Saira Stencil One', tag: '/Expressive/Rugged', score: 80 },
	{ family: 'Saira Stencil One', tag: '/Expressive/Loud', score: 70 },
	{ family: 'Saira Stencil One', tag: '/Expressive/Vintage', score: 60 },
	{ family: 'Saira Stencil One', tag: '/Expressive/Active', score: 50 },
];
