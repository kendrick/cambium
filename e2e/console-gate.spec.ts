import { test } from './fixtures';

/**
 * Trips the `consoleErrors` gate in `./fixtures.ts` on purpose and is itself expected to fail.
 *
 * `docs/agents/testing.md` calls out a fixture nothing ever fails as indistinguishable from one
 * that silently does nothing. `test.fail()` is what keeps that distinction visible here: if the
 * gate ever stops turning a `console.error` into a failed scenario, this test starts passing,
 * which Playwright reports as a failure of its own ("expected to fail, but passed") rather than a
 * quiet green run.
 */
test('a deliberate console.error fails the scenario', async ({ page }) => {
	test.fail();

	await page.goto('/');

	await page.evaluate(() => {
		console.error('cambium harness: deliberate console.error to prove the console gate fires');
	});
});
