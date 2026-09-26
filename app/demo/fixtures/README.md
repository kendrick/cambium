# Demo Fixtures

Eight reference images, each with the brand record Cambium generated from it. They are for the keyless demo in #40. Each image is in the set because it pushes the seed somewhere the others don't, so the demo shows the pipeline across different kinds of input.

Where each image came from, and its licence, is in [SOURCES.md](SOURCES.md).

## What Each Fixture Holds

Every fixture is three files that share a name:

- `<name>.jpg` is the reference image.
- `<name>.json` is a `BrandRecord` with one image and one version. It parses with `BrandRecordSchema`.
- `<name>.raw.json` is the model's raw response, plus the provider, model, prompt version, request id and the image id the model was shown.

`pnpm fixture:demo` wrote every record and raw response. Nobody edited them by hand. The only change after generation was `pnpm format app/demo/fixtures`, which re-indents the JSON to the repo's style and leaves every value as it was.

All eight came from `codex exec` with model `gpt-5.6-terra` and prompt version `seed-v4`, generated on 2026-09-26.

## Regenerating or Replacing a Fixture

To generate a record from an image, run a live model call:

```sh
pnpm fixture:demo app/demo/fixtures/<name>.jpg --tag <ui|photo|artwork> --model gpt-5.6-terra --out app/demo/fixtures
```

A live call gives a different seed each time, so rerunning it changes the fixture. To rebuild a record from its recorded response with no model call, pass `--raw`:

```sh
pnpm fixture:demo app/demo/fixtures/<name>.jpg --tag <tag> --raw app/demo/fixtures/<name>.raw.json --out <dir>
```

Two `--raw` runs over the same image produce records that differ only in the record `id` and `versions[0].createdAt`.

Then run `pnpm format app/demo/fixtures`, since the script writes two-space JSON and `pnpm format:check` expects tabs.

If you replace an image, read the next two sections first. They say what each image contributes, so a replacement can keep the spread.

## What Each Image Is For

| Fixture | Tag | What it demonstrates | Brand hue | Mean L |
| --- | --- | --- | --- | --- |
| `ui-wikipedia.jpg` | `ui` | Light, dense reading UI with one blue link accent | 262° | 0.93 |
| `ui-devtools.jpg` | `ui` | Dense developer tool, cool greys, small type | 257° | 0.94 |
| `photo-ceramics.jpg` | `photo` | Warm, muted earth tones, rounded organic forms | 210° | 0.46 |
| `photo-window.jpg` | `photo` | Cool, desaturated, airy | 225° | 0.71 |
| `artwork-blocks.jpg` | `artwork` | Hot magenta, violet and orange colour blocks | 12° | 0.51 |
| `artwork-dashboard.jpg` | `artwork` | Dark-dominant neon data display, several saturated hues | 198° | 0.27 |
| `artwork-paint.jpg` | `artwork` | Loud multi-hue paint strokes on a light orange ground | 210° | 0.78 |
| `artwork-device.jpg` | `artwork` | Muted violet monochrome with a large rounded corner | 330° | 0.47 |

Brand hue is the OKLCH hue of the seed's `brand` key colour. Mean L is the mean OKLab lightness of the downscaled image stored in the record, from 0 for black to 1 for white.

Some images do jobs the table can't show:

- The two `ui-` images are the only ones where the model filled the type fields from what it saw. `trackingFeel`, `typeClassification` and `suggestedPairing` come back null for every photo and every artwork except `artwork-dashboard`, whose monospaced read-outs got a mono type classification and a mono pairing. A replacement for either `ui-` image needs visible, legible text.
- `artwork-dashboard` is the dark image. Keep one image whose surface is mostly dark, or the demo never shows a dark-dominant brand.
- `artwork-device` is the only non-UI image with a `radiusCharacter` (`base` 20, `soft`), from its big rounded corner. The two `ui-` images give `sharp`, so this image is what shows a soft radius.
- `photo-window`, `artwork-dashboard` and `artwork-device` are the three with a `shadowCharacter`. `artwork-device` is the only `tight` one.
- `artwork-blocks` and `artwork-paint` carry no `neutralTemperature`. Their seeds hold only `keyColors`, `imageClassifications` and `expressive`.

