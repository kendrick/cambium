/**
 * `next/link` and `router.push` add `basePath` themselves. A plain `fetch` of a file under `public/` doesn't, so it works at `/` and 404s once the app deploys under `/<repo>`. Next inlines `NEXT_PUBLIC_*` at build time, and `next.config.ts` sets this one from the same `resolveDeployPaths()` result it routes under.
 */
export function assetPath(
	path: string,
	basePath: string = process.env.NEXT_PUBLIC_CAMBIUM_BASE_PATH ?? '',
): string {
	return `${basePath}${path}`;
}
