import { describe, expect, it } from 'vitest';

import { describeRejectedBytes, sniffImageType } from '../../lib/image-intake';
import { makeRenamedHeic } from './heic';

describe('makeRenamedHeic', () => {
	it('carries a filename that claims PNG', () => {
		const { name } = makeRenamedHeic();

		expect(name.endsWith('.png')).toBe(true);
	});

	it('is identified as HEIC by the consumer that reads magic bytes', () => {
		const { bytes } = makeRenamedHeic();

		expect(describeRejectedBytes(bytes)).toBe('HEIC');
	});

	it('is not accepted as PNG by the sniffer the picker trusts', () => {
		const { bytes } = makeRenamedHeic();

		expect(sniffImageType(bytes)).not.toBe('image/png');
		expect(sniffImageType(bytes)).toBeNull();
	});
});
