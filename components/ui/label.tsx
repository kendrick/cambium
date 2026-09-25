import type { ComponentProps } from 'react';
import { cn } from 'cn';

function Label({ className, ...props }: ComponentProps<'label'>) {
	return (
		// This is a generic wrapper: the association the rule wants lives at the call
		// site, via `htmlFor` or by wrapping a control, and the linter can't see either
		// one from here.
		// oxlint-disable-next-line jsx-a11y/label-has-associated-control
		<label
			data-slot="label"
			className={cn(
				'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
