# 0381. The owner never reads what a tool showed twice

Status: Accepted

Accepted by the owner on 2026-11-07.

## Context

Asked for a deposit address, the agent's `deposit_address` tool sent the QR code with the address,
the network and the paper warning, and then the agent's answer said the address and the warning
again. In the partial reply mode the answer was also edited into the turn's message, which Telegram
had sent before the photo, so the answer showed above the photo it pointed to. The same repeats can
follow a question, a launch draft or a card, since a model tends to restate what it did a moment before.

## Decision

- **A tool names what it showed.** A tool that shows the owner something in the chat (an address
  and its QR code, a question and its choices, a launch draft) names those texts in its outcome.
  The turn keeps them, at most 200.
- **The answer does not repeat it.** The turn's drafts and its final text leave out each paragraph
  that repeats a shown text: both lowercase, without pictographs or Markdown marks and with runs of
  space as one, one holds the other and the shorter is at least half of the longer; a text under 10
  characters never counts. A final text that only repeats is not said. A paragraph that only
  mentions a shown text in passing stays.
- **The model is told.** Such a tool's result says what the owner now sees and asks the model not
  to repeat it, and the agent's fixed instructions say the same for every tool and card.
- **Nothing shows out of order.** A surface shows a turn's pushes one at a time, in order. What a
  tool shows mid-turn closes the turn's open message first, so what the turn writes after it
  starts a new message below it.

## Consequences

- The owner reads each thing once, in the order it happened, in either reply mode.
- A model that rephrases instead of repeating is not caught by the check; the instructions cover
  that case.
- The transcript keeps the model's whole text; only what the owner reads leaves the repeats out.

## Alternatives

- **Drop the whole answer after any tool that shows something.** The owner may have asked more
  than the tool answers.
- **Compare whole messages only.** An answer that adds one line to a repeated address would keep
  the repeat.
