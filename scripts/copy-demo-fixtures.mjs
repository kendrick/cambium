import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';

// The demo records load at runtime as static files (#40), never through a JS import: 1.6 MB of JSON in a chunk would blow ADR-0006's budget. Next's static export copies `public/` verbatim, so this puts a generated copy there. `app/demo/fixtures/` stays the one committed source, and `public/` is gitignored.
const source = new URL('../app/demo/fixtures/', import.meta.url);
const target = new URL('../public/demo/fixtures/', import.meta.url);

// `.raw.json` is the reader's unrepaired output, kept beside each record for diffing and never served.
const records = (await readdir(source)).filter(
	(name) => name.endsWith('.json') && !name.endsWith('.raw.json'),
);

if (records.length === 0) throw new Error(`no demo records found in ${source.pathname}`);

// Cleared first, so a fixture removed from the source doesn't linger in a local build.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await Promise.all(records.map((name) => copyFile(new URL(name, source), new URL(name, target))));