The model's `imageClassifications` disagreed with the tag twice. It classified `artwork-blocks` and `artwork-device` as `photo`, which is fair, since both are photographed 3D scenes.

## How Far Apart the Seeds Are

A seed has ten fields. For each pair of fixtures, this counts the fields whose values differ. Image ids are blanked first, since every record's image has its own id and that alone would make `keyColors` and `imageClassifications` differ everywhere. Two nulls count as the same value.

| | `ui-wikipedia` | `ui-devtools` | `photo-ceramics` | `photo-window` | `artwork-blocks` | `artwork-dashboard` | `artwork-paint` | `artwork-device` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ui-wikipedia` | — | 6 | 8 | 9 | 8 | 8 | 8 | 9 |
| `ui-devtools` | 6 | — | 8 | 9 | 8 | 8 | 8 | 9 |
| `photo-ceramics` | 8 | 8 | — | 4 | 3 | 8 | 4 | 5 |
| `photo-window` | 9 | 9 | 4 | — | 4 | 7 | 5 | 5 |
| `artwork-blocks` | 8 | 8 | 3 | 4 | — | 8 | 3 | 5 |
| `artwork-dashboard` | 8 | 8 | 8 | 7 | 8 | — | 7 | 9 |
| `artwork-paint` | 8 | 8 | 4 | 5 | 3 | 7 | — | 6 |
| `artwork-device` | 9 | 9 | 5 | 5 | 5 | 9 | 6 | — |

The target was at least four differing fields for every pair. Two pairs miss it, at three each:

- `photo-ceramics` and `artwork-blocks` differ only in `keyColors`, `neutralTemperature` and `expressive`.
- `artwork-blocks` and `artwork-paint` differ only in `keyColors`, `imageClassifications` and `expressive`.

Both misses have the same cause. For most photos and artworks the model leaves the type, radius and shadow fields null, and two nulls match. `artwork-blocks` and `artwork-paint` tie for the sparsest seed in the set: each fills only `keyColors`, `imageClassifications` and `expressive`, so either can differ from another equally sparse seed in at most those three fields plus `neutralTemperature`. Neither image was regenerated or swapped to force the count, because that would hide the gap. A replacement for `artwork-blocks` or `artwork-paint` that shows a surface with a clear radius or shadow would lift both pairs.

`typeScaleRatio` is null in all eight seeds, so no fixture shows it.

## Key-Colour Hues

The brand hues cluster in blue. Five of eight sit between 198° and 262°: `artwork-dashboard` 198°, `photo-ceramics` and `artwork-paint` 210°, `photo-window` 225°, `ui-devtools` 257° and `ui-wikipedia` 262°. The other two are `artwork-blocks` at 12° (red-magenta) and `artwork-device` at 330° (muted violet). Among the blues, `photo-window` is close to grey, at chroma 0.035.

The accent key colours fill some of the rest: 34° and 280° in `artwork-blocks`, 72° in `photo-ceramics`, 71° and 337° in `artwork-dashboard`, 355° and 48° in `artwork-paint`.

No key colour of any role falls between 80° and 190°, so the set has no green, no yellow-green and no teal. A new or replacement image with a green brand colour would fill the largest gap. Replacing any of the five blue-brand images with something outside 198°–262° would spread the brand hues further.

## Dark-Dominant Count for #135

Three of the eight images are dark-dominant: `artwork-dashboard`, `photo-ceramics` and `artwork-device`.

An image counts as dark-dominant here when the mean OKLab lightness of its stored downscaled image is below 0.5. The seed no longer carries a surface polarity (ADR-0004 removed it), so the stored image is the only thing in the record that can answer the question. That also matches how #135 proposes to derive polarity, from the stored images with no model call.

Only `artwork-dashboard` is dark by a wide margin, at 0.27. `photo-ceramics` is at 0.46 and `artwork-device` at 0.47. `artwork-blocks` just misses at 0.51. Moving the threshold by a few hundredths would change the count, so read it as one clearly dark image and two borderline ones. These are stock photos and artworks rather than real brands, so this count describes the demo set and says little about how many real brands are dark-first.
