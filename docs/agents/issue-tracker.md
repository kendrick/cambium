# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..." --milestone "<spec-slug>"`. Use a heredoc for multi-line bodies. See **Milestones** below for which milestone applies and when it may be omitted.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,milestone,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], milestone: .milestone.title, comments: [.comments[].body]}]'` with appropriate `--label`, `--milestone`, and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Set / change milestone**: `gh issue edit <number> --milestone "<spec-slug>"`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Issue relationships

**Relationships are always native GitHub objects. Never a line of body text.**

Sub-issues and dependencies are real records: they render in the issue sidebar, drive the parent's progress bar, gate the "blocked" state in the UI, and are queryable. A `Blocked by: #12` line in a body is none of those things—it is a comment that looks like a relationship, and it silently rots when the blocker closes. If an endpoint below fails, **stop and report the failure**. Do not write the text form as a fallback; a run that degrades quietly produces exactly the fake graph this section exists to prevent.

### Numbers vs database IDs

Relationship endpoints take the **database ID**, not the `#number` you see in the UI and not the `node_id`. Getting this wrong yields a 404 that looks like a permissions problem. Resolve it first:

```sh
gh api repos/:owner/:repo/issues/<number> --jq .id
```

Path parameters (`ISSUE_NUMBER` in the URLs below) take the **number**. Body parameters (`issue_id`, `sub_issue_id`) take the **database ID**. Every call below mixes the two.

### Parent / child (sub-issues)

Add a child to a parent:

```sh
gh api --method POST repos/:owner/:repo/issues/<parent-number>/sub_issues \
-H "X-GitHub-Api-Version: 2026-03-10" \
-F sub_issue_id=<child-db-id>
```

Returns 201. Use `-F` (typed) rather than `-f` (string)—these fields must serialize as integers.

List children: `gh api repos/:owner/:repo/issues/<parent-number>/sub_issues`

Get a child's parent: `gh api repos/:owner/:repo/issues/<child-number>/parent`

Remove a child: the endpoint is **`sub_issue`, singular**, unlike every other verb in the set. `DELETE .../issues/<parent-number>/sub_issue` with `-F sub_issue_id=<child-db-id>` in the body. The plural form 404s. This is a known API inconsistency, not a mistake in this doc.

Reorder children: `PATCH .../issues/<parent-number>/sub_issues/priority`.

### Blocking (issue dependencies)

Record that `<blocked>` cannot start until `<blocker>` is done:

```sh
gh api --method POST repos/:owner/:repo/issues/<blocked-number>/dependencies/blocked_by \
-H "X-GitHub-Api-Version: 2026-03-10" \
-F issue_id=<blocker-db-id>
```

Returns 201. `issue_id` is the id of the issue that _blocks_ the current one, so the direction is: POST to the ticket that is stuck, naming the ticket it waits on.

Read edges in both directions:

- Blocked by: `gh api repos/:owner/:repo/issues/<n>/dependencies/blocked_by`
- Blocking: `gh api repos/:owner/:repo/issues/<n>/dependencies/blocking`

Remove an edge: `DELETE .../issues/<blocked-number>/dependencies/blocked_by/<blocker-db-id>`—note the id goes in the **path** here, not the body, unlike the POST.

The live gate is `issue_dependencies_summary.blocked_by` on the issue object, which counts **open** blockers only. A ticket is unblocked when that reaches zero; do not compute this by reading bodies.

### Rate limiting

Both the sub-issue and dependency endpoints warn that creating or removing content too quickly may trigger secondary rate limiting. A slicing pass that opens fifteen tickets and then fires thirty edge calls in a burst will hit this. Create the issues first, collect their database IDs in one pass, then write edges with a short pause between calls. On a 403 with a secondary-limit message, back off and retry rather than falling through to text.

### Verifying the graph

Before ending any session that created tickets, confirm the edges exist as objects:

```sh
gh issue list --state open --milestone "<spec-slug>" --json number,title \
  --jq '.[].number' | while read n; do
    printf '#%s blocked_by: ' "$n"
    gh api repos/:owner/:repo/issues/$n/dependencies/blocked_by --jq '[.[].number] | @csv'
  done
```

Any ticket you intended to gate that reports an empty list did not get its edge written.

## Milestones

**Every spec is a milestone. Every issue belonging to that spec carries it.**

The spec itself stays a GitHub issue—downstream skills reference it by number (`/to-spec #<issue>`, sub-issue parentage, dependency edges), and a milestone has no comment thread or relationship graph to hang those on. The milestone is the container and the progress surface, not the spec body.

