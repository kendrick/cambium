import { describe, expect, it } from 'vitest';

import { nextRovingIndex } from './roving';

describe('nextRovingIndex', () => {
	it('moves one step right and left', () => {
		expect(nextRovingIndex(0, 'ArrowRight', 12)).toBe(1);
		expect(nextRovingIndex(5, 'ArrowLeft', 12)).toBe(4);
	});

	// A ramp runs light to dark. Wrapping from step 12 to step 1 would jump the whole ramp on one
	// keypress, which reads as a bug rather than as the end of the strip.
	it('stops at either end rather than wrapping', () => {
		expect(nextRovingIndex(11, 'ArrowRight', 12)).toBe(11);
		expect(nextRovingIndex(0, 'ArrowLeft', 12)).toBe(0);
	});

	it('jumps to the ends on Home and End', () => {
		expect(nextRovingIndex(6, 'Home', 12)).toBe(0);
		expect(nextRovingIndex(6, 'End', 12)).toBe(11);
	});

	it('leaves every other key to the browser, Enter included', () => {
		expect(nextRovingIndex(3, 'Enter', 12)).toBeNull();
		expect(nextRovingIndex(3, ' ', 12)).toBeNull();
		expect(nextRovingIndex(3, 'Tab', 12)).toBeNull();
		expect(nextRovingIndex(3, 'ArrowDown', 12)).toBeNull();
	});

	it('has nowhere to go in an empty strip', () => {
		expect(nextRovingIndex(0, 'ArrowRight', 0)).toBeNull();
	});
});
