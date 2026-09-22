import { defineConfig } from 'vitest/config';

// Node is enough for whatever Vitest runs here, and the set keeps growing: today the pure core, the
// RecordStore contract under fake-indexeddb, the bundle measurement, and package-scripts.test.ts,
// which spawns pnpm as a subprocess and costs seconds where the rest cost milliseconds. Vitest gets
// no browser tier at all. Rendered-component and axe checks belong to the Playwright suite instead,
// because jsdom does no layout and resolves no cascade, so the colour rules are inert there.
// See docs/agents/testing.md.
const node = {
	environment: 'node' as const,
	globals: true,
	// `e2e/**` holds Playwright specs, named `*.spec.ts` so the `unit` project's `*.test.ts`
	// include already skips them. This is the second guard: a file mis-named `*.test.ts` under
	// `e2e/` still cannot leak into `pnpm test`.
	exclude: ['node_modules/**', 'out/**', '.next/**', 'e2e/**'],
};

export default defineConfig({
	test: {
		// Two projects because the bundle budget needs a build and nothing else does. Keeping them
		// apart is what lets `pnpm test` stay fast and build-free while `pnpm verify` still measures.
		projects: [
			{
				test: {
					...node,
					name: 'unit',
					// `**/*.test.ts` does not match `.test.tsx`, so keep new test files `.ts`.
					include: ['**/*.test.ts'],
					exclude: [...node.exclude, '**/*.bundle.test.ts'],
				},
			},
			{
				test: {
					...node,
					name: 'bundle',
					include: ['**/*.bundle.test.ts'],
				},
			},
		],
	},
});
