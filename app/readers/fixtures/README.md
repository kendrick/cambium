# Reader fixtures

Two readers, two unrelated sets of fixtures, and nothing shared between them. The JSON files are recorded Anthropic responses. `brand-images.ts` draws reference images for the local extractor.

## Recorded Anthropic Responses

Recorded Anthropic Messages API responses, one JSON file per case, each wrapping `{ status, headers, body }` so a test can drive a fake `fetch` straight from the file. `body` matches the real Messages API response and error shapes (see Anthropic's Messages API reference); headers are lowercase, and every fixture carries a `request-id` because the reader attaches it to every error. These sit one layer further out than `core/fixtures/raw-responses/`, which holds `RawReaderResponse` envelopes after a reader has already unwrapped them.

Two of them lead with a `thinking` block. Opus 5 runs adaptive thinking by default and the reader sends no `thinking` key, so a real 200 carries one ahead of the text or `tool_use` block; `structured-success-thinking-first.json` and `forced-tool-success-thinking-first.json` are what stop a reader from taking `content[0]` and calling it the seed.

`refusal-thinking-first.json` and `truncated-max-tokens-thinking-first.json` lead with one too, and each also holds a readable text block: a sentence of refusal, and a seed cut off mid-value. Both are 200s, and only `stop_reason` marks them as failures. A reader that ran the normalizer before checking it would hand either one to the core as a seed, so keep the text blocks in place.

The one boundary worth remembering: `malformed-no-content-block.json` is a 200 whose `content` array has nothing the reader can read a seed out of, which is a reader-level failure. `structured-prose-not-json.json` is also a 200, with a normal text block, but the text is prose rather than JSON, so the reader treats it as a success and hands the text to the core, where `parseSeed` is the one that rejects it. Do not fold these two together.

## Reference Images for the Local Extractor

`brand-images.ts` draws four RGBA pixel buffers in code: a logo, an application screenshot, a photograph, and a page of nothing but greys. Each fixture states its own brand colour as sRGB hex, and that hex is what `../local-extract.test.ts` measures the extractor's answer against. A downloaded PNG could not hold up that end. Its brand colour is whatever the file turned out to contain once somebody picked a profile and a compressor, so it would have to be measured before it could be asserted. Drawing the fixtures also keeps a file of unclear licence out of the repo, which is the position ADR-0001 already takes.

Two of the four do the real work. The screenshot is the case issue #33 is about: over four fifths of it is off-white and grey, and the brand colour is one small button, so a naive most-common-colour read returns `#fafafa`. The page of greys asks the same question from the other side, where the honest answer is that the image holds no brand colour at all.

Editing a fixture moves what the suite asserts and nothing a visitor ever sees, so it needs no version bump. Editing the heuristic does, and `LOCAL_EXTRACT_VERSION` in `../local-reader.ts` is where that bump lands.
