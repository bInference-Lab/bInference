# 0167. One turn sends at most one proposal

Status: Accepted

Accepted by the owner on 2026-10-10.

## Context

A propose tool sends an intent or an auto order to the engine and returns at once with its id and
the words "waiting for the owner's confirmation"; it never waits for the tap. The turn becomes a
committed turn when the tool's body starts, and it ends after that tool batch: no retry, no model
fallback, no later model call ([ARCHITECTURE.md section 4](../ARCHITECTURE.md#section-4),
[spec 8, section 6](../specs/runtime.md#section-6)). When the intent settles, the engine sends the
runtime a settle message, which starts a new turn.

Both model wire formats let one model response carry several tool calls. Propose tools run in
order, and they return before the owner answers, so a second propose call in the same response
would still reach the engine before the turn ends.

The engine treats each proposal on its own: its own intent and card, its own expiry (60 seconds for
trades), its own auto test ([spec 6, section 5](../specs/intent-states.md#section-5)). It accepts
any number of proposals from any client, and MCP clients may propose in parallel. So the question
is a rule of the agent runtime's loop, not of the engine.

The cases are independent actions ("buy 0.05 BNB each of A, B and C"), dependent ones ("buy X, then
set a take-profit and a stop-loss", "sell A and buy B with it"), a confused or injected model that
emits many proposals, and brackets (a take-profit and a stop-loss on one position).

## Decision

- **One proposal per turn.** In the response that commits a turn, the first propose call runs.
  Every later propose call in that response does not run: its result tells the model that one
  proposal goes at a time and that it may propose again after the owner answers this one. Read and
  control calls in the response run as usual.
- The owner sees one status line in both languages: the agent has more to propose and will after
  this card. Spec 4 gains it.
- The next proposal comes in the turn that the settle message starts, from fresh state.
- The rule lives in the runtime's loop, on the `propose` tool kind. The engine does not change: it
  keeps accepting proposals from MCP clients and the owner.
- The runtime counts the proposals it held back in each turn and stores the count with the turn.

## Consequences

- A committed turn holds exactly one intent or order, so recovery, transcript repair and the ledger
  reason about one proposal per turn.
- A dependent action sees the first result before it is proposed: a stop-loss is never set for a
  buy the owner denied.
- One response, injected or confused, opens at most one card, and the owner reads one card at a
  time inside its 60 seconds.
- A request for several independent actions takes one turn per action. In manual mode the owner
  taps each card either way; in auto mode three buys take three short turns. Each extra action
  costs one more model call and a few seconds, which the model budget covers.
- Brackets take two turns until an order kind covers both exits.
- The loop's property test proves that no turn sends two proposals. The evaluation gains two
  scenarios: a three-token buy ends in three cards over three turns, and "buy X and set a
  stop-loss" proposes the stop-loss only after the buy settles.
- The engine's caps count intents that are authorized and not yet settled, so proposals from any
  client never pass a cap together; this holds whatever the runtime does.
- The held-back counts show after the alpha how often a model asks for two or more at once. A later
  decision may raise the limit; raising it breaks nothing, while lowering it again would take away
  behavior owners use.

## Alternatives

- **Up to N proposals per turn** (for example 3), each with its own card, run in order with a merge
  point between them that can skip the rest; calls past N are not run. A dependent action would be
  proposed before the first is answered, and one injected response could open N cards at once.
  Rejected.
- **One card for several proposals:** a new intent kind or card group confirmed with one tap. Specs
  4 and 6 would change, the steps are separate transactions, and a partial result would have to be
  explained on one card. Rejected for now; it may come back for brackets with an order kind that
  covers both exits.
