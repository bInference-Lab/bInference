# 0173. A stopped turn says its card is open, and a proposal wins over a question

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Decision 0172](../DECISIONS.md#d0172) has a committed turn's status line follow the engine's
answer, and lets a stop that lands after a proposal was sent end the turn `stopped`. Two cases of
the turn loop of [spec 8](../specs/runtime.md) are still open:

- **A stop after a proposal.** A turn whose proposal the engine took, then stopped by the owner, a
  freeze, a clear or the runtime's own stop, ends `stopped` with `turn.stopped`: "Stopped. Anything
  you already confirmed still goes through." The proposal's card is still open, and the line does
  not say so, so the owner can read the stop as the end of the proposal too.
- **`ask_owner` beside a proposal.** One response may call a propose tool and `ask_owner`. The
  proposal's card asks the owner already; a question beside it asks a second time, about something
  the card may decide, and the owner's two answers can disagree. Section 6.4 ends the turn after
  `ask_owner`, and section 6.1 ends it after a proposal, but neither says which one runs.

## Decision

- **A stopped turn that committed says its card is still open.** When a stop halts a turn whose
  proposal the engine took, the turn ends `stopped` with the status line `turn.stoppedCardOpen` in
  place of `turn.stopped`. A stopped turn with no proposal, or whose proposal the engine refused,
  keeps `turn.stopped`. Stopping never cancels the proposal; the owner answers it on its card.
- **A proposal wins over `ask_owner` in one turn.** In a batch with a propose call that passed its
  check, every `ask_owner` call, before or after that call, does not run and gets the result "not
  run: the card already asks the owner". A committed turn makes no model call after its batch, so
  no `ask_owner` can follow its proposal in a later batch.

## Consequences

- The owner always reads that a card waits when one does, whether the turn ended on its own or
  was stopped.
- A turn asks the owner one thing at a time: a card or a question, never both.
- Spec 4 gains the line `turn.stoppedCardOpen` in English and Chinese. Spec 8 sections 4.4 and 6.4
  say both rules.
- A tool declares that it asks the owner, as it declares its kind, so the loop finds `ask_owner` in
  a batch without reading tool names.

## Alternatives

- **Keep `turn.stopped` after a proposal.** It is true, but the owner can take the stop for a
  cancel and leave the card unanswered until it expires. Rejected.
- **Let the question win and hold the proposal back.** The model meant both; dropping the card
  loses what the agent prepared, and the proposal is the one the owner can act on. Rejected.
- **Run both.** Two asks in one turn, with answers that can conflict. Rejected.
