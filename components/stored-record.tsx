import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

/**
 * What both routes that read a stored record share: the parameter that addresses it, how a failed
 * read tells a schema rejection from everything else, and the shape a terminal outcome renders.
 * The landing route writes the parameter after a save and the workspace reads it, so one name is
 * what keeps the landing page's link landing intact.
 */

/**
 * A saved record is addressed by query parameter, never by a path segment. Static export cannot
 * prerender a page for a record that does not exist at build time, and `generateStaticParams` has
 * nothing to enumerate when the ids are made in the browser.
 */
export const RECORD_PARAM = 'record';

/**
 * Whether a read failed because a row came back and would not parse.
 *
 * `RecordStore.get` awaits the row and then runs `BrandRecordSchema.parse` on it inside one
 * promise, so a rejection on its own says nothing about whether a row exists: an aborted
 * transaction rejects the same way. Only a schema rejection is evidence that storage handed
 * something over, and that evidence is exactly what `unreadable` spends when it tells somebody
 * their record is still there and not to clear it.
 *
 * Recognised by the `issues` array a `ZodError` carries, which is the shape callers are meant to
 * read a validation failure out of. Importing zod to use `instanceof` would put 93 kB into a bundle
 * ADR-0002 leaves about 5 kB in, so that is not available. Matching the class name instead was the
 * first attempt and rests on two of the library's internals at once, its error name and its
 * inheritance, either of which can move in a minor release with nothing here failing loudly.
 * Nothing else that can reach this catch carries `issues`: an `idb` or IndexedDB rejection is a
 * `DOMException`.
 *
 * It fails toward claiming less, whichever way it is written. If this stops recognising a schema
 * rejection, every read failure reads as `unavailable`, which says nothing about existence rather
 * than saying something false.
 */
export function isSchemaRejection(error: unknown): boolean {
	return Array.isArray((error as { issues?: unknown } | null | undefined)?.issues);
}

/**
 * The shape every terminal outcome renders: something to read, and the one way back.
 *
 * Extracted at the fifth branch rather than the fourth, which is where the repetition stopped being
 * cheaper than the indirection.
 */
export function Outcome({ action, children }: { action: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col items-start gap-4">
			{children}
			<Link className={buttonVariants({ variant: 'outline' })} href="/">
				{action}
			</Link>
		</div>
	);
}
