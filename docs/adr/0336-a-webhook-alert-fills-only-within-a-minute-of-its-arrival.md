# 0336. A webhook alert fills only within a minute of its arrival

Status: Accepted

Accepted by the owner on 2026-11-03.

## Context

The webhook listener answers `202` once an alert is in the inbox
([decision 0333](0333-the-webhook-listener-gives-one-404-to-all-but-an-alert-and-a-taken-port-leaves-it-off.md)).
It starts before the unlock and answers while the engine is locked, while the agent is frozen,
and before anything fills alerts. The inbox keeps an alert across a stop, and a start resumes every
entry not yet handled. An alert names a moment: TradingView sends it when its condition holds, and
does not send it again. A fill made hours later trades at a price the alert never saw. A rule's
bounds may name no worst price, so nothing else holds such a fill.

A copy order buys a leader's trade only within 60 seconds of it, and skips a later one as `late`
([decision 0260](0260-a-copy-order-copies-each-leader-trade-once-at-its-own-size-inside-its-caps.md)).
A DCA buy that reaches the head of its agent's line past its minute is `late` as well
([decision 0246](0246-a-dca-order-buys-once-per-period-and-never-buys-a-missed-one.md)).

## Decision

- **One minute.** An accepted alert fills only when its fill starts, at the head of its agent's
  line of fills, less than 60 seconds after the listener received it. A later one is skipped as
  `late`, a buy and a sale alike, and fills nothing. An alert stamped later than the time the
  engine reads now, as after the clock was set back, is `late` too, as a cached risk report
  stamped in the future is never fresh: a clock set back never stretches the minute.
- **Judged once.** Each accepted alert is judged once, when its fill starts, and is never tried
  again. An alert taken while the engine is locked skips as `engine_locked`: the listener stamps
  the lock on the alert's row as it arrives, so an alert taken in the last second before an unlock
  skips, and a fill that finds the engine locked when it starts skips the same way. One whose
  agent is frozen skips as `frozen`. An alert the engine finds after a stop or a locked night is
  `late`.
- **Told once per reason in a row.** A skip is told as an auto order's is
  ([decision 0197](0197-an-order-re-arms-after-a-fill-holds-its-level-and-judges-prices-in-block-order.md)):
  the first `late` of a rule after a fill or another reason is told, the ones after it are
  recorded only. A start that finds a hundred waiting alerts sends one notice per rule.

## Consequences

- A stop, a lock or a crash never turns old alerts into fills at a later price.
- An owner who unlocks late loses the alerts of the night. Each is recorded on its rule with its
  reason, and the first one per rule is told.
- A rule's sale signal that arrives while the engine is locked is lost as well. The owner who wants a
  sale to happen however late uses an auto order with a price trigger, which the price watcher
  judges again after a resume
  ([decision 0268](0268-no-fill-runs-on-a-price-read-before-the-latest-resume.md)).
- `late` gains a third meaning, a webhook alert past its minute; its message stays the same.

## Alternatives

- **No bound.** An alert held through a locked night fills at the morning's price, outside what
  the sender meant.
- **Sales always, buys within a minute,** as a copy order does. A copied sale follows a leader who
  already sold; a webhook sale follows a condition that may no longer hold, and with no worst price
  it may sell far from the alert's price.
- **Five minutes.** TradingView sends at once, so a longer bound only lets older prices fill.
- **Fill at unlock once.** One fill per rule of the newest waiting alert still trades on an old
  signal.
