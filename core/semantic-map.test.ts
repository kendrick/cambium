import { describe, expect, it } from 'vitest';

import { RAMP_NAMES } from './scale-engine';
import { SEMANTIC_MAP } from './semantic-map';

/**
 * Hand-enumerated from the `:root` block of `app/globals.css`, minus `--radius`, which is not a
 * colour and belongs to the non-colour categories #7 owns, and minus `--chart-1` through
 * `--chart-5`, which #69 owns. A five-slot categorical palette needs its
 * separation to survive any seed, and that turns out to rest on interpretation parameters this
 * layer does not set, so it is not a step lookup.
 *
 * Copied rather than read at test time. Parsing the stylesheet would couple the pure core to the
 * app, and `core/purity.test.ts` exists to keep that coupling from happening by accident. Copying
 * is also what makes this a gate. shadcn adding a variable fails here and makes someone decide
 * what step it takes, instead of widening the contract in silence.
 */
const SHADCN_COLOR_VARIABLES = [
	'accent',
	'accent-foreground',
	'background',
	'border',
	'card',
	'card-foreground',
	'destructive',
	'foreground',
	'input',
	'muted',
	'muted-foreground',
	'popover',
	'popover-foreground',
	'primary',
	'primary-foreground',
	'ring',
	'secondary',
	'secondary-foreground',
	'sidebar',
	'sidebar-accent',
	'sidebar-accent-foreground',
	'sidebar-border',
	'sidebar-foreground',
	'sidebar-primary',
	'sidebar-primary-foreground',
	'sidebar-ring',
];

/**
 * Every `ramp.step` string the map names, flattened across both assignment shapes, so the ramp and
 * step checks below cover a contrasting pair's surface and both of its candidates too.
 */
const aliases: [string, string][] = Object.entries(SEMANTIC_MAP).flatMap(([token, assignment]) =>
	typeof assignment === 'string'
		? [[token, assignment] as [string, string]]
		: [
				[token, assignment.on] as [string, string],
				...assignment.candidates.map((c): [string, string] => [token, c]),
			],
);

describe('SEMANTIC_MAP', () => {
	it('covers the shadcn contract exactly, with no token left over on either side', () => {
		expect(new Set(Object.keys(SEMANTIC_MAP))).toEqual(new Set(SHADCN_COLOR_VARIABLES));
		expect(Object.keys(SEMANTIC_MAP)).toHaveLength(SHADCN_COLOR_VARIABLES.length);
	});

	it.each(aliases)('%s targets a ramp the scale engine generates', (_token, alias) => {
		const [ramp] = alias.split('.');

		expect(RAMP_NAMES).toContain(ramp);
	});

	it.each(aliases)('%s targets a step inside the twelve', (_token, alias) => {
		const step = Number(alias.split('.')[1]);

		expect(step).toBeGreaterThanOrEqual(1);
		expect(step).toBeLessThanOrEqual(12);
	});

	// The named sample #6 asks for. Border at step 6 is the call `core/semantic-map.ts` argues;
	// the rest follow the step roles mechanically.
	it.each([
		['background', 'neutral.1'],
		['card', 'neutral.2'],
		['muted', 'neutral.3'],
		['accent', 'neutral.4'],
		['border', 'neutral.6'],
		['input', 'neutral.7'],
		['ring', 'brand.11'],
		['primary', 'brand.9'],
		['destructive', 'danger.11'],
		['muted-foreground', 'neutral.11'],
		['foreground', 'neutral.12'],
	])('%s lands on %s', (token, alias) => {
		expect(SEMANTIC_MAP[token as keyof typeof SEMANTIC_MAP]).toBe(alias);
	});

	/**
	 * A fixed step cannot serve a foreground that sits on step 9. Step 9 carries the seed's own
	 * colour in both schemes while step 1 flips from near-white to near-black, so one alias puts
	 * near-black text on a mid-tone fill in the dark scheme: a navy seed measures 1.01:1 that way.
	 * Declaring both ends and picking per scheme is what the pair shape exists for.
	 */
	it.each(['primary-foreground', 'sidebar-primary-foreground'])(
		'%s declares both ends of its ramp rather than one fixed step',
		(token) => {
			const assignment = SEMANTIC_MAP[token as keyof typeof SEMANTIC_MAP];

			expect(typeof assignment).not.toBe('string');
			expect(assignment).toMatchObject({ candidates: expect.any(Array) });
		},
	);

	// `on` repeats the surface token's own alias, so a step 9 that moved without its foreground
	// following would leave the pair measuring against a fill nothing renders.
	it('measures every contrasting pair against the surface its name claims', () => {
		const mismatched = Object.entries(SEMANTIC_MAP)
			.filter(([, assignment]) => typeof assignment !== 'string')
			.filter(([token, assignment]) => {
				const surface = token.slice(0, -'-foreground'.length);

				return (
					typeof assignment !== 'string' &&
					assignment.on !== SEMANTIC_MAP[surface as keyof typeof SEMANTIC_MAP]
				);
			})
			.map(([token]) => token);

		expect(mismatched).toEqual([]);
	});

	// A `-foreground` with nothing underneath it is a token no component can use, because the
	// whole meaning of the suffix is "the text colour for that surface".
	it('pairs every foreground with the surface it sits on', () => {
		const orphaned = Object.keys(SEMANTIC_MAP)
			.filter((token) => token.endsWith('-foreground'))
			.map((token) => token.slice(0, -'-foreground'.length))
			.filter((surface) => !(surface in SEMANTIC_MAP));

		expect(orphaned).toEqual([]);
	});

	// shadcn dropped `--destructive-foreground` and never replaced it, so deriving one would put a
	// token in the export that no shadcn app reads.
	it('declares no foreground for destructive, which the contract does not pair one with', () => {
		expect(SEMANTIC_MAP).not.toHaveProperty('destructive-foreground');
	});
});
