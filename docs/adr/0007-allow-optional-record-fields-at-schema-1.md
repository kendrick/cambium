# Allow Two Optional Record Fields at Schema 1

#36's boundary says nothing in this phase changes an interface, a schema, or a call site established in v1. #39 needs a record to carry a name, since a library of more than three brands isn't navigable by uuid. #39 is also the first product caller of `RecordStore.delete`, and that turns on #122: a stale copy of a deleted record can overwrite a record recreated under its id, or bring the deleted one back. Both need a field on `BrandRecord`. This ADR records the exception to #36 for exactly two optional fields, `name` and `incarnation`, added at `SCHEMA_VERSION = 1` without a bump.

The stamp stays at 1 because #35 is still open, so no v1 has been declared, and #145 reset the stamp to 1 on the understanding that the first real bump after release is 2. Both fields are `.optional()` on a strict object, so every record saved before them still parses, and no record literal or fixture needs an edit.

`name` sits beside `brandUrl` and follows its path. A rename is a metadata-only `put` that moves `revision`, the name travels in the record archive, and it goes when the record is deleted.

Storage mints `incarnation` on every insert and carries it through every commit. `put` refuses a write that carries an incarnation storage no longer holds. That closes both routes #122 describes for any copy carrying one: a copy of a deleted incarnation writing over a recreated id, and a copy read before a delete bringing the record back. A copy carrying none can still take both, as Consequences says. Import drops the archive's incarnation, so every import is a new record with a fresh one.

## Considered Options

### Bump to 2 and Make Both Fields Required

A required field would give up the only benefit of staying at 1. Every stored record would become unreadable, the eight demo fixtures would need regenerating, and every record literal in the test suite would need an edit. With no v1 declared, a bump buys nothing.

### A Sidecar Name Store

A second IndexedDB object store, or `localStorage` keyed by id, avoids the schema change but creates a second source of truth. A delete isn't atomic across the two, and names don't travel in the archive. A rename there wouldn't move the record's revision, though, so it wouldn't fail an open workspace tab's next commit the way a rename on the record does. Ruling A2 rejected it on 2026-09-29.

### A Per-Id Revision Floor Instead of an Incarnation

Storage could stamp a recreated record one past the highest revision the id ever held. That needs `DATABASE_VERSION` 1 → 2 and a second object store, keeps state for every id ever deleted, and still lets a stale write after a delete bring the record back.

## Consequences

A build older than this change refuses any record carrying either field, because the schema is strict. The landing and workspace routes report that as a record this version can't read, the same as any other shape mismatch.

Renaming a record in the library while a workspace tab has it open moves the revision, so that tab's next commit fails with `StaleRecordWriteError`. That is correct, and it's new behavior a person can reach.

One limit stays open. A write carrying no incarnation skips the incarnation check, so it can still resurrect a deleted id or commit over a recreated one. Two kinds of object carry none. The first is an object the inserting caller built itself, because storage mints the incarnation on the way in. Only the upload form and archive import hold such an object, and neither writes it twice.

The second is any copy of a record saved before this change, whichever tab holds it: the library's listing and a workspace tab's copy both qualify. That record gets its incarnation at its first commit after this change, so the window lasts until then. A library tab holding such a copy can rename the record after another tab deleted it, and the rename brings the record back. Closing that would mean changing the revision rule or the insert rule, and this change keeps both. `app/storage/record-store.ts` says so where the rule is written.
