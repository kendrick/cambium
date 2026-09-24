import { useState } from 'react';

import type { OverrideIssue } from '../../../core/token-overrides';

/** What a blurred number field asks its row to do with the text left in it. */
export type NumberFieldOutcome =
	| { kind: 'unchanged' }
	| { kind: 'invalid'; message: string }
	| { kind: 'changed'; value: number };

/**
 * `Number('')` is 0, so reading a cleared field with `Number` alone would store a 0 the user never
 * typed. A `type="number"` input also reports text it can't parse as `''`, so this one check catches
 * both a cleared field and one holding junk.
 *
 * A value equal to `shown` is unchanged, even when the user retyped it. Storing it would mark the row
 * overridden after a bare focus and tab-away, with nothing actually different.
 */
export function readNumberField(raw: string, shown: number): NumberFieldOutcome {
	if (raw.trim() === '') return { kind: 'invalid', message: 'Enter a number.' };

	const value = Number(raw);

	if (!Number.isFinite(value)) return { kind: 'invalid', message: 'Enter a finite number.' };

	return value === shown ? { kind: 'unchanged' } : { kind: 'changed', value };
}

/**
 * Uncontrolled on purpose, so a half-typed value survives re-renders until blur. The parent keys it
 * on `shown` so an outside change (a reset, a preset switch) remounts it with the new value.
 */
export function NumberInput({
	label,
	shown,
	onBlurOutcome,
}: {
	label: string;
	shown: number;
	onBlurOutcome: (outcome: NumberFieldOutcome) => void;
}) {
	return (
		<input
			type="number"
			step="any"
			aria-label={label}
			defaultValue={shown}
			onBlur={(event) => onBlurOutcome(readNumberField(event.target.value, shown))}
			className="w-20 rounded border px-1"
		/>
	);
}

/**
 * A rejected field never reaches the store, so the store holds no issue for it. The row keeps the
 * issue here, one per field, until that field next blurs with something readable.
 */
export function useFieldIssues() {
	const [issues, setIssues] = useState<Record<string, OverrideIssue>>({});

	function settle(field: string, outcome: NumberFieldOutcome, commit: (value: number) => void) {
		if (outcome.kind === 'invalid') {
			setIssues((held) => ({ ...held, [field]: { path: [field], message: outcome.message } }));
			return;
		}

		setIssues((held) => {
			if (!(field in held)) return held;
			const next = { ...held };
			delete next[field];
			return next;
		});

		if (outcome.kind === 'changed') commit(outcome.value);
	}

	return { fieldIssues: Object.values(issues), settle };
}
