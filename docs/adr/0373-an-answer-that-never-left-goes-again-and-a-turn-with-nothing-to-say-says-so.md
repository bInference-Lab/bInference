# 0373. An answer that never left goes again, and a turn with nothing to say says so

Status: Accepted

Accepted by the tech lead on 2026-11-05.

## Context

[Decision 0371](0371-a-running-turn-streams-its-text-and-tool-lines-to-one-status-message.md)
turns the status message into `telegram.chat.notDelivered` when Telegram refuses the answer. A
network fault before any connection opened is a refusal too there, though Telegram never saw the
message, so a short outage of the owner's network loses an answer that one more try would deliver.

A reasoning model can also end a turn with no text: everything it wrote was reasoning. The runtime
then sends no `turn/say`, the typing indicator stops and the status message goes, and the owner
waits for a reply that never comes.

The Bot API has no idempotency key: a message that may have reached Telegram must never be sent a
second time.

## Decision

It amends decision 0371's failure rule.

- **Sent again while it never left.** Each message of the answer, and its plain text after a
  parse refusal, is tried up to 3 times in all, after 400 ms and then 800 ms, only while the
  failure proves that no connection to Telegram opened. Any other failure stops at once, as
  before; the throttler keeps owning every 429 wait.
- **A turn with nothing to say.** A turn that ends in the owner's chat with no answer, no status
  line, no question and no launch draft gets one message, `telegram.chat.noAnswer`: "No response
  generated. Please try again.", in the owner's language, after the agent's name while the owner
  has several agents. The console and terminal chat show nothing new.

## Consequences

- A blip of the owner's network no longer costs an answer; at worst it adds about 1.2 seconds
  before the answer and the chat's pace.
- The owner always hears back from a turn the chat started.
- `ChatReplies` notes the question and launch draft pushes of a running turn, which other parts
  of the bot draw, so they count as its reply.

## Alternatives

- **Retry every network fault.** A fault after the request left may follow a message Telegram
  showed; a second try would post it twice.
- **Send the empty-answer line from the runtime as a status line.** Every surface would show it,
  and the console and terminal chat already show that the turn ended.
- **Jittered waits.** The bot sends to one chat; the throttler already spaces each call, so a
  random spread adds nothing a test could check.
