# 0246. A DCA order buys once per period, and never buys a missed one

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 1](../specs/protocol.md) section 8.2 gives a `dca` order the trigger
`{ cron, timezone?, count? }`, and
[decision 0189](0189-an-auto-order-starts-on-its-card-s-tap-and-pauses-while-its-agent-is-frozen.md)
refused it with `order.kind_unavailable` until something runs its periods. Every order fill runs
the money path with `authorizedBy: { order }` and no card
([spec 6](../specs/intent-states.md) section 5). Schedules already run on a queue every 10
seconds while the engine is unlocked, and a missed schedule runs once
([decision 0232](0232-a-missed-schedule-runs-once-and-a-run-that-cannot-wake-the-agent-is-skipped.md)).
The specs leave open:

- **Which side** a DCA order trades, and **what `count` counts:** buys or periods.
- **Which zone** a period without `timezone` runs in once the owner changes theirs.
- **A period that comes while the order cannot buy:** the engine off or locked, its agent frozen.
- **How late** a period may still buy, and what a stop between keeping a period and its buy does.

## Decision

- **Buys only.** A DCA order buys its token with what it spends, sized as any buy
  ([decision 0190](0190-a-buy-order-spends-a-named-asset-by-amount-or-by-share.md)); a DCA sale is
  `protocol.bad_args`.
- **The period is fixed at the tap.** Five cron fields as a schedule's
  ([decision 0231](0231-a-schedule-runs-on-five-cron-fields-on-the-owner-s-wall-clock.md)), on the
  wall clock of `timezone`, which `order/create` fills with `owner.timezone` when the request names
  none, so the card shows it and its terms hash binds it. A later change of `owner.timezone` moves
  no DCA order. An expression or zone binference cannot read, or with no run in eight years, is
  `schedule.bad_when`.
- **`count` counts buys.** It is the order's `maxFills`; a request naming both must agree. Without
  one, the order buys every period until it expires, 30 days by default.
- **Each period buys once.** The schedule queue's timer runs the active DCA orders after the
  schedules. A new order's first period is the first run after it became active. When a period
  comes, its next one is kept in the order's trigger state first, then the period's buy runs
  through the order fills: no card, held to the order's bounds, the per-trade and rolling caps, in
  the order's mode. A stop between the two loses that period's buy and never buys it twice. A fill
  keeps the next period; a DCA order waits after a skip only once its fills failed on chain, as an
  exit order does, since its period paces it.
- **A missed period is never bought.** A period that comes more than 60 seconds before the queue
  runs it, while the engine was off or locked or the agent frozen, is skipped: one `order_fills`
  row with the new reason `missed` for each catch-up, told as `notice.skipped`, and the next period
  runs on time. A schedule's missed run happens once because its turn is a look at the present,
  and the agent sees it was late. A buy at another time than the period the owner confirmed would
  trade at a price the plan never meant to, and buying every missed period at once would spend
  several periods' money in one moment.
- **Live waits.** While live fills are off, `order/create` refuses a live DCA order with
  `order.live_fills_off`, as a live price order; one stored before skips with `live_fills_off`.
- **The card.** `card.order.summary.dca` with `card.order.schedule`, "on the schedule {cron}
  ({zone})", and the count of buys.

## Consequences

- `order/create` refuses only copy orders with `order.kind_unavailable`.
- Spec 1 sections 7.5 and 8.2, spec 4 section 3.8 and spec 6 sections 4 and 5 say so.
- A DCA order's buys show as fills of the order in `/orders` and `order/get`, its missed periods
  as skips.

## Alternatives

- **Buy each missed period on return.** Rejected: many periods'
  spend at one price and one time, beyond what the card showed.
- **Buy one missed period once,** as a schedule runs. Rejected: a buy at a time the owner did not
  confirm.
- **Follow `owner.timezone` as schedules do.** Rejected: the confirmed terms would change after
  the tap.
- **Count periods, skipped ones too.** Rejected: an order the engine missed would end with fewer
  buys than the card promised, and the card could not say how many.
