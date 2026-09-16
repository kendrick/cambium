import { writeFile } from 'node:fs/promises';

// Next writes its build output to `out/_next`, and GitHub Pages runs Jekyll by default,
// which skips every path starting with an underscore. Without this marker the deployed
// site loads its HTML and none of its JS or CSS.
await writeFile(new URL('../out/.nojekyll', import.meta.url), '');
