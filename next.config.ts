import type { NextConfig } from 'next';

import { resolveDeployPaths } from './lib/deploy-paths';

const nextConfig: NextConfig = {
	// Cambium ships as a static bundle with no server runtime. Static export also rejects
	// route handlers, server actions, and middleware by their presence on disk, not by
	// being reached, so those stay out of the tree entirely.
	output: 'export',
	images: { unoptimized: true },
	...resolveDeployPaths(),
};

export default nextConfig;
