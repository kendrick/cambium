/**
 * The deployment host is deliberately undecided (see issue #1), and the two candidates
 * disagree about where the app sits: GitHub Pages serves a project repo under
 * `/<repo>`, while a subdomain or Cloudflare Pages serves it at `/`. Baking either
 * choice into the source would make the other a code change, so the prefix is read
 * from the environment at build time and the decision stays reversible.
 */

export type DeployPaths = {
	basePath?: string;
	assetPrefix?: string;
};

/**
 * Deliberately narrower than `NodeJS.ProcessEnv`, which Next augments with a required
 * `NODE_ENV`. This function reads one key; demanding the whole shape only makes it
 * harder to call with a literal.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export const BASE_PATH_ENV = 'CAMBIUM_BASE_PATH';

/**
 * Next rejects a `basePath` that is empty, that lacks a leading slash, or that carries
 * a trailing one, so the unset case has to omit the keys entirely rather than pass `''`.
 */
export function resolveDeployPaths(env: EnvSource = process.env): DeployPaths {
	const trimmed = env[BASE_PATH_ENV]?.trim().replace(/^\/+|\/+$/g, '');

	if (!trimmed) return {};

	const basePath = `/${trimmed}`;
	return { basePath, assetPrefix: basePath };
}
