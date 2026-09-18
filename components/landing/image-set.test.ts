import { describe, expect, it } from 'vitest';

import { chooseGuidance, type ImageTag, MAX_REFERENCE_IMAGES } from './image-set';

describe('chooseGuidance', () => {
	it('asks for a first image when nothing is picked', () => {
		expect(chooseGuidance([])).toBe('empty');
	});

	it('suggests nothing once the set is at the limit', () => {
		const full: ImageTag[] = Array.from({ length: MAX_REFERENCE_IMAGES }, () => 'logo');

		expect(chooseGuidance(full)).toBe('full');
	});

	it('says it cannot tell when every image is left on automatic', () => {
		expect(chooseGuidance(['auto'])).toBe('untagged');
		expect(chooseGuidance(['auto', 'auto'])).toBe('untagged');
	});

	it('asks for a mark whenever nothing states the brand colour outright', () => {
		expect(chooseGuidance(['ui'])).toBe('needs-mark');
		expect(chooseGuidance(['photo'])).toBe('needs-mark');
		expect(chooseGuidance(['artwork', 'ui'])).toBe('needs-mark');
	});

	it('asks for surfaces once a mark is present but nothing shows type in use', () => {
		expect(chooseGuidance(['logo'])).toBe('needs-surfaces');
		expect(chooseGuidance(['logo', 'photo'])).toBe('needs-surfaces');
	});

	it('asks for mood only once both the mark and the interface are covered', () => {
		expect(chooseGuidance(['logo', 'ui'])).toBe('needs-mood');
	});

	// A single tagged image tells us what is missing even when the rest say nothing, which is the
	// case a rule that checked for "all untagged" last would get backwards.
	it('reads a tagged image through a set that is otherwise on automatic', () => {
		expect(chooseGuidance(['auto', 'logo'])).toBe('needs-surfaces');
		expect(chooseGuidance(['auto', 'ui'])).toBe('needs-mark');
	});
});
