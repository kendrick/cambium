import { describe, expect, it } from 'vitest';

import { libraryOrder, recordLabel, UNTITLED } from './library-order';

describe('recordLabel', () => {
	it('prefers the name, then the brand site, then a placeholder', () => {
		expect(recordLabel({ name: 'Acme', brandUrl: 'acme.com' })).toBe('Acme');
		expect(recordLabel({ brandUrl: 'acme.com' })).toBe('acme.com');
		expect(recordLabel({ brandUrl: null })).toBe(UNTITLED);
	});
});

describe('libraryOrder', () => {
	it('sorts by label ignoring case, with numbers in numeric order', () => {
		const sorted = libraryOrder([
			{ id: 'a', label: 'brand 10' },
			{ id: 'b', label: 'Brand 9' },
			{ id: 'c', label: 'acme.com' },
		]);

		expect(sorted.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
	});

	it('breaks a tie on id, so two untitled brands keep one order across reloads', () => {
		const sorted = libraryOrder([
			{ id: 'z', label: UNTITLED },
			{ id: 'm', label: UNTITLED },
		]);

		expect(sorted.map((entry) => entry.id)).toEqual(['m', 'z']);
	});

	it('puts unreadable rows last', () => {
		const sorted = libraryOrder([
			{ id: 'x', label: null },
			{ id: 'y', label: 'Zinc' },
		]);

		expect(sorted.map((entry) => entry.id)).toEqual(['y', 'x']);
	});

	it('leaves the input alone', () => {
		const input = [
			{ id: 'b', label: 'B' },
			{ id: 'a', label: 'A' },
		];

		libraryOrder(input);

		expect(input.map((entry) => entry.id)).toEqual(['b', 'a']);
	});
});
