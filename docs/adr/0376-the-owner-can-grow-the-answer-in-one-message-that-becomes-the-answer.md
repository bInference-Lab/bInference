# 0376. The owner can grow the answer in one message that becomes the answer

Status: Accepted

Accepted by the tech lead on 2026-11-05, on the owner's decision.

## Context

[Decision 0375](0375-the-status-message-shows-only-once-work-starts-with-a-fixed-label.md) keeps the
default reply quiet: the typing indicator, a status message once the agent works, and the answer
whole as a new message. The owner also wants to watch an answer as the agent writes it, as a
choice. [Decision 0371](0371-a-running-turn-streams-its-text-and-tool-lines-to-one-status-message.md)
rejected editing a message into the answer because an edit does not notify, and a trade report
must. Cards, receipts and notices are their own messages and notify whatever the chat text does.

## Decision

It amends decision 0371.

- **A setting.** `telegram.replies.stream` in config.json5, `"progress"` (the default, decision 0375) or `"partial"`. Each turn reads it as it starts, so a change applies from the next turn.
  Config version 15 adds it, at its default.
- **The partial mode.** The answer the agent writes grows in one message: first sent once it holds
  30 characters, so a notification carries more than a word, then edited at most once a second,
  showing the first 4,000 characters. While a tool runs and no text is being written, the same
  message shows the fixed label, or the text written before the tool, as the status message does.
- **The end.** The message is edited into the answer's first message in place, and any further
  messages of a long answer go as new messages. An edit that changes nothing counts as done; HTML
  Telegram cannot read goes as plain text. When the edit fails, the whole answer goes as new
  messages and the preview is deleted once it has shown for 4 seconds. An answer that never
  reached 30 characters goes as a new message.
- **The rest stands:** previews the throttler drops, the failure rules, the typing indicator, and
  the line that says when an answer did not arrive.

## Consequences

- In the partial mode a short answer does not notify the owner; its card, receipt or notice still
  does, as its own message.
- One message per turn shows both the agent's work and its answer.

## Alternatives

- **A switch kept per chat session, apart from config.json5.** Every other reply rule lives in
  config.json5 with a live reload; a second store of the same choice would drift from it.
- **Delete the preview and send the answer anew.** It doubles the messages for a long answer and
  makes the partial mode a slower progress mode.
