# 0195. An order fills inside its bounds, on paper, and says why it skips

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

An auto order is confirmed once, on its card ([decision 0189](0189-an-auto-order-starts-on-its-card-s-tap-and-pauses-while-its-agent-is-frozen.md)).
Each fill then moves money with no tap. [Spec 6](../specs/intent-states.md) section 5 says a fill
starts with `authorizedBy: { order }`, runs policy and risk again, is skipped and reported when it
fails, and leaves its order active unless the order's own rules end it. The spec leaves open:

- what holds a fill to its order once its quote is known, and where a fill that breaks a bound
  ends: the table has no row out of `simulated` for a fill that fails its check, so such an intent
  would wait in `simulated` for good;
- which mode a fill runs in once its agent switched mode, and whether a fill of an order made in a
  turn with the outside-content mark may run;
- what a locked engine does with a fill, and how often an order whose trigger keeps holding tries
  again after a skip;
- how one agent's fills meet the rolling 24-hour cap, which taps and the auto mode meet one at a
  time ([decision 0136](0136-the-24-hour-cap-counts-each-confirmation-at-its-judged-value.md));
- what moves live funds before the crash suite proves that a stop cannot send a fill twice.

## Decision

- **The fill check.** At `simulated`, a fill reads its order again and holds the chosen quote to
  it. The first bound it breaks ends the intent `failed_check`, by a new row of the table, with
  that bound as its reason: `order_inactive` (the order is not active, has expired or used its
  last fill), `fill_bounds` (it spends nothing, more than its size allows, or asks more slippage
  than the order's maximum), `worst_price` (its price at its minimum out, in micro-dollars per
  whole token, is worse than the order's worst price, or nothing values the other side), and
  `trigger_unconfirmed` (a pool under $25,000 deep fired it, and the quote's own expected price
  does not meet the trigger). It runs in the agent's line of confirmations, as a tap does, and a
  fill whose room under the rolling cap went to another confirmation since its policy step ends
  `failed_check` with `daily_cap`.
- **Sizes.** A buy spends `{ base }` as given, `{ percentBps }` of its spendable balance or
  `{ usdMicros }` at its spending asset's USD price at the fill, rounded down
  ([decision 0190](0190-a-buy-order-spends-a-named-asset-by-amount-or-by-share.md)). A sale sells
  `{ base }`, `{ percentBps }` of what the wallet holds or `{ usdMicros }` at the trigger's price,
  never more than the wallet holds. A buy whose size comes to nothing skips with
  `nothing_to_spend`; a size in dollars whose asset has no USD price skips with `no_price`.
- **Mode.** A fill runs in its order's mode, the agent's mode when the order was made, whatever
  the agent's mode is now.
- **Paper only until the crash suite passes.** A live order's fill is skipped with
  `live_fills_off` before any intent is stored. The engine's switch for live fills is off, no
  config key sets it, and the wallet queue authorizes no fill until the crash suite on fills
  passes.
- **Locked and frozen.** A locked engine fills nothing, paper or live: the fill is skipped with
  `engine_locked`, the owner is told, and the order stays active. A freeze pauses the agent's
  orders; a fill under way is cancelled with every unsigned intent, or refused by policy as
  `frozen` and reported.
- **Outside content.** A fill keeps its order's outside-content mark, and runs all the same: the
  owner confirmed the order's card, which shows the mark, so its fills carry the owner's
  confirmation. A fill sells no token on the deny list: the policy refuses it as `token_denied`,
  since such a sale always needs a card. Invariant 8 extends to fills.
- **One at a time.** One agent's fills run one at a time, oldest trigger first, and an order has at
  most one fill under way, so one position's exit fills never run at once.
- **Pacing.** After a skip, an order's trigger may fill again 15 seconds later, the wait doubling
  with each skip in a row up to 5 minutes; a fill ends the wait. Each skip is an `order_fills` row;
  the owner hears a skip with `notice.skipped` once per reason in a row.
- **One write for a fill.** A paper fill moves its intent to `paper_filled`, records the fill on
  its order, adds its `order_fills` row and ends the other exit orders of a position it emptied,
  in one transaction. `notice.fill` follows, and `notice.ordersEnded` for the ended orders.

## Consequences

- Spec 6 gains the row `simulated` to `failed_check` for a fill, four fill reasons, the skip
  reasons `engine_locked`, `live_fills_off` and `nothing_to_spend`, and invariant 8 for fills.
- A live order is confirmed and stays active, but fills nothing until the crash suite on fills
  passes; when its trigger holds, the owner hears why.
- An order whose trigger keeps holding while it cannot fill costs at most one quote every 5
  minutes, and one notice per reason.
- A fill and its order cannot disagree after a crash: both move in one write.

## Alternatives

- **Cancel a fill that breaks a bound.** `cancelled` means withdrawn before signing by a request,
  a freeze or a stop; a broken bound is a failed check, which the owner's report names.
- **Let a locked engine fill on paper, as the auto mode may.** A locked engine is one the owner
  has not started fully; filling there would move a portfolio the owner cannot watch from a
  started engine. Rejected for the owner's rule that a locked engine fills nothing.
- **Try again at every block after a skip.** A trigger that keeps holding would quote every 0.45
  s and repeat the same notice. Rejected.
- **Turn live fills on now.** A stop between signing and storing a fill could send it twice before
  the crash suite proves otherwise. Rejected until then.
