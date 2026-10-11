# 0150. A paper fill keeps its price, and the start records its missing positions

Status: Accepted

Accepted by the owner on 2026-10-11.

## Context

A paper fill makes two writes: the move to `paper_filled`, with the fill in its event and its
ledger entry, then the execution and its position changes. A crash between them leaves a terminal
intent with no execution: the paper portfolio still holds what the fill sold, and lacks what it
bought.

The two writes go through two ports, `IntentStore` and `PositionStore`, each with its own contract
suite, fake and SQLite tasks, and each SQLite task is one transaction. One write for both would
need a port that changes intents and positions together, which breaks the one owner each piece of
state has. The execution is valued at the sold asset's price at the fill, which the fill did not
keep, and a fill is never valued at a later price.

## Decision

- A paper fill keeps the sold asset's price in its fill record (`soldPrice`), in the event and the
  ledger entry of `paper_filled`. No table changes: the fill is JSON in both.
- At every start, after the recovery of live intents and before the engine takes work, the engine
  lists the paper intents that moved to `paper_filled` in the last 30 days and the paper executions
  of the same days, and records the execution of each fill that has none, from its own amounts,
  time and price.
- A fill recorded before fills kept their price stays without an execution.

## Consequences

- A crash between the two writes costs the positions until the next start, never for good, while
  the start comes within 30 days.
- The repair adds two paged reads at each start. Paper fills are few, and the intents index on
  state and change time serves the intent read.
- A repaired execution lands after any fill recorded since the crash, so the average cost of a
  later sale may differ from the one an uninterrupted run gives.
- ARCHITECTURE section 24's startup order names the repair.

## Alternatives

- **One write through a new port.** It joins two owners' state in one call, and both fakes and
  the SQLite adapter would need it. Rejected.
- **Write the positions first.** A crash then leaves positions for an intent still `confirmed`,
  which the executor's resume fills again. Rejected.
- **Repair from today's price.** A fill is never valued at a price other than its own. Rejected.
- **No window.** Each start would read every paper fill ever made. Rejected.
