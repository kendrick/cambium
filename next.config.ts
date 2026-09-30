import type { NextConfig } from 'next';

import { resolveDeployPaths } from './lib/deploy-paths';

const deployPaths = resolveDeployPaths();

const nextConfig: NextConfig = {
	// Cambium ships as a static bundle with no server runtime. Static export also rejects
	// route handlers, server actions, and middleware by their presence on disk, not by
	// being reached, so those stay out of the tree entirely.
	output: 'export',
	images: { unoptimized: true },
	...deployPaths,
	// `lib/asset-path.ts` reads this so a `fetch` of a `public/` file gets the prefix Next routes under.
	env: { NEXT_PUBLIC_CAMBIUM_BASE_PATH: deployPaths.basePath ?? '' },
};

export default nextConfig;
