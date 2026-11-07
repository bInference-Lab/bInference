# 0382. The first chat never rides on an answer to a request

Status: Accepted

Accepted by the owner on 2026-11-07. Amends [decision 0242](../DECISIONS.md#d0242).

## Context

Decision 0242 has the agent follow `FIRST-CHAT.md` in every turn that answers the owner's own
message, one question at a time, and its template says to do the owner's request, "then ask the
questions". An owner who never answers the questions gets one at the end of every answer: asked for
a deposit address, the agent sent it and then asked how much money it should trade, out of the
conversation's context.

## Decision

- The first chat is a short introduction, never a gate. The owner's request always comes first: a
  message that asks for something gets a complete answer to that alone, with no first-chat
  question added.
- The agent asks the next question only in a turn whose message answers the question it asked
  before, or greets it with no request of its own, never in a turn a schedule, an alert or a
  proposal's outcome starts.
- When the owner writes about something else instead of answering, the first chat is over, as with
  "skip": the agent saves what it has and calls `first_chat_end` once, and asks none of its
  questions again.
- The agent's fixed instructions say this; `FIRST-CHAT.md`'s template says it too, and a workspace
  file never overrides the instructions.

## Consequences

- An owner who wants the questions answers them one after another; one who ignores them gets them
  once and never again.
- An install whose `FIRST-CHAT.md` holds the old template follows the new instructions, which come
  first.

## Alternatives

- **Count the turns and end the first chat after a few.** The owner may answer slowly; the
  conversation, not a count, tells whether they moved on.
- **Keep asking at the end of answers.** It reads as a form that never ends.
