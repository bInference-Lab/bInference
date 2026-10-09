# 0127. A send out of a wallet leaves its positions at average cost

Status: Accepted

## Context

[Decision 0058](../DECISIONS.md#d0058) keeps P&L at average cost, with fees and gas in the cost.
A trade moves its positions through an execution, and funds that arrive without a trade open a
position as an arrival (database spec, section 2.3). Nothing took funds out of a position without
a trade: after a rescue or any send to an outside address, the positions still held the units that
left, at their cost, and the portfolio counted them as held. A send sells nothing, so it has no
proceeds to realize a gain or a loss against. The owner decided on 2026-10-10.

## Decision

A send out of a wallet, a rescue's transfers and any other transfer to an address outside the
agent's wallets, is a departure. Once its transaction is final, the units sent leave their asset's
position at average cost, and the native coin the send paid for gas leaves the coin's position the
same way:

- The cost that leaves is the position's cost times the share of units sent, rounded down, so the
  units left never look cheaper than they were; the last unit takes all the cost left.
- Nothing is realized: a departure is no gain and no loss.
- Units beyond what a position holds take no cost, as a sale of them counts none.

Each intent's departures are stored once, with their position changes, in one transaction.

## Consequences

- `PositionStore.recordDepartures` stores an intent's departures with their live position writes
  under the row versions read; a second write for the intent stores nothing and answers the first.
  The database spec gains a `departures` table.
- A rescue reconciles only once its departures are stored: a write a racing change beat waits a
  block and tries again, and recovery reconciles a rescue left `finalized`.
- The gas of a send whose transaction moved nothing, one that reverted or a cancel that took its
  nonce, stays in the position, as a failed trade's does.
- The send intent's executor, when it is built, records its departures the same way.

## Alternatives

- **Realize the sent units at their value now.** A send to the owner's own address would book a
  gain or a loss that never happened, and it would need a price at every send. Rejected.
- **Leave the positions as they are.** The portfolio would show funds that left. Rejected.
- **Count the gas as a realized loss.** It needs the coin's price at the send, and a rescue would
  then fail to reconcile without a price. Rejected for v1.
