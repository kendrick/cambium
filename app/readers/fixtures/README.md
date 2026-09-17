# Reader fixtures

Recorded Anthropic Messages API responses, one JSON file per case, each wrapping `{ status, headers, body }` so a test can drive a fake `fetch` straight from the file. `body` matches the real Messages API response and error shapes (see Anthropic's Messages API reference); headers are lowercase, and every fixture carries a `request-id` because the reader attaches it to every error. These sit one layer further out than `core/fixtures/raw-responses/`, which holds `RawReaderResponse` envelopes after a reader has already unwrapped them.

The one boundary worth remembering: `malformed-no-content-block.json` is a 200 whose `content` array has nothing the reader can read a seed out of, which is a reader-level failure. `structured-prose-not-json.json` is also a 200, with a normal text block, but the text is prose rather than JSON, so the reader treats it as a success and hands the text to the core, where `parseSeed` is the one that rejects it. Do not fold these two together.
