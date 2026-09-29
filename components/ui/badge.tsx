import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

// Focus ring gated to the preview, as in ./button.tsx (#152).
const badgeVariants = cva(
	'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring in-data-preview:focus-visible:ring-3 focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!',
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
				secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
				// Same defect as `components/ui/button.tsx`'s destructive variant, text on a tint of itself,
				// and the same fix: constrain the tint. The fractions differ, though, because a badge's
				// real surface is `card` (the app screen's orders table), one step closer to the text than
				// the `background` a button sits on, and card is the surface these were chosen for. Worst
				// case across the ten-seed sweep on card, as `button-contrast.test.ts` measures it
				// (`compositeOver` at alpha rounded to 1/255): light rest 4.73:1, light hover 4.54:1,
				// dark rest 5.75:1, dark hover 4.65:1. In that measure the button's own hover fractions
				// (/10, /30) miss on card, at 4.41:1 and 4.49:1. Painted pixels differ a little in dark,
				// where the text colour clips, and `e2e/button-contrast.spec.ts` reads those for rest.
				// Hover stays more tinted than rest so a linked badge still visibly reacts.
				destructive:
					'bg-destructive/5 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/8 dark:[a]:hover:bg-destructive/29',
				outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
				ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
				// Same link-on-brand-fill defect as `components/ui/button.tsx`'s link variant: `text-primary`
				// isn't guaranteed to clear AA against the page. Same fix: `foreground` is the declared,
				// repair-protected pair.
				link: 'text-foreground underline-offset-4 hover:underline',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
);

function Badge({
	className,
	variant = 'default',
	render,
	...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
	return useRender({
		defaultTagName: 'span',
		props: mergeProps<'span'>(
			{
				className: cn(badgeVariants({ variant }), className),
			},
			props,
		),
		render,
		state: {
			slot: 'badge',
			variant,
		},
	});
}

export { Badge, badgeVariants };
