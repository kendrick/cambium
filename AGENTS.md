# Cambium

Brand reference images in, semantic DTCG design tokens out. A static, bring-your-own-key web prototype. The full design lives in issue #1.

## Agent skills

### Issue tracker

GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Testing

Read before writing or changing a test: the two Vitest seams, the browser tier, where test-first is required, and what is deliberately left untested. See `docs/agents/testing.md`.

### Code review

Before calling a feature done, run the `code-review` skill over the branch since `main` and fix what holds up. Every ticket inherits the rule, so no issue body has to restate it.
