import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Node is enough for the deterministic half of Cambium, which is all of stage 2.
		// Rendered-component and axe checks need browser mode and arrive with the UI tickets;
		// see docs/research/oss-landscape.md on why jsdom cannot answer colour questions.
		environment: 'node',
		globals: true,
		include: ['**/*.test.ts'],
		exclude: ['node_modules/**', 'out/**', '.next/**'],
	},
});
