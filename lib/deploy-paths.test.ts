import { describe, expect, it } from 'vitest';

import { BASE_PATH_ENV, resolveDeployPaths } from './deploy-paths';

describe('resolveDeployPaths', () => {
	it('omits both keys when the flag is unset, so assets stay root-relative', () => {
		expect(resolveDeployPaths({})).toEqual({});
	});

	it('prefixes both basePath and assetPrefix when the flag is set', () => {
		expect(resolveDeployPaths({ [BASE_PATH_ENV]: '/cambium' })).toEqual({
			basePath: '/cambium',
			assetPrefix: '/cambium',
		});
	});

	it('normalises a flag written without a leading slash or with a trailing one', () => {
		expect(resolveDeployPaths({ [BASE_PATH_ENV]: 'cambium/' })).toEqual({
			basePath: '/cambium',
			assetPrefix: '/cambium',
		});
	});

	// Next rejects `basePath: '/'`, and an empty or whitespace-only flag is how a CI matrix
	// spells "no prefix" without unsetting the variable. Both have to land on the unset case.
	it.each(['', '   ', '/'])('treats %j as unset rather than passing it to Next', (value) => {
		expect(resolveDeployPaths({ [BASE_PATH_ENV]: value })).toEqual({});
	});
});
