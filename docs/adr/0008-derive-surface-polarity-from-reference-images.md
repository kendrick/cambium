# Derive Surface Polarity From the Reference Images, and Let It Choose Only the Default Scheme

ADR-0004 removed `surfacePolarity` from `BrandSeedSchema` and left #135 as the place a polarity could come back, once one of three things showed up: a dark-dominant brand whose preview or export opens wrong, an export consumer asking for a dark default, or #18's count showing that a meaningful share of real brands are dark-dominant. None has. Kendrick listed #135 for the 2026-09-29 wave anyway, and his listing overrides the gate. So this ADR answers the fork ADR-0004 left open without the evidence it asked for, and for that reason it picks the option that costs nothing to undo.

ADR-0004 declined to keep asking a model for the value. Now `core/surface-polarity.ts` reads it from the pixels of each `images[].downscaled` a record already stores. For each image it takes the most common colour among opaque pixels, counting every pixel on two grids of 16-wide buckets, the second shifted half a bucket. A flat colour carrying codec noise then stays in one bucket on at least one grid under two conditions: each channel's values stay within 8 of each other, and every channel that crosses a bucket edge crosses one on the same grid. Wider noise, or two channels crossing edges on different grids, splits the colour on both. An image votes dark when that colour's WCAG relative luminance falls below about 0.1791, the point where white text starts to out-contrast black: `#757575` is dark, `#767676` light. Each image votes once, and a tie or a light majority reads light. The value is a pure function of images the record already holds. It needs no model call and adds no field to the seed or the record, so `SCHEMA_VERSION` and `SEED_PROMPT_VERSION` stay where they are.

## Decision

A dark polarity changes which scheme the workspace opens on, and nothing else. The top level of a `TokenSet` stays light. `checkMirroredLayers` in `core/token-set.ts` keeps requiring the top level to equal `schemes.light`, `:root` holds light in every stylesheet with `.dark` overriding it, and every export artefact comes out byte-identical whatever the polarity says.

## Considered Options

### Move Dark to the Top Level for a Dark-First Brand

This is ADR-0004's expensive fork, and nothing has changed its price. It still means replacing `checkMirroredLayers`'s invariant rather than working around it, and every export consumer would then see a different document shape depending on what a brand's images looked like. Nothing asks for that yet.

### Carry the Default Into the Exports

A stylesheet can't open dark without either moving dark into `:root`, which is the shape change above, or shipping an instruction to put `.dark` on the root element, which no consumer has asked for. DTCG documents have no notion of a default scheme at all. An export consumer asking is ADR-0004's second condition, and it still hasn't happened.

### Store the Polarity on the Record

A stored value can drift from the images it describes, and it would cost a `BrandRecord` field for something any reader can recompute from bytes it already holds. Deriving it on demand keeps it true by construction.

### Pool Every Image's Pixels Into One Count

The largest image would decide. Image size is an artefact of the 1568 px fit and of what someone happened to upload, not of how much of the brand an image carries, so each image gets one vote instead.

## Consequences

`deriveSurfacePolarity` exists, is pure, and has a row in `core/purity.test.ts`. It has no caller yet. The one consumer this ADR sanctions is the initial value of the workspace's scheme control, which #154 moves into `components/workspace/shell.tsx`, and that wiring waits for #154 to merge because the file was #154's in the same wave.

`e2e/surface-polarity.spec.ts` checks the answer the way the app reads a stored image: Chromium encodes each fixture as WebP at intake's `WEBP_QUALITY`, and as PNG and JPEG standing in for the uploader's own files, which intake stores untouched. Chromium then decodes each encoding back to pixels.

The rule has known limits. A brand whose surfaces are gradients or photographs has no single dominant colour, and the largest bucket wins regardless. A logo on transparency counts only its opaque pixels, so the logo's own largest colour decides that image's vote. Either kind of image can vote dark or light by mistake. In a record with one image, that vote decides; with more, the other images can outvote it. A dark answer, right or wrong, changes only the scheme the workspace opens on.

Undoing this means deleting a module and one purity row. No stored data depends on it.
