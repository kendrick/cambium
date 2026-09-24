import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { isSchemaRejection } from '@/components/is-schema-rejection';

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
 * Re-exported from `./is-schema-rejection` so every existing `@/components/stored-record` import
 * site keeps working. The function itself lives there, in a plain `.ts` module, so its unit test
 * can import it without pulling in this file's `next/link` — see that module's docblock.
 */
export { isSchemaRejection };

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
