import type { BrandRecord } from '../../../core/brand-record';

export const UNTITLED = 'Untitled brand';

/** The row's text, and the suffix on the accessible name of every control in it. */
export function recordLabel(record: Pick<BrandRecord, 'brandUrl'> & { name?: string }): string {
	return record.name ?? record.brandUrl ?? UNTITLED;
}

/** `label` is null for a row this version can't read, which has no name to sort by. */
export type Orderable = { id: string; label: string | null };

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * Sorts by label. Records carry no timestamp, so the name is the only handle a person has on a long
 * library. The id breaks ties so two untitled brands keep one order across reloads.
 */
export function libraryOrder<T extends Orderable>(entries: readonly T[]): T[] {
	// `toSorted` is ES2023 and tsconfig targets ES2022. The array is a fresh copy.
	// oxlint-disable-next-line unicorn/no-array-sort
	return [...entries].sort((a, b) => {
		if (a.label === null || b.label === null) {
			if (a.label !== b.label) return a.label === null ? 1 : -1;
		} else {
			const byLabel = collator.compare(a.label, b.label);
			if (byLabel !== 0) return byLabel;
		}

		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}
