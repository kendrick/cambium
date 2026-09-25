'use client';

import { useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogTitle,
} from '@/components/ui/dialog';

import { getSessionKey } from '../../../app/generation/session-key';

export type KeyDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Gets the key straight from the input, so no component state ever holds a copy. An empty field
	 * with a key already loaded hands back the loaded one, which is how the person keeps it.
	 */
	onSubmit: (key: string) => void;
	/** The rejection to show when the dialog opened by itself after Anthropic refused the key. */
	notice?: string;
};

const CONSOLE_URL = 'https://console.anthropic.com';

/**
 * Asks for the key, and never on arrival: the panel opens this from Generate, by itself when
 * Anthropic rejects a key, or from the recovery button left behind after that.
 *
 * The field is uncontrolled and always starts empty. After a credentials failure the stored key is
 * still there (#23: a rejected key doesn't clear it), and the dialog says so rather than show it.
 * A prefilled input writes the whole key into the DOM as a `value` attribute, where an extension or
 * a saved page can read it. Controlled state would keep the key in React's memory for as long as
 * the panel lives.
 *
 * Masked with CSS instead of `type="password"`, and never inside a `<form>`. Chrome's password
 * manager reads a password field in a submitted form as a login and offers to save the key into the
 * person's synced passwords. The `data-*` attributes are the opt-outs 1Password, LastPass,
 * Bitwarden and Dashlane each look for, because `autocomplete="off"` alone doesn't stop them.
 */
export default function KeyDialog({ open, onOpenChange, onSubmit, notice }: KeyDialogProps) {
	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	// Only whether one exists, read on render so the key itself never travels through a prop or state.
	const loaded = getSessionKey() !== null;

	const submit = () => {
		const typed = inputRef.current?.value.trim() ?? '';
		const key = typed || getSessionKey();
		if (key) onSubmit(key);
		else inputRef.current?.focus();
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogPopup>
				<div className="flex flex-col gap-4">
					<DialogTitle>Your Anthropic API key</DialogTitle>
					{notice && (
						<p className="text-destructive text-sm" data-key-notice role="alert">
							{notice}
						</p>
					)}
					<DialogDescription>
						Cambium sends your reference images to Anthropic with this key, from this browser. The
						key stays for this tab's session, and a tab opened from this one can carry a copy. Use
						Clear key when you're done with it.
					</DialogDescription>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium" htmlFor={inputId}>
							Anthropic API key
						</label>
						<input
							aria-required={!loaded}
							autoCapitalize="off"
							autoComplete="off"
							autoCorrect="off"
							className="border-border bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-3 font-mono text-sm outline-none [-webkit-text-security:disc] focus-visible:ring-3"
							data-1p-ignore=""
							data-bwignore=""
							data-form-type="other"
							data-lpignore="true"
							id={inputId}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									submit();
								}
							}}
							ref={inputRef}
							spellCheck={false}
							type="text"
						/>
						{loaded && (
							<p className="text-muted-foreground text-sm" data-key-loaded>
								The key you entered before is still loaded. Leave this empty to keep it, or paste a
								new one to replace it.
							</p>
						)}
					</div>
					{/* #23 asks for this sentence outright. The default workspace can't carry a limit of
					    its own, so a key made there can spend up to the organization's whole limit. */}
					<p className="text-muted-foreground text-sm">
						A spend limit only applies to a workspace other than the default one. To cap what this
						key can spend, create a workspace in the{' '}
						<a
							className="text-primary underline-offset-4 hover:underline"
							href={CONSOLE_URL}
							rel="noreferrer"
							target="_blank"
						>
							Anthropic Console
						</a>
						, set its limit, and make the key there.
					</p>
					<div className="flex justify-end gap-2">
						<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
						<Button onClick={submit} type="button">
							Use this key
						</Button>
					</div>
				</div>
			</DialogPopup>
		</Dialog>
	);
}
