import { describe, expect, it } from 'vitest';

import { matchesFilter } from './filter';

describe('matchesFilter', () => {
	it('matches every id while the query is empty or only whitespace', () => {
		expect(matchesFilter('semantic.border', '')).toBe(true);
		expect(matchesFilter('semantic.border', '   ')).toBe(true);
	});

	it('matches a substring anywhere in the id', () => {
		expect(matchesFilter('semantic.sidebar-border', 'border')).toBe(true);
		expect(matchesFilter('primitive.brand.10', 'brand.1')).toBe(true);
		expect(matchesFilter('radius.md', 'border')).toBe(false);
	});

	it('ignores case, so "ring" finds the camel-cased focusRing too', () => {
		expect(matchesFilter('focusRing.width', 'ring')).toBe(true);
		expect(matchesFilter('semantic.ring', 'RING')).toBe(true);
	});

	it('trims the query', () => {
		expect(matchesFilter('radius.md', ' md ')).toBe(true);
	});
});
