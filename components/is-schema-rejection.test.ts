import { describe, expect, it } from 'vitest';

import { BrandRecordSchema } from '../core/brand-record';
import { isSchemaRejection } from './is-schema-rejection';

describe('isSchemaRejection', () => {
	it('is true for a real BrandRecordSchema parse error', () => {
		// `{}` fails every required field on `BrandRecordSchema`, so `safeParse` always rejects it;
		// nothing about which fields fail matters here, only that the `error` comes from zod itself
		// rather than an object built by hand to look like one.
		const result = BrandRecordSchema.safeParse({});
		expect(result.success).toBe(false);
		if (result.success) throw new Error('expected the empty object to fail BrandRecordSchema');

		expect(isSchemaRejection(result.error)).toBe(true);
	});

	it('is false for a DOMException, such as the AbortError an interrupted IndexedDB transaction rejects with', () => {
		expect(isSchemaRejection(new DOMException('aborted', 'AbortError'))).toBe(false);
	});

	it('is false for a plain Error', () => {
		expect(isSchemaRejection(new Error('boom'))).toBe(false);
	});

	it('is false for null', () => {
		expect(isSchemaRejection(null)).toBe(false);
	});

	it('is false for undefined', () => {
		expect(isSchemaRejection(undefined)).toBe(false);
	});
});
