# 0268. No fill runs on a price read before the latest resume

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

A price order fires on a confirmed price of its token and hands its fill that price
([decision 0196](../DECISIONS.md#d0196)). A restart starts with empty memory, so every price after
it is read after it. A sleep of the machine does not: a block read or a head the node answered
right before the sleep reaches the engine after it, and a fill that started before the sleep goes
on after it. A stop-loss could then sell on a price the market left behind. The specs say nothing
of the age of a trigger's price.

## Decision

- **Every watched price carries when the watcher read it.** The price triggers drop, unjudged, a
  price read before the latest resume ([decision 0266](../DECISIONS.md#d0266)).
- **A fill under way at a resume ends at its check.** A fill whose price was read before a resume
  that came while it ran ends `failed_check` with the fill reason `price_stale` at its check in
  the agent's line, before its confirmation; the order stays active and fires again on a fresh
  price. A DCA buy carries no price and is judged by its period as before.
- **The hand-off fences off a sleep's leftovers.** After a sleep, the composition root drops each
  price of a block not past the newest block it handed on before the sleep by half the blocks the
  sleep lasted, so a read or a new head answered before the sleep never reaches the triggers. A
  chain that made no blocks meanwhile fires nothing until it does.

## Consequences

- `WatchedOrderPrice` has `readAtMs`, the watcher's read time; `FillPrice` has it for a price
  order's fill.
- `price_stale` joins the fill reasons of [spec 6](../specs/intent-states.md) section 5, with a
  message in English and Chinese.
- A property test drives orders, prices read before and after a resume, and venue prices, and
  shows that no fill uses a price read before the resume, nor passes an order's worst price.

## Alternatives

- **Restart the price watchers at each sleep.** It would drop the reads under way, but it reaches
  into every chain's watcher. Rejected for the fence, which works on the blocks the hand-off
  already sees.
- **Compare each block's chain time with the wall clock.** A laptop's clock can be off by seconds,
  and the watchers read no block time today. Rejected.