**Milestone title** is the spec slug: lowercase, hyphenated, derived from the spec title (`cwe-staffing-filters`, not `CWE Staffing Filters`). It is the join key—every skill derives it from the parent spec rather than being told it.

**Creating one.** `gh` has no native milestone commands; use the REST API:

```sh
gh api --method POST /repos/:owner/:repo/milestones \
-f title='<spec-slug>' \
-f description='Spec: #<spec-issue-number>' \
-f due_on='2026-10-31T23:59:59Z'
```

`due_on` is optional; set it when the spec has a real delivery date, omit the flag otherwise.

**Checking whether one exists** (do this before creating—the API returns 422 on a duplicate title):

```sh
gh api /repos/:owner/:repo/milestones --jq '.[].title'
```

**Closing one.** When every issue in a milestone is closed, close the milestone. Look up its number by title first:

```sh
gh api /repos/:owner/:repo/milestones --jq '.[] | select(.title=="<spec-slug>") | .number'

gh api --method PATCH /repos/:owner/:repo/milestones/<n> -f state='closed'
```

**Constraints, so you don't design around them by accident:**

- An issue holds exactly **one** milestone, unlike labels. A ticket that genuinely serves two specs has no home—stop and ask rather than picking one silently.
- Milestones **do not nest**. A wayfinder map spanning several specs cannot be a milestone of milestones; it gets its own milestone or none.
- Milestones are **repo-scoped**. Work spanning repos needs a milestone per repo with a matching title.

**Issues that may have no milestone:** standalone bug reports, incoming triage, and anything not descended from a spec. Everything produced by `/to-spec`, `/file-issue`, or `/wayfinder` must have one.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

If the issue is a **spec** (`/to-spec`): first resolve its milestone. Check for a milestone whose title matches the spec slug; create it if absent, using the spec title as `title` and `Spec: #<issue>` as `description`. Create the spec issue with `--milestone "<spec-slug>"`, then patch the milestone description with the issue number once you have it.

If a `/wayfinder` map preceded the spec, reuse the map's milestone instead of creating a second one, and rename it to the spec slug if the destination shifted during charting.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## When a skill says "break a spec into tickets"

Used by `/file-issue`. Three things are non-optional for every ticket produced:

1. **Milestone.** Read it from the parent spec issue (`gh issue view <spec> --json milestone --jq .milestone.title`) and pass `--milestone` on create. Do not re-derive the slug from the spec title—read it from the issue, so a renamed milestone stays authoritative.
2. **Parentage.** Attach the ticket to the spec issue as a native sub-issue, per **Issue relationships** above. The spec is the parent; every ticket is a child.
3. **Blocking edges.** Every blocking relationship the slicing pass identifies becomes a native dependency, per **Issue relationships** above. A ticket that declares a blocker in prose but carries no edge has not been sliced correctly.

Sequence the whole pass to respect the rate-limit note: create all issues, collect database IDs, then write parentage, then write edges.

A ticket created without a milestone, without a parent, or missing an edge it should have is a defect, not a default. If a ticket has no parent spec, stop and ask rather than creating it unattached.

**Verify before ending the session**—both the milestone sweep and the edge sweep:

```sh
gh issue list --state open --json number,title,milestone \
--jq '.[] | select(.milestone == null) | "\(.number)  \(.title)"'
```

Anything returned here that came from this session's slicing needs `gh issue edit <n> --milestone "<spec-slug>"`. Then run the `blocked_by` sweep from **Verifying the graph**.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets. All parentage and blocking uses the native objects described in **Issue relationships** above—that section is the single source of truth for the commands; this one only says which relationships to draw.

- **Milestone**: the map and all its children share one milestone, named for the map's destination slug. Create it at charting time, alongside the map issue, by the procedure in **Milestones** above. When the map closes and `/to-spec` runs, the spec inherits this milestone rather than opening a new one.
- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map --milestone "<destination-slug>"`.
- **Child ticket**: an issue attached to the map as a native sub-issue, carrying the map's milestone. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev. The map body may also list children for readability, but the sub-issue record is what counts—never the list alone.
- **Blocking**: native dependencies. A ticket is unblocked when `issue_dependencies_summary.blocked_by` is zero.
- **Frontier query**: list the map's open children (`gh api repos/:owner/:repo/issues/<map-number>/sub_issues`, or `gh issue list --state open --milestone "<destination-slug>"`), drop any with `issue_dependencies_summary.blocked_by > 0` or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
