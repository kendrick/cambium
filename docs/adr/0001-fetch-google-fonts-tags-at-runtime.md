# Fetch Google Fonts Tag Data at Runtime Rather Than Vendoring It

Cambium ranks font candidates against `tags/all/families.csv` from `google/fonts`, which classifies 1,941 families on a taxonomy that matches the Brand Seed's tone vocabulary exactly (`/Sans/Geometric`, `/Sans/Humanist`, `/Sans/Neo Grotesque`) and scores each family 0 to 100. That file carries no licence. Google agreed in [google/fonts#9347](https://github.com/google/fonts/issues/9347) in June 2025 that it should be Apache-2.0, and has not moved it in the fifteen months since. So Cambium never hosts a copy: the browser fetches it from jsDelivr at a pinned commit, and a small table Cambium authors itself answers whenever that fetch fails.

## Considered Options

### Vendor the CSV

The best data and the simplest code. It also makes Cambium a redistributor of a file nobody has licensed for redistribution.

### Author Our Own Table and Nothing Else

No licensing question at all, and it repeats a move the project already made against Radix's colour scales, which the spec treats as a taste reference rather than a correctness authority. But hand-authoring scores for sixty families to reproduce what Google already measured is a lot of work that lands on a worse answer, and it is exactly the invented judgement that `$extensions` provenance exists to flag.

### Commit the File Encrypted

Rejected. A static client-side app has to ship the key alongside the ciphertext, so this is redistribution with extra steps. The blob sits in git history either way, and it trades a defensible position for one that reads as concealment.

## Consequences

The table is an input to stage 2 rather than something stage 2 fetches. Resolving it happens before derivation runs, and the result caches, so stage 2 stays a pure function of the seed and the table with no network call inside it. The spec calls that split the load-bearing decision, and nothing here gets to make an exception to it.

Reproducibility follows the pattern the spec already uses, which is to achieve it by reference. Each record persists the resolved table's source and version beside the prompt version, provider, and model identifier it stores today. A client that fell back to the in-repo table and one that fetched the full taxonomy rank the same seed differently, so without that recorded identity the promise that the same seed always produces the same tokens is false across the boundary between them.

Pin a commit SHA rather than `main`. jsDelivr serves a pinned path as immutable for a year, where `raw.githubusercontent.com` caches the same file for 300 seconds. Pinning removes drift within one source. The recorded identity is what covers drift between the two.

Attribution obligations attach to what Cambium ships, never to what it generates. Naming Inter and calling it a neo-grotesque is a fact about a typeface, so the token sets Cambium produces carry no obligation into the repos they land in.

If `tags/` ever moves under `apache/`, the work is to swap the implementation behind the seam, not the seam itself. Do not vendor the file before that happens.
