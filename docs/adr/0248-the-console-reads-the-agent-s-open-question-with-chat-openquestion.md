# 0248. The console reads the agent's open question with chat/openQuestion

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 1](../specs/protocol.md) section 7.7 draws the agent's question on every chat surface: in
Telegram as a message with buttons, and as the `chat/question` push on the agent's chat topic for
the console and terminal chat. [Spec 4](../specs/cards-and-messages.md) section 8.2 gives its
words. A question stays open for 24 hours, but a push reaches only a page that is open when it
goes out. A topic replays from a `seq` the page already knows, and a page opened later knows
none. Telegram keeps its copies in `engine.sqlite`; spec 1 has no operation that reads a question.
`chat/messages` reads the runtime's transcript, which holds no question id and cannot answer
while the runtime is down.

## Decision

- **`chat/openQuestion`**, scope `read`: `{ agent }` → `{ question?: QuestionView }`, the agent's
  open question, or none. It is a call that meets the question, as spec 1 says: one 24 hours old
  closes `expired`, `chat/questionClosed` is pushed, and the answer holds none.
- **The console** reads it when the chat opens, at each `chat/question` and `chat/questionClosed`
  push, and after a gap in the topic. It draws the question below the thread: the header
  `question.header`, the agent's words, one plain button per choice (never in a card's Confirm or
  Cancel style) and `question.typeHint`. A press calls `chat/answer` with the choice's place. A
  message written in the composer answers it as typed text, as the engine already does.
- **When it closes**, the buttons go away and the last line becomes `question.answered`,
  `question.answeredTyped` or `question.closed` with its reason, until the next question or a
  reload. A press the engine refuses as `question.closed` shows `question.closedToast`.
- The words are spec 4's `question.*` keys in both languages; no new word.

## Consequences

- An owner who opens the console after the agent asked sees the question and answers it there.
- Terminal chat reads the open question the same way.
- Spec 1 section 7.7 gains the row. No MCP tool maps it.

## Alternatives

- **Replay the chat topic from its first push.** Rejected: the engine keeps a bounded number of
  pushes, so an older question is lost, and every reload would replay every turn's drafts.
- **Add the question to `chat/messages`.** Rejected: that read goes to the runtime's transcript,
  which has no question id and no answer while the runtime is down.
- **Show a question only when its push arrives.** Rejected: an owner who opens the console after
  the question was asked would see neither it nor its buttons.
