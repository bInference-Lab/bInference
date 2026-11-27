# 0458. A settle message carries the receipt line the owner reads

Status: Accepted

Accepted by the lead on 2026-11-27.

Amends [decision 0381](0381-the-owner-never-reads-what-a-tool-showed-twice.md): what a surface
showed the owner of a settled intent counts as shown, as what a tool showed does.

## Context

After a live trade settled, Telegram edited the card into its receipt, then the agent's settle turn
said the trade again in its own words: it named the intent's state ("reconciled and filled") and
rounded the amount it read from the intent view differently from the receipt (0.00999746 BNB
against the receipt's 0.00999745 BNB). The owner read the same trade twice, with two numbers.

The settle message the runtime reads names only the intent, its kind and its state (decision 0174).
Decision 0381 keeps the answer from repeating what a tool showed in the same turn, but a receipt is
no tool's: the engine draws it, and the turn that reads the settle message never sees its text.

## Decision

- **The settle message carries the receipt line.** `inbox/intentSettled` gains an optional
  `shownReceipt`: the line the intent's closed card ends with, drawn as the owner's surfaces draw
  it, with `owner.locale` and `owner.timezone` as they are when the message is pushed or listed.
  Its intent view carries the same line as `receipt`. A settle message of an intent whose card the
  engine draws no receipt for, such as one auto mode ran, has none.
- **The runtime counts it as shown.** The turn the message starts counts `shownReceipt` among the
  texts the owner was shown, so its drafts and final text leave out a paragraph that repeats it, by
  the rule of decision 0381.
- **The model is told.** The settle message names the receipt the owner already reads and asks the
  model not to restate it, its amounts or the intent's state. The agent's fixed instructions say the
  same for every settled proposal.

## Consequences

- The owner reads one amount for a trade, the receipt's, exact to its base unit, and no state name
  meant for binference's own records.
- The field is optional, so an older runtime reads the message as before.
- A settle message reads the intent's card once more when it is pushed or listed.
- A model that rephrases the receipt, with no paragraph close enough to it, is not caught by the
  check; the instructions cover that case.
- An intent auto mode ran has no card and so no receipt line; its notice is the owner's record, and
  the instructions still ask the model not to restate a settled trade.

## Alternatives

- **Draw the receipt in the runtime from the intent view.** The runtime has no messages of the
  owner's surfaces and would need the whole text catalog; one drawing in the engine keeps the two
  texts the same.
- **Drop the settle turn's answer.** The agent may have a next step to propose or a fact the
  receipt lacks.
- **Only tell the model.** A model that ignores the instruction still repeats the receipt, and the
  owner reads it twice.
