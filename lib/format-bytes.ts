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
	const fits = SCALES.findIndex(({ size }) => bytes >= size);

	if (fits === -1) {
		return new Intl.NumberFormat('en', { style: 'unit', unit: 'byte', unitDisplay: 'long' }).format(
			bytes,
		);
	}

	// `fits` comes from the raw count, and on its own would print 999,950 B as "1,000 kB". `toFixed`
	// rounds the exact value half away from zero, as `Intl.NumberFormat` does, so this check agrees
	// with the printed string.
	const roundsUp = fits > 0 && Number((bytes / SCALES[fits]!.size).toFixed(1)) >= 1000;
	const { unit, size } = SCALES[roundsUp ? fits - 1 : fits]!;

	return new Intl.NumberFormat('en', {
		style: 'unit',
		unit,
		unitDisplay: 'short',
		maximumFractionDigits: 1,
	}).format(bytes / size);
}
