# 0197. An order re-arms after a fill, holds its level and judges prices in block order

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

A second review of the order fills and price triggers of
[decision 0195](0195-an-order-fills-inside-its-bounds-on-paper-and-says-why-it-skips.md) and
[decision 0196](0196-a-price-trigger-fires-on-its-level-at-each-confirmed-price.md) found:

- a trailing stop, which had no fill limit, fired again at every block after its first fill, as did
  any order with fills left, so a 25% trailing sale sold most of the position in a few blocks;
- a limit or take-profit order on a deep pool had no price bound at a fill that ran late, so it
  could buy above its limit or sell below its target;
- the prices of a catch-up burst judged a trailing stop side by side and lost its highest price;
- the skip pacing could hold a stop-loss off for 5 minutes; a sale sized in dollars was counted at
  the trigger's price, not the fill's; live orders were confirmed but could never fill; a fill that
  threw or hung was silent; a paper fill could commit without its order's own move at the expiry;
  a crash could lose a skip's row and notice, or strand a confirmed paper fill; a balance read
  that answered nothing counted as zero and ended a stop-loss.

## Decision

- **One fill, then re-arm.** A trailing stop fills once unless its order names more fills, as a
  limit, take-profit or stop-loss order does. An order with a fill left after a fill waits until its
  condition stops holding at a confirmed price before it may fire again, and a trailing stop's
  highest price starts again from the prices after the fill. An exit order whose fill empties its
  position ends with `position_closed` in that fill's write. An exit order that fires on an empty
  position ends only when its position held the token after the order was made, so a sale outside
  the exit orders emptied it; otherwise it waits, skipped as `nothing_to_sell`.
- **A limit holds its level.** A limit or take-profit fill holds its order's level at its own
  quote's expected price, whatever the pool's depth, and `order/create` sets a limit or take-profit
  order's worst price to its trigger price when the request names none, so the card shows it and
  its terms hash binds it. A stop-loss or a trailing stop, whose purpose is to sell, checks its
  level at the quote only after a thin pool's price.
- **Block order.** One token's prices are judged one at a time, in the order the watcher read them.
  A write of what a trigger keeps that loses its race reads the order again and keeps the higher
  price. The fills a price starts run on their own.
- **Pacing.** An exit order, a stop-loss, take-profit, trailing stop or limit sale, tries again at
  the next confirmed price after a skip. A buy waits 15 seconds, the wait doubling with each skip
  in a row up to 5 minutes. The waits and the owner's notices are read from the order's own fill
  rows, so a restart keeps them; the owner hears each reason once in a row, and `engine_locked` and
  `live_fills_off` once per agent until one of its orders fills or the engine starts again.
- **Dollar sales at the fill.** A sale sized in dollars is sized at its trigger's price, then again
  at its own quote's price when the quote values it above its size, and quoted once more. The fill
  check holds the sale's value at its quote to its size.
- **No live price order yet.** While live fills are off, `order/create` refuses a live limit,
  take-profit, stop-loss or trailing order with `order.live_fills_off`. Paper orders are unchanged.
- **Faults and a deadline.** A fill has 30 seconds. One that throws or runs past them is a skip,
  `fill_failed`, paced as any skip, and an intent it left unfinished is cancelled unsigned. The
  other side's USD price is read before the fill enters its agent's line of confirmations.
- **One write.** A paper fill commits only with its order's own `fill_recorded` move, one fill more
  than the order had; the store refuses any other fill write.
- **Crashes.** A skip's row and its notice are written in the transaction that ends its intent,
  and a fill's row carries the notices of its fill. Notices are announced after the commit, and at
  the start for any row not yet announced. A fill intent a stop left unfinished is cancelled at the
  start.
- **No balance is no data.** A balance read that answers nothing for an asset is
  `balance_unread`, a skip or a failed check, never zero.

## Consequences

- An order with several fills fills once per move of the price into its condition.
- A stop-loss retries at every block while it cannot fill; it costs a quote a block, not a wait.
- Spec 6 gains the check reason `balance_unread`, the skip reason `fill_failed` and the rule that
  a paper fill writes its order's move; spec 1 gains `order.live_fills_off`; `order_fills` gains
  the notices of each row and when they were announced.
- Before live fills turn on, the crash suite on fills must pass and these must hold: the order's
  move and row written in the executor's reconcile transaction; the fill's line held until the
  intent settles; a lapse for a confirmed live fill; no live intent cancelled by the fill runner;
  signing terms for a fill in the wallet queue.

## Alternatives

- **Unlimited trailing fills, paced by time.** A time wait after a fill sells again whenever the
  price stays low past it. Rejected for the re-arm.
- **A worst price only when the owner names one.** A late fill could trade far past the order's
  level. Rejected.
- **Drop all but the newest of a burst of prices.** A trailing stop would lose highs inside the
  burst. Rejected for judging every price in order.
- **Pace every skip alike.** A stop-loss could wait 5 minutes through a crash. Rejected.
