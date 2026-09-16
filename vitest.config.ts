import { defineConfig } from 'vitest/config';

// Node is enough for the deterministic half of Cambium, which is all of stage 2.
// Rendered-component and axe checks need browser mode and arrive with the UI tickets;
// see docs/research/oss-landscape.md on why jsdom cannot answer colour questions.
const node = {
	environment: 'node' as const,
	globals: true,
	exclude: ['node_modules/**', 'out/**', '.next/**'],
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
