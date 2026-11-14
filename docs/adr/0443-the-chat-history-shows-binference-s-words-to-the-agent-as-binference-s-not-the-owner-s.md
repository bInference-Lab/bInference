# 0443. The chat history shows binference's words to the agent as binference's, not the owner's

Status: Accepted

Accepted by the tech lead on 2026-11-14.

## Context

The agent reads every message that starts or joins a turn in the owner's role. Some of them
binference writes: a settle message (`inbox/intentSettled`,
[decision 0174](0174-a-restarted-runtime-repairs-its-turns-and-chat-waits-in-one-queue-per-agent.md)),
a schedule's and an alert's wake-up, the resume report, and the engine's own `inbox/message`
wake-ups: the answer to a credential request, the end of an image or media job, of a command or of
a helper, and a goal turn's words (decisions 0388, 0392, 0403, 0405, 0407 and 0409). The runtime
stores each as a transcript event with `role: owner` and `kind: text`, and `chat/messages` answers
them so.

The console and terminal chat draw every owner text of `chat/messages` as the owner's own message.
Once the chat loads its history, the owner reads lines such as "The paper swap intent int_… you
proposed is now paper_filled." as words they wrote. While a turn runs, no surface shows these
words: the owner sees the card's receipt, the images or the answer instead.

The runtime tells a settle message, a schedule's or an alert's wake-up and the resume report apart
by their inbox kind. It cannot tell the engine's `inbox/message` wake-ups from the owner's: they
carry the owner's surface, and only some carry `outsideContent` or `goalTurn`.

## Decision

- `inbox/message` gains `fromEngine?: boolean`. The engine sets it on every message it writes in
  the owner's place (`wakeWithMessage`). A message the owner wrote, or a press of a question's
  button, never carries it.
- The runtime keeps `fromEngine: true` in the content of each owner-role transcript event it writes
  for binference's words: a settle message, a schedule's or an alert's wake-up, a resume report and
  an `inbox/message` with `fromEngine`. The model reads them in the owner's role, as today.
- `chat/messages` answers such an event with `role: system` and `kind: text`, its text as stored.
- Surfaces draw only the owner's and the agent's texts, as they do now, so the history shows what
  the live page showed.

## Consequences

- No surface changes: the console and terminal chat already leave `system` texts out.
- Events stored before the change keep `role: owner` in the view, since their content does not say
  who wrote them. They leave with the transcript after `chats.keepDays` or with a chat deletion.
- The protocol gains one optional field. The store needs no migration: `content` is JSON, and a
  field added later is optional ([spec 3, section 3](../specs/database.md#section-3)).
- [Spec 8](../specs/runtime.md) names the field in section 3.3 and the role in section 10.

## Alternatives

- An optional field on the `chat/messages` view: additive too, but every surface must learn it, and
  one that does not keeps drawing binference's words as the owner's.
- Storing the event with `role: system`: the conversation the model reads is rebuilt from the
  stored roles and leaves `system` texts out, so the agent would stop reading its settle messages
  after a restart.
- Showing binference's words as a muted line: they are written for the model, in English only, and
  the live page never shows them.
- Matching a settle message's words in the console: the owner can write the same words, and the
  engine's other wake-ups have no fixed words.
