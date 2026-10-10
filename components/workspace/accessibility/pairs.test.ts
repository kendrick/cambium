import { describe, expect, it } from 'vitest';

import type { ContrastEntry } from '../../../core/contrast/check';
import { pairTable } from './pairs';

// Each row's APCA figure points the opposite way from its WCAG verdict, so a table that let APCA
// decide would print the other word in every AA cell.
const REPORT: ContrastEntry[] = [
	{
		scheme: 'light',
		foreground: 'foreground',
		background: 'background',
		target: 4.5,
		wcag: 4.6,
		apca: 12.3,
		passes: true,
	},
	{
		scheme: 'light',
		foreground: 'muted-foreground',
		background: 'muted',
		target: 4.5,
		wcag: 4.41,
		apca: 95,
		passes: false,
	},
	{
		scheme: 'dark',
		foreground: 'ring',
		background: 'background',
		target: 3,
		wcag: 2.5,
		apca: -88.04,
		passes: false,
	},
];

describe('pairTable', () => {
	it('takes the AA verdict from passes alone, whatever APCA says', () => {
		expect(pairTable(REPORT, 'light').map((row) => row.verdict)).toEqual(['Pass', 'Fail']);
		expect(pairTable(REPORT, 'dark').map((row) => row.verdict)).toEqual(['Fail']);
	});

	it('prints one scheme, with the ratio at two decimals and Lc at one', () => {
		expect(pairTable(REPORT, 'dark')).toEqual([
			{
				pair: 'ring on background',
				ratio: '2.50:1',
				target: '3:1',
				verdict: 'Fail',
				apca: '-88.0',
			},
		]);
	});
});
