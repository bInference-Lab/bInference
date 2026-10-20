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

- **Every watched price carries when its read was asked.** The watcher stamps the time before it
  sends a block's read, so a read in flight across a pause keeps the time before the pause. The
  price triggers drop, unjudged, a price read before the latest resume
  ([decision 0266](../DECISIONS.md#d0266)).
- **The fence goes up the moment a pause is found.** Each resume counts, and its instant is kept,
  before anything awaits: the next question whether a price or a fill is stale finds it. A wall
  clock set back makes the latest resume's instant the new, earlier time, so prices read after the
  step pass and only those before it are fenced off.
- **A fill carries the resume count its trigger fired under.** A fill whose count is behind ends
  `failed_check` with the fill reason `price_stale` at its check in the agent's line, before its
  confirmation; the order stays active and fires again on a fresh price. A DCA buy carries no
  price and is judged by its period as before.
- **The hand-off drops what a pause left.** A price whose read was answered more than a minute
  after it was asked, or before it by the wall clock, spanned a pause and is dropped. After a
  pause, the hand-off asks each chain's head anew and drops every price of the chain until that
  head answers, then every price of a block below it, so a head or a read answered before the
  pause never reaches the triggers. Nothing is sized from the wall clock: a long sleep or a clock
  step fences off at most the time one head read takes.

## Consequences

- `WatchedPrice` has `askedAtMs`; `WatchedOrderPrice` has `readAtMs`, that time; `FillPrice` has
  `resumes`, the count its trigger fired under.
- `price_stale` joins the fill reasons of [spec 6](../specs/intent-states.md) section 5, with a
  message in English and Chinese.
- The composition root reads a chain's head through the chain's RPCs after each pause, within 5
  seconds a try, again every 2 seconds until one answers.
- A property test drives orders, prices read before and after pauses, fills still running at a
  pause and venue prices, and shows that no fill commits after a pause on a price read before it,
  nor passes an order's worst price.

## Alternatives

- **Restart the price watchers at each pause.** It would drop the reads under way, but it reaches
  into every chain's watcher. Rejected for the fence, which works on the prices the hand-off
  already sees.
- **Size the block fence from the pause's length.** A long sleep or a clock stepped forward would
  fence off a chain for hours. Rejected.
- **Compare each block's chain time with the wall clock.** A machine's clock can be off by
  seconds, and the watchers read no block time today. Rejected.
