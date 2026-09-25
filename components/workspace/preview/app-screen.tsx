import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';

const NAV = ['Overview', 'Orders', 'Customers', 'Reports'];

const VIEWS = [
	{ label: 'All orders', count: 128 },
	{ label: 'Awaiting payment', count: 6 },
	{ label: 'Ready to ship', count: 14 },
	{ label: 'Returned', count: 3 },
];

const ORDERS = [
	{ id: '4821', customer: 'Harbor & Pine', status: 'Paid', total: '$1,240.00' },
	{ id: '4820', customer: 'Juniper Studio', status: 'Awaiting payment', total: '$386.50' },
	{ id: '4819', customer: 'Okafor Bakery', status: 'Paid', total: '$92.00' },
	{ id: '4818', customer: 'Lindqvist Bikes', status: 'Refunded', total: '$610.25' },
	{ id: '4817', customer: 'Mesa Clinic', status: 'Paid', total: '$2,015.00' },
] as const;

const STATUS_VARIANT = {
	Paid: 'secondary',
	'Awaiting payment': 'outline',
	Refunded: 'destructive',
} as const;

/**
 * One composed screen, so a token set is judged the way a product would wear it: surfaces nested
 * three deep, a sidebar on its own colour, and a primary action that has to hold its own against a
 * dense table.
 */
export function AppScreen() {
	return (
		<section aria-label="Sample app screen" data-preview-app-screen className="@container border-b">
			<nav
				aria-label="Sample app"
				data-preview-part="nav"
				className="bg-card text-card-foreground flex items-center gap-4 border-b px-4 py-2"
			>
				<span className="text-base font-semibold tracking-tight">Tallyhouse</span>
				<ul className="flex flex-wrap gap-1">
					{NAV.map((item) => (
						<li key={item}>
							<Button
								variant="ghost"
								size="sm"
								aria-current={item === 'Orders' ? 'page' : undefined}
								className={item === 'Orders' ? 'bg-muted text-foreground' : 'text-muted-foreground'}
							>
								{item}
							</Button>
						</li>
					))}
				</ul>
			</nav>

			<div className="flex flex-col @2xl:flex-row">
				<aside
					aria-label="Order views"
					data-preview-part="sidebar"
					className="bg-sidebar text-sidebar-foreground border-sidebar-border flex shrink-0 flex-col gap-1 border-b p-3 @2xl:w-52 @2xl:border-r @2xl:border-b-0"
				>
					{VIEWS.map((view, index) => (
						<div
							key={view.label}
							className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
								index === 0 ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : ''
							}`}
						>
							<span>{view.label}</span>
							<span className="text-muted-foreground text-xs">{view.count}</span>
						</div>
					))}
				</aside>

				<div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
					<header
						data-preview-part="header"
						className="flex flex-wrap items-end justify-between gap-3"
					>
						<div className="flex flex-col gap-1">
							<h3 className="text-2xl leading-tight font-semibold tracking-tight">Orders</h3>
							<p className="text-muted-foreground text-sm">128 this month, 14 waiting to go out.</p>
						</div>
						<Button data-preview-part="primary-action">New order</Button>
					</header>

					<div data-preview-part="table" className="bg-card overflow-hidden rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Order</TableHead>
									<TableHead>Customer</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Total</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{ORDERS.map((order) => (
									<TableRow key={order.id}>
										<TableCell className="font-medium">{order.id}</TableCell>
										<TableCell>{order.customer}</TableCell>
										<TableCell>
											<Badge variant={STATUS_VARIANT[order.status]}>{order.status}</Badge>
										</TableCell>
										<TableCell className="text-right tabular-nums">{order.total}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			</div>
		</section>
	);
}
