import type { AuthoredRow } from '../../../core/font-table';

/**
 * Quota: 10 families, all on `/Monospace/Monospace`.
 *
 * No tone floor, because the taxonomy carries no tones under monospace. All three mono pairs a
 * seed can express fall back to the category and therefore to this file, which is why ten
 * families still has to read as a real choice rather than a formality.
 *
 * At least one family here also carries a `/Theme/*` tag. The table owes #42's
 * display-versus-body filter four of them, asserted table-wide in `fallback-table.test.ts`, and
 * dropping this file's share is what would put that floor at risk.
 *
 * Every family also carries both `/Quality/*` rows and at least three `/Expressive/*` rows,
 * because #42 ranks on the seed's expressive axes and a family tagged on tone alone can never
 * place on them.
 */
export const MONO_ROWS: readonly AuthoredRow[] = [
	// The workhorses. Every family in this file claims `/Monospace/Monospace` at or near 100, so
	// the structural row separates nothing. The `/Quality/*` and `/Expressive/*` scores are the
	// whole difference between one mono seed's answer and another's.
	{ family: 'JetBrains Mono', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'JetBrains Mono', tag: '/Quality/Spacing', score: 100 },
	{ family: 'JetBrains Mono', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'JetBrains Mono', tag: '/Expressive/Competent', score: 100 },
	{ family: 'JetBrains Mono', tag: '/Expressive/Innovative', score: 80 },
	{ family: 'JetBrains Mono', tag: '/Expressive/Active', score: 60 },
	{ family: 'JetBrains Mono', tag: '/Expressive/Business', score: 60 },

	{ family: 'Roboto Mono', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Roboto Mono', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Roboto Mono', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Roboto Mono', tag: '/Expressive/Competent', score: 90 },
	{ family: 'Roboto Mono', tag: '/Expressive/Business', score: 80 },
	{ family: 'Roboto Mono', tag: '/Expressive/Calm', score: 60 },
	{ family: 'Roboto Mono', tag: '/Expressive/Stiff', score: 60 },

	{ family: 'IBM Plex Mono', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'IBM Plex Mono', tag: '/Quality/Spacing', score: 90 },
	{ family: 'IBM Plex Mono', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'IBM Plex Mono', tag: '/Expressive/Business', score: 90 },
	{ family: 'IBM Plex Mono', tag: '/Expressive/Competent', score: 80 },
	{ family: 'IBM Plex Mono', tag: '/Expressive/Sincere', score: 60 },
	{ family: 'IBM Plex Mono', tag: '/Expressive/Innovative', score: 50 },

	{ family: 'Source Code Pro', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Source Code Pro', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Source Code Pro', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Source Code Pro', tag: '/Expressive/Competent', score: 90 },
	{ family: 'Source Code Pro', tag: '/Expressive/Business', score: 70 },
	{ family: 'Source Code Pro', tag: '/Expressive/Calm', score: 60 },
	{ family: 'Source Code Pro', tag: '/Expressive/Sincere', score: 50 },

	{ family: 'Inconsolata', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Inconsolata', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Inconsolata', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'Inconsolata', tag: '/Expressive/Competent', score: 90 },
	{ family: 'Inconsolata', tag: '/Expressive/Calm', score: 70 },
	{ family: 'Inconsolata', tag: '/Expressive/Sincere', score: 70 },
	{ family: 'Inconsolata', tag: '/Expressive/Happy', score: 40 },

	{ family: 'Fira Code', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Fira Code', tag: '/Quality/Spacing', score: 90 },
	{ family: 'Fira Code', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Fira Code', tag: '/Expressive/Competent', score: 90 },
	{ family: 'Fira Code', tag: '/Expressive/Innovative', score: 90 },
	{ family: 'Fira Code', tag: '/Expressive/Active', score: 60 },
	{ family: 'Fira Code', tag: '/Expressive/Futuristic', score: 40 },

	{ family: 'DM Mono', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'DM Mono', tag: '/Quality/Spacing', score: 90 },
	{ family: 'DM Mono', tag: '/Quality/Wordspace', score: 90 },
	{ family: 'DM Mono', tag: '/Expressive/Sophisticated', score: 80 },
	{ family: 'DM Mono', tag: '/Expressive/Calm', score: 70 },
	{ family: 'DM Mono', tag: '/Expressive/Competent', score: 70 },
	{ family: 'DM Mono', tag: '/Expressive/Fancy', score: 40 },

	// Faces with an accent, and lower `/Quality/*` scores to match. A typewriter revival really
	// does set worse running text than Inconsolata, and that gap is what keeps a craft ranking
	// from leading with one when the seed asked for a body face.
	{ family: 'Space Mono', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Space Mono', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Space Mono', tag: '/Quality/Wordspace', score: 70 },
	{ family: 'Space Mono', tag: '/Theme/Wacky', score: 50 },
	{ family: 'Space Mono', tag: '/Expressive/Awkward', score: 80 },
	{ family: 'Space Mono', tag: '/Expressive/Futuristic', score: 80 },
	{ family: 'Space Mono', tag: '/Expressive/Artistic', score: 70 },
	{ family: 'Space Mono', tag: '/Expressive/Playful', score: 60 },
	{ family: 'Space Mono', tag: '/Expressive/Vintage', score: 50 },

	{ family: 'Courier Prime', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Courier Prime', tag: '/Quality/Spacing', score: 70 },
	{ family: 'Courier Prime', tag: '/Quality/Wordspace', score: 80 },
	{ family: 'Courier Prime', tag: '/Expressive/Vintage', score: 90 },
	{ family: 'Courier Prime', tag: '/Expressive/Sincere', score: 80 },
	{ family: 'Courier Prime', tag: '/Expressive/Stiff', score: 70 },
	{ family: 'Courier Prime', tag: '/Expressive/Calm', score: 50 },

	// VT323 is here for its `/Theme/Pixel` row. #42 excludes `/Theme/*` from body candidates by
	// prefix, so a CRT face stays reachable as a display answer and never turns up under a
	// paragraph of running text.
	{ family: 'VT323', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'VT323', tag: '/Quality/Spacing', score: 60 },
	{ family: 'VT323', tag: '/Quality/Wordspace', score: 60 },
	{ family: 'VT323', tag: '/Theme/Pixel', score: 100 },
	{ family: 'VT323', tag: '/Expressive/Vintage', score: 90 },
	{ family: 'VT323', tag: '/Expressive/Futuristic', score: 70 },
	{ family: 'VT323', tag: '/Expressive/Playful', score: 60 },
	{ family: 'VT323', tag: '/Expressive/Childlike', score: 50 },
	{ family: 'VT323', tag: '/Expressive/Loud', score: 40 },
];
