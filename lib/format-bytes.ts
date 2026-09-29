const SCALES = [
	{ unit: 'gigabyte', size: 1e9 },
	{ unit: 'megabyte', size: 1e6 },
	{ unit: 'kilobyte', size: 1e3 },
] as const;

/**
 * Formats a byte count in decimal units with at most one fractional digit. The input is a browser
 * storage estimate that is already rounded, so more precision would overstate it. The locale is
 * fixed to `en` to match every other string on the page.
 */
export function formatBytes(bytes: number): string {
	for (const { unit, size } of SCALES) {
		if (bytes >= size) {
			return new Intl.NumberFormat('en', {
				style: 'unit',
				unit,
				unitDisplay: 'short',
				maximumFractionDigits: 1,
			}).format(bytes / size);
		}
	}

	return new Intl.NumberFormat('en', { style: 'unit', unit: 'byte', unitDisplay: 'long' }).format(
		bytes,
	);
}
