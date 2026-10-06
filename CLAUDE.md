@AGENTS.md

## Claude Code

- Every package folder has a one-line `CLAUDE.md` that imports its `AGENTS.md`, so its rules load
  when you open a file there.
- Skills live in `.agents/skills/`; `pnpm setup` links `.claude/skills` to them.
- Run `clean-diff` on your diff, then `review-diff`, before you call a change done.
