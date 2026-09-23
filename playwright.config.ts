import { defineConfig, devices } from '@playwright/test';

// Written here and passed to the server, rather than left to the server's own default, so one
// number decides both what the browser opens and what the server binds.
const PORT = 4173;

const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: 'e2e',
	// Scenarios are `*.spec.ts` because Vitest collects `**/*.test.ts` across the whole tree. The two
	// runners share a checkout, and the extension keeps them off each other's files.
	testMatch: '**/*.spec.ts',
	forbidOnly: Boolean(process.env.CI),
	// Named rather than left to the default, which differs between CI and a terminal. `list` writes
	// no report directory, and traces, videos and screenshots stay off. A failing run still writes
	// its error context under `test-results/`, which `.gitignore` covers.
	reporter: 'list',
	use: { baseURL: BASE_URL },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `node scripts/serve-out.mjs ${PORT}`,
		url: BASE_URL,
		// Every run starts its own server. Reuse would let a server started while `out/` existed answer
		// a run made after `out/` was deleted, and a missing export is what `scripts/serve-out.mjs`
		// exits non-zero to report. Starting fresh also stops a foreign process on this port from
		// serving the suite somebody else's files.
		reuseExistingServer: false,
		// The server names `out/` on stderr and exits non-zero when the export is missing. Left on the
		// default of `ignore`, that message never reaches the person who has to act on it.
		stdout: 'pipe',
		stderr: 'pipe',
	},
});
