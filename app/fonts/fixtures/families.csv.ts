/**
 * A synthetic stand-in for the `tags/all/families.csv` file in `google/fonts`, not a copy of it:
 * ADR-0001 keeps that file out of this repo, so every family name and score below is invented,
 * following `core/font-table.test.ts`'s own precedent of "Geo Sans" and "Warm Sans".
 *
 * What this fixture proves is that the parser handles the upstream *format*, not that it matches
 * upstream *content*. It carries the four things `font-table-provider.test.ts` needs a table for:
 * a quoted field with a comma inside it, a populated axis-position row that must be dropped, a
 * tag namespace outside Cambium's closed `TagName` union (proving tags pass through unchanged),
 * and enough families and tags to be a usable table.
 */
export const VALID_FAMILIES_CSV = [
	'Geo Sans,,/Sans/Geometric,90',
	'Geo Sans,wght@900,/Sans/Geometric,95',
	'Warm Sans,,/Sans/Humanist,80',
	'"Comma, Sans",,/Sans/Rounded,70',
	'Plain Sans,,/Sans/Neo Grotesque,60',
	'Plain Sans,,/Sans/Grotesque,50',
	'Old Serif,,/Serif/Old Style Garalde,90',
	'Sharp Serif,,/Serif/Didone,100',
	'Fixed Mono,,/Monospace/Monospace,100',
	'Geo Sans,,/Upstream/NewTag,55',
	'',
].join('\n');

/**
 * The rows `VALID_FAMILIES_CSV` should produce once the axis-position row is dropped, in the
 * same order they appear above.
 */
export const VALID_FAMILIES_ROWS = [
	{ family: 'Geo Sans', tag: '/Sans/Geometric', score: 90 },
	{ family: 'Warm Sans', tag: '/Sans/Humanist', score: 80 },
	{ family: 'Comma, Sans', tag: '/Sans/Rounded', score: 70 },
	{ family: 'Plain Sans', tag: '/Sans/Neo Grotesque', score: 60 },
	{ family: 'Plain Sans', tag: '/Sans/Grotesque', score: 50 },
	{ family: 'Old Serif', tag: '/Serif/Old Style Garalde', score: 90 },
	{ family: 'Sharp Serif', tag: '/Serif/Didone', score: 100 },
	{ family: 'Fixed Mono', tag: '/Monospace/Monospace', score: 100 },
	{ family: 'Geo Sans', tag: '/Upstream/NewTag', score: 55 },
];

/**
 * An unterminated quoted field: stands in for any upstream body `parseFontTable` can't make sense
 * of, without needing a real network response to produce one.
 */
export const UNPARSEABLE_FAMILIES_CSV = 'Broken Sans,,"/Sans/Geometric,80\n';
