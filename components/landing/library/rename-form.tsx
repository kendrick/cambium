import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { RECORD_NAME_MAX_LENGTH } from '../../../core/brand-record';

export type RenameOutcome = { ok: true } | { ok: false; message: string };

export function RenameForm({
	label,
	current,
	onRename,
	onDone,
}: {
	label: string;
	current: string;
	onRename: (typed: string) => Promise<RenameOutcome>;
	onDone: () => void;
}) {
	const inputId = useId();
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// The form mounts only when the person asks to rename, so the field they're about to type in
	// takes focus. `autoFocus` would too, but oxlint's jsx-a11y/no-autofocus is an error here.
	useEffect(() => inputRef.current?.focus(), []);

	return (
		<form
			className="flex flex-wrap items-end gap-2"
			onSubmit={async (event) => {
				event.preventDefault();
				const typed = String(new FormData(event.currentTarget).get('name') ?? '');
				setBusy(true);
				const outcome = await onRename(typed);
				setBusy(false);
				if (outcome.ok) onDone();
				else setMessage(outcome.message);
			}}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<Label htmlFor={inputId}>
					Name<span className="sr-only"> for {label}</span>
				</Label>
				{/* Not required, because an empty field clears the name. */}
				<Input
					defaultValue={current}
					id={inputId}
					maxLength={RECORD_NAME_MAX_LENGTH}
					name="name"
					ref={inputRef}
				/>
			</div>
			<Button disabled={busy} size="sm" type="submit">
				Save name
			</Button>
			<Button onClick={onDone} size="sm" type="button" variant="ghost">
				Cancel
			</Button>
			{message && (
				<p className="text-destructive w-full text-xs" role="alert">
					{message}
				</p>
			)}
		</form>
	);
}
