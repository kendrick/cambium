import { expect, test } from './fixtures';

/**
 * Proves the static export actually serves a working page, not just that `pnpm build` exited zero.
 *
 * The page and the route fail separately, so this asserts one element of each. The `<h1>` is in
 * `app/page.tsx`, server-rendered and outside the `<Suspense>` boundary, so it lands before any
 * client JS runs and says nothing about what that JS did: a route rendering nothing at all still
 * shows it. The file picker and the submit button come from
 * `components/landing/upload-form.tsx`, inside the boundary, so reaching them means the client
 * chunk loaded, hydrated, and rendered past the `Loading…` fallback.
 *
 * Every locator here goes through a role or an accessible name, which is what the browser
 * computes rather than what the JSX declares. Nothing in this repo carries a `data-testid`, and
 * the element ids come from React's `useId`, so neither is stable enough to name.
 */
test('the landing route serves the upload form from the static export', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { level: 1, name: 'Cambium' })).toBeVisible();

	await expect(page.getByLabel('Reference images')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save these references' })).toBeVisible();
});
