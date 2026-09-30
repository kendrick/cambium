/**
 * The committed demo records the landing route offers a keyless visitor (#40), in `app/demo/fixtures/README.md`'s order. `scripts/copy-demo-fixtures.mjs` serves each `<slug>.json` from `public/demo/fixtures/`, and `demo-fixtures.test.ts` holds this list and that directory equal. Imports nothing, so the picker chunk stays free of zod.
 */
export const DEMO_FIXTURES = [
	{ slug: 'ui-wikipedia', label: 'Reading UI' },
	{ slug: 'ui-devtools', label: 'Developer tool' },
	{ slug: 'photo-ceramics', label: 'Ceramics photo' },
	{ slug: 'photo-window', label: 'Window photo' },
	{ slug: 'artwork-blocks', label: 'Colour blocks' },
	{ slug: 'artwork-dashboard', label: 'Neon dashboard' },
	{ slug: 'artwork-paint', label: 'Paint strokes' },
	{ slug: 'artwork-device', label: 'Violet device' },
] as const satisfies readonly { slug: string; label: string }[];

/** Every fixture has `brandUrl: null`, so without this the library would list eight "Untitled brand"s. */
export function demoRecordName(label: string): string {
	return `${label} (demo)`;
}
