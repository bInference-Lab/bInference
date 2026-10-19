# @binference/tui

Terminal chat: `binference chat` talks with an agent in the terminal, with its cards, questions and
notices ([decision 0050](../../docs/DECISIONS.md#d0050), [decision 0253](../../docs/DECISIONS.md#d0253)).
The specs are [docs/specs/protocol.md](../../docs/specs/protocol.md) (section 7.7) and
[spec 4](../../docs/specs/cards-and-messages.md) for the words.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is a client like any other: it reaches the engine only through the `ProtocolClient` the CLI
  signs in as `tui` and hands it, and it decides nothing the engine decides. The CLI owns the
  connection, the agent's choice and the terminal's streams (`ChatTerminal`); this package owns
  what the terminal shows and what each key does.
- The screen is plain lines in the terminal's own scrollback, and a live area of a few rows at the
  bottom drawn again on each change (`chat-screen.ts`): no row of it wraps, so it erases exactly
  the rows it drew. Colors come from `node:util`'s `styleText`, so `NO_COLOR` and a pipe get none.
- Every word comes from the i18n `tui` area, or the areas the other surfaces share (`card`,
  `question`, `turn`, `notice`, `error`), in the owner's language, through `wordsOf`. Text from
  outside, such as the agent's words, prints through `displayOutsideText`, so it never moves the
  cursor.
- A card is answered only with Ctrl+Y and Ctrl+N, keys typing never makes (decision 0253).
- Prints keep the order their pushes came in: each topic's work runs through one job queue, and
  the owner's actions through another.
- Tests sit beside the code and drive the chat on a fake engine and a fake terminal
  (`src/testing/chat-harness.ts`) on Vitest's fake timers and a manual clock; the screen emulator
  reads what the terminal shows. The pseudo-terminal round trip runs `binference chat` itself in
  `packages/cli/src/e2e/terminal-chat.test.ts`. Chinese text goes in `*.zh.test.ts`.
