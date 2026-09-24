'use client';

import { useId } from 'react';

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
 * A prefilled password input writes the whole key into the DOM as a `value` attribute, where an
 * extension or a saved page can read it. Controlled state would keep the key in React's memory for
 * as long as the panel lives.
 */
export default function KeyDialog({ open, onOpenChange, onSubmit, notice }: KeyDialogProps) {
	const inputId = useId();
	// Only whether one exists, read on render so the key itself never travels through a prop or state.
	const loaded = getSessionKey() !== null;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogPopup>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						const value = new FormData(event.currentTarget).get('api-key');
						const typed = typeof value === 'string' ? value.trim() : '';
						const key = typed || getSessionKey();
						if (key) onSubmit(key);
					}}
				>
					<DialogTitle>Your Anthropic API key</DialogTitle>
					{notice && (
						<p className="text-destructive text-sm" data-key-notice role="alert">
							{notice}
						</p>
					)}
					<DialogDescription>
						Cambium sends your reference images to Anthropic with this key, from this browser. The
						key stays in this tab and is cleared when you close it.
					</DialogDescription>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium" htmlFor={inputId}>
							Anthropic API key
						</label>
						<input
							autoComplete="off"
							className="border-border bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-3 font-mono text-sm outline-none focus-visible:ring-3"
							id={inputId}
							name="api-key"
							required={!loaded}
							spellCheck={false}
							type="password"
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
						<Button type="submit">Use this key</Button>
					</div>
				</form>
			</DialogPopup>
		</Dialog>
	);
}
