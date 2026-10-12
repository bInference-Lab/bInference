# 0196. A price trigger fires on its level at each confirmed price

Status: Amended by 0197

Accepted by the owner on 2026-10-12.

## Context

Limit, take-profit, stop-loss and trailing orders fire on their token's price, which the price
watcher reads at every block ([decision 0192](0192-the-price-watcher-reads-every-watched-token-in-one-batch-at-each-block.md))
and confirms before a trigger may use it ([decision 0194](0194-the-price-watcher-proves-its-pools-and-is-never-silent.md)).
Spec 1 says a limit order fills "when the price crosses" its price. Several things are open:

- a watcher more than four blocks behind reads the newest blocks and skips the rest, so a
  crossing between two reads may have no read before it;
- a pool under $25,000 deep can be moved for one block at little cost, and the cross-check runs
  every few minutes, not every block;
- a price whose quote asset's feed is stale has no USD value, and the trigger prices are dollars;
- a trailing stop's highest price must outlive a restart, or the stop falls back to the price at
  the start;
- the fill must start in the block's own processing, not on a timer.

## Decision

- **Levels, not crossings.** A limit order fires at or above its price, or at or below it, as
  its direction says; a take-profit at or above its price; a stop-loss at or below it; a trailing
  stop at or below its distance under the highest price it kept. A price the watcher skipped past
  is judged on the next read. An order whose level already holds when it becomes active fires at
  the next confirmed price, as a marketable limit order does.
- **Each confirmed price, at once.** The engine judges the active price orders on a token as each
  confirmed price of it is read, in exact micro-dollars per whole token, and hands a triggered
  order to its fill in the same processing (decision 0195). The list of active orders is read at
  most once a second, and each order is read again before it fills.
- **The trailing stop's peak is stored.** Its highest confirmed price since it became active is
  written to the order's `trigger_state` as an exact fraction each time it rises, by the order
  state machine's `trigger_kept`, which only an active order takes. A restart reads it back. A
  stored state that does not read starts again from the price then.
- **A thin pool's trigger is confirmed by the fill.** When a pool under $25,000 deep priced the
  token, the fill's own quote, at its expected output, must meet the trigger's level too, or the
  fill ends `failed_check` with `trigger_unconfirmed`.
- **No USD value is no price.** A watched price without one is not confirmed, so it fires nothing
  and counts as a token without a confirmed price, which `notice.watcherUnpriced` reports.
- **Decimals from the chain.** A price per whole token takes the token's decimals as the watcher's
  cross-check reads them on chain; a token whose decimals are not read yet is judged once they
  are.

## Consequences

- Spec 1's "crosses" reads as "is at or beyond"; the order card already says "at or above" and
  "at or below".
- A trailing stop costs one order write per new high, not one per block.
- A stop-loss on a thin pool can be skipped when the fill's quote disagrees with the watcher; the
  owner hears it, and the order stays active for the next price.

## Alternatives

- **Crossings between two consecutive reads.** A skipped block leaves no read before the crossing,
  and a price already past the level when the order starts would never fire. Rejected.
- **Two blocks in a row for a stop-loss on a thin pool.** It costs a block of delay on every such
  stop; the fill's own quote proves the price at no delay. Rejected.
- **The peak in memory only.** A restart would lower a trailing stop to the price at the start.
  Rejected.
