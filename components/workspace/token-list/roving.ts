/**
 * Where focus goes in a one-row roving-tabindex strip after `key`, or null when the key isn't the
 * strip's to handle. Null matters as much as the numbers: it is how Enter and Space get through to
 * the chip's own button, which is what opens the step's editor.
 */
export function nextRovingIndex(current: number, key: string, count: number): number | null {
	if (count === 0) return null;

	switch (key) {
		case 'ArrowRight':
			return Math.min(current + 1, count - 1);
		case 'ArrowLeft':
			return Math.max(current - 1, 0);
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}
