'use client';

import { Button } from '@/components/ui/button';

import { clearSessionKey } from '../../../app/generation/session-key';

export type KeyIndicatorProps = {
	/** Called after the key is gone from session storage, so the route can stop showing this. */
	onCleared: () => void;
};

/**
 * Says a key is loaded without showing any of it. Even a masked tail would put part of the key in
 * the DOM, where an extension or a screenshot can read it, and nothing here needs it.
 */
export function KeyIndicator({ onCleared }: KeyIndicatorProps) {
	return (
		<div
			className="border-border flex w-full flex-wrap items-center gap-3 rounded-md border p-3"
			data-key-indicator
		>
			<p className="min-w-0 flex-1 text-sm">
				An Anthropic API key is loaded for this tab. Closing the tab clears it.
			</p>
			<Button
				onClick={() => {
					clearSessionKey();
					onCleared();
				}}
				size="sm"
				variant="outline"
			>
				Clear key
			</Button>
		</div>
	);
}
