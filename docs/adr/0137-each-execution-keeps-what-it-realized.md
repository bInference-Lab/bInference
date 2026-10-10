# 0137. Each execution keeps what it realized

Status: Accepted

## Context

[Decision 0058](../DECISIONS.md#d0058) keeps P&L at average cost, and each position row holds the
profit or loss realized so far. `portfolio/pnl` answers an agent's P&L over a range of time, but a
position's running total says nothing about when its gains came: a sale last month and one today
add up in the same column. Working the range out again would mean replaying every execution of the
wallet from its first, in order, with the arrivals and departures between them.

The protocol's `PnlView` had one set of positions and totals, with no word on paper and live,
which `portfolio/get` keeps apart.

## Decision

- Each execution stores the profit or loss it realized when it was recorded
  (`executions.realized_usd_micros`, migration 0017): what its position changes add to the realized
  P&L of the positions they move, below zero for a loss. That is the sold asset's gain or loss and
  the gas coin's, when the gas came out of a position with a known cost. The engine works it out
  from the rows it read and the writes it stores in the same step.
- `portfolio/pnl` sums the realized P&L of the agent's executions recorded from `from` up to and
  including `to`, each counted for the asset it sold. The unrealized P&L is that of what the
  positions hold now at today's price, whatever the range. Every wallet the agent had counts,
  archived ones too.
- Live and paper stay apart: `positions`, `realizedUsdMicros` and `unrealizedUsdMicros` are live,
  as `totalUsdMicros` is in `portfolio/get`; `paperPositions`, `paperRealizedUsdMicros` and
  `paperUnrealizedUsdMicros` are paper. The paper fields are optional additions inside protocol v1.
  An asset with no price has no unrealized P&L, and its mode's total has none either.
- Backfill: executions recorded before migration 0017 count 0. The executions table was first
  written in the same unreleased line of work (migration 0015), so no released install holds a row
  whose gain the default would hide.

## Consequences

- A range's realized P&L is one indexed read of the executions, with no replay.
- The gain or loss of the gas coin counts with the asset the execution sold, so an asset's line
  can hold a few cents of the coin's.
- Arrivals, departures and paper resets realize nothing, as before, so they have no part in it.

## Alternatives

- **Replay the executions of the range at read time.** Needs every earlier row to know each
  position at the range's start, and its answer could drift from the positions the engine stored.
  Rejected.
- **A table of realized P&L per execution and asset.** Exact for the gas coin's share, at the cost
  of a second table for a few cents. Rejected for now.
- **Count paper and live together.** Mixes money that exists with money that does not. Rejected,
  as for `portfolio/get`.
