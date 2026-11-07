# @binference/rich-text

The agent's Markdown read into lines of styled runs, which each surface draws in its own markup:
Telegram's HTML, the console's elements.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is pure and runs in a browser: no Node built-in, no I/O.
- It reads Markdown into data, never into markup: a run's text is never escaped here, and each
  surface escapes it as its own markup needs. A tag the model writes stays text.
- A link is kept only for an `http:` or `https:` address; any other stays text.
- The set it reads is the one the agent's instructions promise (decision 0383); a new mark or
  block is read here once and drawn by every surface.
- Its public API is what `src/index.ts` exports; every export carries TSDoc.
- Tests sit beside the code as `*.test.ts`.
