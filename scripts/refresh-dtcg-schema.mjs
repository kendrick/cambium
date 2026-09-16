import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// `@dtcg/schemas` is `"private": true` and was never published, so the hosted JSON is the only
// distribution the DTCG offers. Vendoring is forced rather than chosen; this script is what keeps
// the copy honest. Run it, read the diff, commit. The digest prints so an upstream edit that the
// diff makes look innocuous still leaves a fingerprint in the log.

const SCHEMA_URL = 'https://www.designtokens.org/schemas/2025.10/format.json';
const TARGET = new URL('../core/dtcg/format.2025.10.json', import.meta.url);

const response = await fetch(SCHEMA_URL);

if (!response.ok) {
	throw new Error(`${SCHEMA_URL} returned ${response.status} ${response.statusText}`);
}

// Write the bytes exactly as served. Reformatting would make every refresh produce a diff and
// hide the one that matters.
const body = new Uint8Array(await response.arrayBuffer());
await writeFile(TARGET, body);

const digest = createHash('sha256').update(body).digest('hex');
console.log(`${SCHEMA_URL}
  ${body.byteLength} bytes
  sha256:${digest}`);
