# Remove `surfacePolarity` Rather Than Wire It Up

`BrandSeedSchema` declares `surfacePolarity` as `z.enum(['light-first', 'dark-first']).nullable()` at `core/brand-seed.ts:189`, and `app/readers/seed-prompt.ts` asks the model for it at three sites, naming it among the eleven fields the prompt requires. No production code reads it. The scale engine already builds a `Record<SchemeName, RampSet>` for both `light` and `dark` from the same seed, and `SEMANTIC_MAP` resolves every scheme's surfaces, `background` included, off the neutral ramp that engine produces, so a brand's light and dark surfaces exist regardless of what this field says. #83 decided on 2026-09-25 to remove it rather than wire it up. This ADR records that removal and folds it into #77's shape change: `SCHEMA_VERSION` moves to 9 and `SEED_PROMPT_VERSION` moves to `seed-v4` in the same commit, so a stored seed breaks its parse once instead of twice.

## Considered Options

### Wire It Up as a Default Scheme

The plain reading of the field is which scheme a consumer opens on: the preview, an export's stylesheet. That is cheap to build, and it is also not a reason to keep asking a model for it. Nothing today lets a user see a wrong default, because nothing sets one, and a boolean a person can toggle in the workspace does not need to survive a Messages API round trip, a `strictObject` parse, and a schema version to exist. Producing the field costs tokens and prompt surface for an answer the UI could supply for free.

### Wire It Up by Moving Dark to the Top Level

The other reading is which scheme sits at the top level of a `TokenSet`, unprefixed. `checkMirroredLayers` in `core/token-set.ts` enforces that the top level equals `schemes.light`, mirroring `app/globals.css`, where `:root` holds light and `.dark` overrides it. A `dark-first` seed would have to either leave that invariant alone, in which case the field means nothing a consumer can act on, or replace it with one that lets `dark` take the top level, which is a shape change of its own rather than a value the current schema can carry. Making that decision without evidence that any real brand needs it is a schema change written against a guess.

## Consequences

`surfacePolarity` is gone from `BrandSeedSchema`, from the three sites in `app/readers/seed-prompt.ts`, from `core/brand-seed.test.ts`, and from roughly twenty fixture nulls across `core/` and `app/`. Because `BrandSeedSchema` is a `strictObject`, a seed stored under the previous shape stops parsing the moment the field disappears, which is the loud failure `SCHEMA_VERSION` exists to produce. `app/storage/indexed-db-record-store.ts:55` documents the resulting contract: a record stamped with an older `schemaVersion` throws on `get` and on `list` alike, naming `schemaVersion` in the error, and the export archive stays the only migration path.

Removing the field changes no derived token. Both schemes' surfaces were already a function of the ramps the engine builds from the rest of the seed, never of this one, so there is no consumer to update and no test that pinned a `surfacePolarity` branch to delete.

#135 is where a polarity comes back, if it comes back: derived from the brand's own reference images rather than asked of the model, and only once one of its conditions shows up, a real dark-dominant brand whose preview or export opens wrong, an export consumer asking for a dark default, or the count #18 records showing a meaningful share of real brands are dark-dominant. Whichever direction that ticket picks still lands on this ADR's fork. The cheap option is a default scheme with no schema cost, and the expensive one is moving dark to the top level, which still means changing `checkMirroredLayers`'s invariant rather than working around it. #135 records that decision next to this one rather than repeating the guess this ADR declines to make now.
