/**
 * Whether a storage call failed because a record would not parse. It has two callers, one on each
 * side of storage: the landing page's read-back of a stored record, and `saveGeneratedVersion` in
 * `app/generation/generate.ts` on a commit. Sharing it keeps both sides agreed on what a schema
 * rejection is.
 *
 * On a read, it means a row came back and would not parse.
 * `RecordStore.get` awaits the row and then runs `BrandRecordSchema.parse` on it inside one
 * promise, so a rejection on its own says nothing about whether a row exists: an aborted
 * transaction rejects the same way. Only a schema rejection is evidence that storage handed
 * something over, and that evidence is exactly what `unreadable` spends when it tells somebody
 * their record is still there and not to clear it.
 *
 * On a commit, it means the record a new version would produce failed the schema. `RecordStore.put`
 * parses before it writes, so the rejection leaves nothing behind, and the landing page offers
 * the person a repair instead of reporting a storage fault.
 *
 * Recognised by the `issues` array a `ZodError` carries, which is the shape callers are meant to
 * read a validation failure out of. Importing zod to use `instanceof` would put 93 kB into a bundle
 * ADR-0002 leaves about 5 kB in, so that is not available. Matching the class name instead was the
 * first attempt and rests on two of the library's internals at once, its error name and its
 * inheritance, either of which can move in a minor release with nothing here failing loudly.
 * Nothing else that can reach either caller's catch carries `issues`: an `idb` or IndexedDB
 * rejection is a `DOMException`, and the storage and workspace errors a commit can throw are
 * this repo's own `Error` subclasses, none of which has the field.
 *
 * It fails toward claiming less, whichever way it is written. If this stops recognising a schema
 * rejection, every read failure reads as `unavailable`, which says nothing about existence rather
 * than saying something false, and a commit's rejection rethrows as an unexpected error rather
 * than offering a repair that can't help.
 *
 * Lives in its own plain `.ts` module, apart from `stored-record.tsx`'s JSX, so its unit test can
 * import it under Vitest's `unit` project: that project resolves no `@/*` alias and runs no
 * bundler, so a `.tsx` pulling in `next/link` (which `stored-record.tsx` does, for `Outcome`)
 * cannot be imported from a `.test.ts` file there. `stored-record.tsx` re-exports this so every
 * existing import site keeps working unchanged.
 */
export function isSchemaRejection(error: unknown): boolean {
	return Array.isArray((error as { issues?: unknown } | null | undefined)?.issues);
}
