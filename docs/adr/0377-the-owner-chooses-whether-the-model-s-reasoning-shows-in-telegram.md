# 0377. The owner chooses whether the model's reasoning shows in Telegram

Status: Amended by 0393

Accepted by the tech lead on 2026-11-05, on the owner's decision.

## Context

A reasoning model can think for seconds before it answers. The runtime reads that reasoning from
every provider and keeps it in the transcript, but no surface shows it, so the owner watched the
typing indicator for a turn that was busy. The owner wants the choice: no reasoning by default, a
live view of it while the agent works, or a lasting copy before each answer.

Reasoning is model text, as the answer is: what the model read may steer it, and it can quote a
tool's result. It never decides anything; only the owner's tap confirms a card.

## Decision

It amends decision 0371's rule that the runtime sends only drafts and progress lines, and
decision 0134's rule that the owner's chat changes only the owner's language.

- **The protocol.** `turn/reasoning` `{ agent, turn, text, final }`, scope `agent`, only the
  runtime's current token, pushes `chat/reasoning` with the same fields on the agent's chat topic;
  nothing keeps it. `final: false` carries the reasoning of the turn's current model call so far,
  at most every 250 ms, through the same line of sends as the drafts; `final: true` carries the
  whole reasoning of a call that answered, before its tools run or the final text goes. Each holds
  at most 50,000 characters. Both are additions to protocol version 1.
- **The setting.** `telegram.replies.reasoning` in config.json5: `"off"` (the default), `"streamed"`
  or `"kept"`, read as each turn starts. Config version 16 adds it, at `"off"`.
- **Streamed.** In the `progress` reply mode, one italic line under the status message's label,
  "Reasoning: …", cut to 120 characters and replaced as it grows; it counts as work, so the status
  message shows 1.5 seconds after the first reasoning, and a headline of text written before a tool
  takes its place. In the `partial` mode, a message of its own beside the answer's preview: a bold
  title and the reasoning in italics, first sent once it holds 30 characters, edited at most once a
  second, deleted once the answer came and it has shown for 4 seconds.
- **Kept.** Each model call's whole reasoning goes as a message of its own before the answer: the
  bold title `telegram.chat.reasoning`, "Reasoning", then the reasoning in italics, its Markdown
  drawn by the rules of decision 0370, split at 4,000 characters.
- **The command.** `/replies` shows how replies and reasoning show in the chat, with a button for
  each choice of `telegram.replies.stream` and `telegram.replies.reasoning`. A tap sets that one
  key through `config/change`, which the chat may now send for `owner.locale` or one key of
  `telegram.replies`; any other patch from the chat stays `auth.scope`.
- **The other surfaces.** The console and terminal chat show none of it.

## Consequences

- The owner sees why a slow turn is slow when they choose to, and never by default.
- The runtime sends reasoning whatever the owner chose; the bot drops what the setting hides.
- Every surface that reads the chat topic meets a new push kind; the console and terminal chat
  read it as nothing.

## Alternatives

- **Show reasoning always.** It doubles what the owner reads for every answer, and the owner chose
  hidden by default.
- **A per-session switch kept in the runtime.** Every other reply rule lives in config.json5 with a
  live reload and a journal; a second store of the same choice would drift from it.
- **Keep reasoning in the engine's store.** The transcript already keeps it, in the runtime that
  owns the turn.
