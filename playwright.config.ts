import { defineConfig, devices } from '@playwright/test';

// Decided here and passed to the server, rather than left to the server's own default, so one
// number decides both what the browser opens and what the server binds. `E2E_PORT` lets two
// worktrees run the suite at once. On a shared 4173, Playwright finds the port taken and fails the
// second run before starting its server, since `reuseExistingServer` is off.
const PORT = e2ePort(process.env.E2E_PORT);

function e2ePort(raw: string | undefined): number {
	if (raw === undefined || raw === '') return 4173;
	const port = Number(raw);
	// `Number('abc')` is NaN, and a URL built from NaN fails far from this line, so throw here.
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`E2E_PORT="${raw}" is not a TCP port (an integer from 1 to 65535)`);
	}
	return port;
}

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
