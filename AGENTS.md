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

### Consumer boundary

For every value a diff produces or persists, name what reads it next. Where that consumer evaluates the value outside this codebase, the assertion protecting it belongs in the consumer's units rather than ours. A value can be correct in our representation and wrong the moment a browser compositor or a later schema version evaluates it. See "Where the seam actually is" in `docs/agents/testing.md`.

### Commands

A dispatched task never runs a tree-wide command. Called with no path, `pnpm format` and `pnpm lint:fix` rewrite every file they match, so a worker running either one writes over files its peers still have open. On a wave whose only safety property is that no two tasks touch the same path, that is a torn read waiting to happen. Scope every command to the paths the task owns and leave the tree-wide pass to whoever dispatched the wave, once its gate has cleared. See `docs/agents/commands.md` for what each script does with a path argument.

### Code review

Before calling a feature done, run the `code-review` skill over the branch since `main` and fix what holds up. Every ticket inherits the rule, so no issue body has to restate it.
