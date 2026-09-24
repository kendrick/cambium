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
 * Issues from an edit that never reached the store: text that isn't a number, or a number the store
 * refused. Neither leaves anything in the store to read back, so the row holds them here, per field,
 * until that field next blurs on something the store accepts or on the value already shown.
 *
 * Per field rather than per override key because a primitive's three channels share one key. A
 * rejected L followed by an untouched blur on H must not clear the issue while L still shows the
 * refused number.
 */
export function useFieldIssues() {
	const [issues, setIssues] = useState<Record<string, OverrideIssue[]>>({});

	function hold(field: string, held: OverrideIssue[] | null) {
		setIssues((current) => {
			if (held) return { ...current, [field]: held };
			if (!(field in current)) return current;
			const next = { ...current };
			delete next[field];
			return next;
		});
	}

	/** `commit` returns the store's issues when it refuses the value, or null once it holds it. */
	function settle(
		field: string,
		outcome: NumberFieldOutcome,
		commit: (value: number) => OverrideIssue[] | null,
	) {
		if (outcome.kind === 'invalid') {
			hold(field, [{ path: [field], message: outcome.message }]);
			return;
		}

		hold(field, outcome.kind === 'changed' ? commit(outcome.value) : null);
	}

	return { fieldIssues: Object.values(issues).flat(), settle, clear: () => setIssues({}) };
}
