# @binference/tui

Terminal chat: `binference chat` talks with an agent in the terminal
([decision 0050](../../docs/DECISIONS.md#d0050)).

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- The screen is plain lines in the terminal's own scrollback, and a live area of a few rows at the
  bottom drawn again on each change (`chat-screen.ts`): no row of it wraps, so it erases exactly
  the rows it drew. Colors come from `node:util`'s `styleText`, so `NO_COLOR` and a pipe get none.
- Tests sit beside the code as `*.test.ts`.
