import type { ReactNode, RefObject } from 'react';

import { cssNaming } from '../../../core/css/globals-css';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from '@/components/ui/popover';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';

const BUTTON_VARIANTS = [
	{ variant: 'default', label: 'Save changes' },
	{ variant: 'secondary', label: 'Duplicate' },
	{ variant: 'outline', label: 'Export' },
	{ variant: 'ghost', label: 'Cancel' },
	{ variant: 'destructive', label: 'Delete order' },
	{ variant: 'link', label: 'View receipt' },
] as const;

const BADGE_VARIANTS = [
	{ variant: 'default', label: 'New' },
	{ variant: 'secondary', label: 'Paid' },
	{ variant: 'outline', label: 'Draft' },
	{ variant: 'destructive', label: 'Overdue' },
] as const;

// Written out whole so Tailwind's source scan finds each utility; a `text-${size}` template would
// compile to nothing.
const TYPE_STEPS = [
	'text-4xl',
	'text-3xl',
	'text-2xl',
	'text-xl',
	'text-lg',
	'text-base',
	'text-sm',
	'text-xs',
] as const;

const POPOVER_TRIGGER = <Button variant="outline" className="self-start" />;

function Specimen({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<h4 className="text-muted-foreground text-sm font-medium">{title}</h4>
			{children}
		</div>
	);
}

export function Gallery({
	scalars,
	popoverContainer,
}: {
	scalars: Record<string, string>;
	/** The preview container, so the popup inherits its scoped declarations rather than the app's. */
	popoverContainer: RefObject<HTMLElement | null>;
}) {
	const naming = cssNaming();

	return (
		<section
			aria-labelledby="preview-gallery-heading"
			data-preview-gallery
			className="@container flex flex-col gap-6 p-4"
		>
			<h3 id="preview-gallery-heading" className="text-lg font-semibold tracking-tight">
				Components
			</h3>

			<div className="grid gap-8 @3xl:grid-cols-2">
				<Specimen title="Buttons">
					<div className="flex flex-wrap gap-2">
						{BUTTON_VARIANTS.map(({ variant, label }) => (
							<Button key={variant} variant={variant}>
								{label}
							</Button>
						))}
					</div>
				</Specimen>

				<Specimen title="Badges">
					<div className="flex flex-wrap gap-2">
						{BADGE_VARIANTS.map(({ variant, label }) => (
							<Badge key={variant} variant={variant}>
								{label}
							</Badge>
						))}
					</div>
				</Specimen>

				<Specimen title="Input">
					<div className="flex flex-col gap-2">
						<Label htmlFor="preview-email">Email</Label>
						<Input id="preview-email" type="email" placeholder="you@example.com" />
					</div>
				</Specimen>

				<Specimen title="Tabs">
					<Tabs defaultValue="week">
						<TabsList aria-label="Sample range">
							<TabsTab value="week">Week</TabsTab>
							<TabsTab value="month">Month</TabsTab>
							<TabsTab value="year">Year</TabsTab>
						</TabsList>
						<TabsPanel value="week" className="text-muted-foreground text-sm">
							42 orders this week.
						</TabsPanel>
						<TabsPanel value="month" className="text-muted-foreground text-sm">
							128 orders this month.
						</TabsPanel>
						<TabsPanel value="year" className="text-muted-foreground text-sm">
							1,406 orders this year.
						</TabsPanel>
					</Tabs>
				</Specimen>

				<Specimen title="Card">
					<Card>
						<CardHeader>
							<CardTitle>Starter plan</CardTitle>
							<CardDescription>Up to three people, billed monthly.</CardDescription>
						</CardHeader>
						<CardContent>
							<p>Includes order tracking, invoices and a shared inbox.</p>
						</CardContent>
						<CardFooter className="gap-2">
							<Button>Choose plan</Button>
							<Button variant="ghost">Compare</Button>
						</CardFooter>
					</Card>
				</Specimen>

				<Specimen title="Alerts">
					<div className="flex flex-col gap-3">
						<Alert>
							<AlertTitle>Payout scheduled</AlertTitle>
							<AlertDescription>$4,120.00 lands in your account on Friday.</AlertDescription>
						</Alert>
						<Alert variant="destructive">
							<AlertTitle>Card declined</AlertTitle>
							<AlertDescription>Update the card on file to keep your plan active.</AlertDescription>
						</Alert>
					</div>
				</Specimen>

				<Specimen title="Popover">
					<Popover>
						<PopoverTrigger render={POPOVER_TRIGGER}>Order details</PopoverTrigger>
						<PopoverContent align="start" container={popoverContainer}>
							<PopoverHeader>
								<PopoverTitle>Order 4821</PopoverTitle>
								<PopoverDescription>Paid by card on 12 September.</PopoverDescription>
							</PopoverHeader>
						</PopoverContent>
					</Popover>
				</Specimen>

				<Specimen title="Table">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Plan</TableHead>
								<TableHead className="text-right">Seats</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableRow>
								<TableCell>Starter</TableCell>
								<TableCell className="text-right tabular-nums">3</TableCell>
							</TableRow>
							<TableRow>
								<TableCell>Team</TableCell>
								<TableCell className="text-right tabular-nums">25</TableCell>
							</TableRow>
						</TableBody>
					</Table>
				</Specimen>
			</div>

			<Specimen title="Type scale">
				<dl className="flex flex-col gap-3">
					{TYPE_STEPS.map((step) => (
						<div
							key={step}
							className="flex flex-col gap-1 border-b pb-3 @xl:flex-row @xl:items-baseline @xl:gap-6"
						>
							<dt className="text-muted-foreground flex gap-2 text-xs @xl:w-36 @xl:shrink-0">
								<span className="text-foreground font-medium">{step}</span>
								<span>{scalars[naming.prefixedProperty(step)] ?? 'not set'}</span>
							</dt>
							<dd className={`${step} leading-tight`}>Ship the order today</dd>
						</div>
					))}
				</dl>
			</Specimen>
		</section>
	);
}
