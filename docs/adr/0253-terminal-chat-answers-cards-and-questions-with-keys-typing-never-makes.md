# 0253. Terminal chat answers cards and questions with keys typing never makes

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Decision 0050](../DECISIONS.md#d0050) ships terminal chat in v1: `binference chat`, from the `tui`
package, with the CLI's rights. Spec 1 gives it the agent's chat topic, `chat/openQuestion`
([decision 0248](0248-the-console-reads-the-agent-s-open-question-with-chat-openquestion.md)),
the cards of the `intent` topic and the notices of the `notice` topic, as the console has them.
No spec says how a terminal shows a card's buttons or a question's choices, how the owner stops
or clears the chat there, or what happens to an image. A terminal has no buttons: every answer is
a key, and the owner types messages with the same keys. A card moves money, so a key that a
message can contain must never confirm one. A terminal cannot attach a picture to a typed line.

## Decision

- **Cards.** Each card version prints when it opens, line by line as the engine draws it
  (`intent/card`). The bottom row shows the first waiting card's header, its time left by the
  terminal's own clock (60 seconds from when it showed, never past the engine's expiry) and its
  keys: **Ctrl+Y** confirms the version shown, **Ctrl+N** cancels. Ctrl keys never come from
  typing, so a message being written never answers a card. A second key on a card already
  answered does nothing, and Ctrl+Y on an expired card does nothing; the engine expires it. A
  card that closes elsewhere prints how it ended.
- **Questions.** The question prints its words and its numbered choices. While the typed line is
  empty, the number key of a choice answers through `chat/answer`; a typed message answers it as
  the engine already takes one. The line that says how it closed prints when it closes.
- **The chat.** Enter sends; a paste (bracketed paste) stays one message. **Esc**, or `/stop`,
  stops the running turn. `/clear` starts a new chat. `/help` lists the keys. **Ctrl+C**, or
  Ctrl+D on an empty line, leaves; a stop signal leaves the same way, and the terminal gets its
  line mode back.
- **Images.** Terminal chat sends none. Its first lines say to send images in Telegram or the
  console, and `/image` says it again; nothing is posted.
- **Text from outside.** The agent's words print with every control character written out as
  `\u{…}`, so a model's words never move the cursor or color the terminal.
- **Words.** Every line is in the owner's language the engine names in `ready`, from the i18n
  `tui` area.
- **The proof.** A test runs `binference chat` in a pseudo-terminal through Microsoft's
  `node-pty`, a test dependency of `cli`, at 1.2.0-beta.15: release 1.1.0 ships its macOS spawn
  helper without the execute bit and cannot start a program there; the beta carries prebuilt
  binaries for macOS, Linux and Windows.

## Consequences

- The owner answers a card from the terminal as from Telegram or the console, and no message
  written at the same time answers it.
- Terminal chat needs a terminal on both ends; `--json`, or a pipe, is refused with
  `cli.chat_needs_terminal`.
- ARCHITECTURE section 25 no longer lists the terminal among the surfaces that send images.
- The catalog moves `node-pty` to its first stable release that starts programs on macOS.

## Alternatives

- **`y` and `n` on an empty line, as for the question.** Rejected: a message that starts with y
  right after the card opens would confirm a trade.
- **Typing `/confirm` and Enter.** Rejected: slower than one key while a card counts down 60
  seconds, and the same words could start a message to the agent.
- **A terminal UI library that owns the screen.** Rejected: the chat needs only a few live rows;
  printed lines stay in the terminal's own scrollback, where the owner copies and scrolls them.
- **node-pty 1.1.0 with the helper's mode fixed by the test.** Rejected: a test that changes files
  under `node_modules` breaks on a read-only store.
