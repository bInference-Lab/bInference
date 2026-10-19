# 0260. A copy order copies each leader trade once, at its own size, inside its caps

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 1](../specs/protocol.md) section 8.2 gives a `copy` order the trigger
`{ leader, perBuyUsdMicros, dailyUsdMicros }`, and its sales mirror the share the leader sold.
[ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28) copies each leader buy at $20, at most
$200 a day per leader, and the agent's limits hold `copy.perBuyUsd` and `copy.perLeaderDayUsd`.
The leader watcher stores one row per trade and wallet with exact amounts, the share of its holding
a sale took, or none when no node holds the block before
([decision 0249](0249-the-leader-watcher-reads-a-tracked-wallet-s-trade-once-per-transaction.md)),
and resumes after an outage from where it stopped
([decision 0250](0250-the-leader-watcher-reads-every-block-once-within-a-budget-and-resumes-where-it-stopped.md)).
Every order fill runs the money path with no card, held to its order's bounds
([spec 6](../specs/intent-states.md) section 5). The specs leave open:

- **How a trade reaches a copy order,** and what keeps one trade from being copied twice.
- **Which trades** a copy order copies, and **how late** a trade may still be copied.
- **What the caps count:** a buy's dollars before or after its quote, and skipped buys or not.
- **What a sale sells:** the share of what, and a sale whose share the watcher could not read.

## Decision

- **Read in order, once.** A copy order reads its leader's trades from the store in the order the
  watcher stored them, from the moment it became active. Its trigger state keeps the number of the
  last trade it took, written under its version before that trade's fill starts, so each trade is
  copied at most once per order, across restarts. A stop between that write and the fill leaves the
  trade uncopied; the next start records it as `missed`.
- **What it copies.** A buy of a token that is neither the chain's coin nor what the order spends,
  and a sale of a token the order holds from its own buys. Every other trade is passed over with no
  row: it is not a trade the order follows.
- **Lateness.** A trade whose block time is more than 60 seconds old when its copy reaches the head
  of its agent's line of fills is skipped as `late` and never copied, as a DCA period is
  ([decision 0246](0246-a-dca-order-buys-once-per-period-and-never-buys-a-missed-one.md)). Trades
  the watcher reads after an outage are reported, never replayed at a later price. A trade read
  while the engine is locked skips with `engine_locked`, and one read while its agent is frozen is
  late by the time the order resumes.
- **A buy's size.** The order's `perBuyUsdMicros`, or the agent's `copy.perBuyUsd` when that is
  lower, of what the order spends, priced at the fill. The fill bounds hold its quote to that
  amount, and the value the policy judged it at must not pass it (`fill_bounds`). The leader's own
  amount does not size it.
- **The daily cap.** Each buy that filled counts at the value the policy judged it at, the value
  the rolling cap counts ([decision 0136](0136-the-24-hour-cap-counts-each-confirmation-at-its-judged-value.md)),
  kept in the order's state with its fill, for 24 hours. A buy whose dollars would take the
  order's buys of the last 24 hours past `dailyUsdMicros`, or the agent's copy buys of that leader
  past `copy.perLeaderDayUsd`, is skipped with `copy_daily_cap` before any intent. One agent's fills
  run one at a time, so two buys never count the same room; a skipped buy counts nothing.
- **A sale.** The leader's `shareSoldBps` of what the order holds of the token, never more than the
  wallet holds: `min(copied, held) × share / 10,000`, rounded down, sold as an amount. What it sold
  leaves the order's holding. A sale whose share the watcher did not read is skipped with the new
  reason `share_unread` and reported: nothing guesses it.
- **Risk and caps as any fill.** Each buy runs the policy and the token risk check; a honeypot or a
  blocked token ends `risk_blocked` and is skipped, with a notice that names the leader's trade and
  its token. The per-trade and rolling caps hold as for any trade.
- **Pace and notices.** A copy order waits after skips only once its fills failed on chain, as a
  DCA order does: each trade is its own. A fill is told with `fill.copyBuy` or `fill.copySell`; a
  skip with `notice.skipped`, its order named by the part `fill.copyTrade`, the leader's trade and
  its token, once per reason in a row as every order's skips.

## Consequences

- `TrackedWalletStore.since` lists a wallet's trades after a stored number.
- A copy order's trigger state holds its last trade, the trade under way, its buys of the day and
  its holdings by token; a fill that cannot count its trade in it is not recorded.
- Spec 6 sections 4 and 5 and spec 4 section 4.3 say so; `share_unread` and `fill.copyTrade`
  have English and Chinese messages.

## Alternatives

- **Copy late trades after an outage.** Rejected: a buy at a price the leader never paid, chasing
  a move already made.
- **Count a buy when it is taken.** Rejected: a honeypot or a refused buy would use up the day.
- **Sell the share of everything the wallet holds.** Rejected: it would sell tokens the agent bought
  for itself.
- **Read a missing share from the leader's balance now.** Rejected: later transfers change the
  balance, and a wrong share sells the wrong amount.
- **A table of copied trades.** Rejected for the order's own state, which its moves already write
  under its version.
