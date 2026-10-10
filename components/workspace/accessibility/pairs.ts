import type { ContrastEntry } from '../../../core/contrast/check';
import type { SchemeName } from '../../../core/scale-engine';

export type PairRow = {
	pair: string;
	ratio: string;
	target: string;
	verdict: 'Pass' | 'Fail';
	apca: string;
};

/**
 * One scheme's rows for the All pairs table. The verdict reads `passes`, which `checkContrast` sets
 * from the WCAG 2 ratio. APCA is advisory (#8), so an Lc figure never changes the verdict.
 */
export function pairTable(report: readonly ContrastEntry[], scheme: SchemeName): PairRow[] {
	return report
		.filter((entry) => entry.scheme === scheme)
		.map((entry) => ({
			pair: `${entry.foreground} on ${entry.background}`,
			ratio: `${entry.wcag.toFixed(2)}:1`,
			target: `${entry.target}:1`,
			verdict: entry.passes ? 'Pass' : 'Fail',
			apca: entry.apca.toFixed(1),
		}));
}
