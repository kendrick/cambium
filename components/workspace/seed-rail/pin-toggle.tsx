import { cn } from 'cn';

/**
 * A toggle button, not a checkbox, so assistive tech announces "pressed" rather than "checked": a
 * pin is a state the field holds, not a value it submits. Pinned is a solid pin on a filled tile and
 * unpinned a bare outline, a difference of shape and weight, so it still reads for anyone who
 * can't tell the two colours apart.
 */
export function PinToggle({
	label,
	pinned,
	onToggle,
}: {
	/** The field's name as a sentence fragment, e.g. "radius" or "brand key colour". */
	label: string;
	pinned: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={pinned}
			aria-label={`Pin ${label}`}
			title={
				pinned
					? `Pinned: presets and contrast repair keep the value you set for ${label}`
					: `Pin ${label}`
			}
			data-pinned={pinned ? '' : undefined}
			onClick={onToggle}
			className={cn(
				'focus-visible:ring-ring/50 inline-flex size-7 shrink-0 items-center justify-center rounded-md border outline-none focus-visible:ring-3',
				pinned
					? 'border-foreground bg-foreground text-background'
					: 'text-muted-foreground hover:bg-muted hover:text-foreground border-transparent',
			)}
		>
			<PinIcon pinned={pinned} />
		</button>
	);
}

function PinIcon({ pinned }: { pinned: boolean }) {
	return (
		<svg
			aria-hidden
			viewBox="0 0 24 24"
			className="size-4"
			fill={pinned ? 'currentColor' : 'none'}
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M12 17v5" />
			<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
		</svg>
	);
}
