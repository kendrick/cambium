import { useId, useState } from 'react';

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
 *
 * `describedBy` comes from `useFieldIssues().describedBy`. It's set exactly while this field holds a
 * refused value, which is also when the field is invalid (#174).
 */
export function NumberInput({
	label,
	shown,
	describedBy,
	onBlurOutcome,
}: {
	label: string;
	shown: number;
	describedBy?: string;
	onBlurOutcome: (outcome: NumberFieldOutcome) => void;
}) {
	return (
		<input
			type="number"
			step="any"
			aria-label={label}
			aria-invalid={describedBy === undefined ? undefined : true}
			aria-describedby={describedBy}
			defaultValue={shown}
			onBlur={(event) => onBlurOutcome(readNumberField(event.target.value, shown))}
			className="w-20 rounded border px-1"
		/>
	);
}

/** A held issue with the field it refused and the id of the element that shows it. */
export type FieldIssue = OverrideIssue & { field: string; id: string };

/** Field names are labels such as "offset x", and a space would split one id into two. */
function idSafe(field: string): string {
	return field.replaceAll(/[^\w-]/g, '-');
}

/**
 * Issues from an edit that never reached the store: text that isn't a number, or a number the store
 * refused. Neither leaves anything in the store to read back, so the row holds them here, per field,
 * until that field next blurs on something the store accepts or on the value already shown. The
 * return keeps the field, so each input can point at its own messages.
 *
 * Per field rather than per override key because a primitive's three channels share one key. A
 * rejected L followed by an untouched blur on H must not clear the issue while L still shows the
 * refused number.
 */
export function useFieldIssues() {
	const idBase = useId();
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

	// Kept per field through to the render (#174). Flattened, they lost which input each message
	// refused, so no input could say it was invalid or point at why. The store refuses a light edit
	// once per copy, so one field's repeats of a message collapse here.
	const fieldIssues: FieldIssue[] = Object.entries(issues).flatMap(([field, held]) =>
		[...new Map(held.map((issue) => [issue.message, issue])).values()].map((issue, index) => ({
			...issue,
			field,
			id: `${idBase}-${idSafe(field)}-${index}`,
		})),
	);

	/** What `field`'s input names in `aria-describedby`, or undefined while it holds no issue. */
	function describedBy(field: string): string | undefined {
		const ids = fieldIssues.filter((issue) => issue.field === field).map((issue) => issue.id);
		return ids.length > 0 ? ids.join(' ') : undefined;
	}

	return { fieldIssues, describedBy, settle, clear: () => setIssues({}) };
}
