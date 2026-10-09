# 0125. One rescue runs at a time

Status: Accepted

## Context

`safety/rescue` plans a rescue from the balances it reads. An owner who taps `/rescue` twice, or
asks again while a rescue runs, would get a second plan of the same funds: its sends would fail
once the first moved them, after costing a card and a tap. The owner decided on 2026-10-10.

## Decision

While a rescue has not reached a terminal state, `safety/rescue` answers that rescue's intent and
plans nothing. Calls wait their turn, so two calls at once never both plan. Once a rescue ends, the
next call plans a new one from what is left.

## Consequences

- A second call is safe from any surface and shows the rescue that runs.
- A rescue that stays open, such as one handed over at a stuck step, blocks a new one until it
  ends.

## Alternatives

- **Plan a new rescue each time.** Two cards for the same funds. Rejected.
- **Refuse a second call with an error.** The owner would not see the rescue that runs. Rejected.
