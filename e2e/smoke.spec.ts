import { expect, test } from './fixtures';

/**
 * Proves the static export actually serves a working page, not just that `pnpm build` exited zero.
 * `app/page.tsx` renders this heading server-side, so it is present before any client JS runs,
 * which is what makes it the right thing for a smoke test to wait on.
 */
test('the landing route serves the Cambium heading', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { level: 1, name: 'Cambium' })).toBeVisible();
});
