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
  copied at most once per order, across restarts. Each take has the order's next number, and every
  row of its fill names the take and the leader trade (migration 0045): a take with no row and no
  live fill of its agent on the way was cut off by a stop, which rows tell, never a clock. A buy so
  cut off is recorded as `missed`; a sale so cut off is sold again, as below, never twice. While a live fill of its
  agent settles, the order reads no trade: a leader sale of a token its own buy is still landing
  waits for that buy, then is sold, never passed over.
- **What it copies.** A buy of a token that is neither the chain's coin nor what the order spends,
  and a sale of a token the order holds from its own buys. Every other trade is passed over with no
  row: it is not a trade the order follows.
- **Once per leader trade, at a confirmed depth.** A trade is copied once per order by its
  transaction hash, side and token: the order keeps those of its last 50 takes, so a trade a
  reorganization stored again under another log index is passed over. It copies a trade only once
  its block is at least 5 seconds of blocks, and at least 2 blocks, behind the leader watcher's
  last block, the confirmed depth the watcher exposes through its cursor: 12 blocks on BNB Smart
  Chain, past its fast finality. By then a reorganization that removed the trade was read again,
  and the read dropped it ([decision 0262](0262-a-leader-read-of-a-block-again-drops-the-trades-it-no-longer-holds.md)).
  A trade not yet that deep waits, with every trade after it.
- **Lateness** (the owner's choice, 2026-10-20). A buy whose block time is more than 60 seconds
  old when its copy reaches the head of its agent's line of fills is skipped as `late` and never
  made, as a DCA period is
  ([decision 0246](0246-a-dca-order-buys-once-per-period-and-never-buys-a-missed-one.md)). A sale
  the agent missed, while off or behind, is still made when its turn comes, at the price then,
  through the same fill path and bounds, and its notice, `fill.copySellLate`, says when the leader
  sold. It stays fail-closed: its share must be known, it never sells more than the order bought or
  the wallet holds, and it sells once per leader trade across restarts. A trade read while the
  engine is locked skips with `engine_locked`.
- **A buy's size** (the owner's choice, 2026-10-20). The least of the order's `perBuyUsdMicros`, the
  agent's `copy.perBuyUsd` and the leader's own buy, the leader's spend valued as the policy values
  an outflow, at its USD price, rounded up; of what the order spends, priced at the fill. A leader's
  buy that nothing values is skipped with the new reason `leader_unpriced` and reported: nothing
  guesses it. The fill bounds hold the quote to that amount, and the value the policy judged it at
  must not pass it (`fill_bounds`).
- **A floor and an hourly most** (the owner's choice, 2026-10-20). A copy buy whose dollars come
  to under $5 is skipped with `copy_too_small`, and a copy order's eleventh buy within an hour with
  `copy_hourly`, both before any intent and told as any copy skip is: a leader's flood of dust
  buys spends no gas, no risk source quota and no place in the agent's line.
- **The daily cap.** Each buy that filled counts at the value the policy judged it at, the value
  the rolling cap counts ([decision 0136](0136-the-24-hour-cap-counts-each-confirmation-at-its-judged-value.md)),
  else its order's dollars per buy. A buy whose dollars would take the order's buys of the last 24
  hours, kept in its state with each fill, past `dailyUsdMicros`, or the agent's copy buys of that
  leader past `copy.perLeaderDayUsd`, is skipped with `copy_daily_cap` before any intent. The
  agent's count reads the stored fills of every copy order of the agent and leader, whatever its
  state, page by page: cancelling an order and making a new one starts no new day. One agent's
  fills run one at a time, so two buys never count the same room; a skipped buy counts nothing.
- **A sale.** The leader's `shareSoldBps` of what the order holds of the token, never more than the
  wallet holds: `min(copied, held) × share / 10,000`, rounded down, sold as an amount. What it sold
  leaves the order's holding. A sale whose share the watcher did not read is skipped with the new
  reason `share_unread` and reported: nothing guesses it.
- **A sale that fails for a passing reason** (the owner's choice, 2026-10-20) is sold again a
  minute after it failed, for an hour from the leader's sale: a locked engine (`engine_locked`),
  another fill holding the line (`fill_waiting`), a quote no venue or route answered
  (`venue_down`, `no_route`), a fill that threw or ran past its 30 s deadline (`fill_failed`), a
  live fill whose grant ran out in its queue (`fill_lapsed`), and a sale a stop cut off, before or
  after its confirmation. Each try is a new take of the same leader sale, with the same share rule,
  never over what the order bought or the wallet holds; a fill ends the sale, once. Past the hour,
  or with 50 sales already waiting, it is given up with the new reason `copy_sale_lapsed` and a
  notice. Any other reason ends it. A buy is never tried again.
- **Risk and caps as any fill.** Each buy runs the policy and the token risk check; a honeypot or a
  blocked token ends `risk_blocked` and is skipped, with a notice that names the leader's trade and
  its token. The per-trade and rolling caps hold as for any trade.
- **A warned token is still bought** (the owner's choice, 2026-10-20). A token the risk check only
  warns about, such as a high tax, is copied: the per-buy and daily caps bound what such a buy can
  lose. The fill or skip notice of such a buy ends with the line `fill.copyRiskWarn`, which names
  the check's findings.
- **Pace and notices** (the owner's choice, 2026-10-20). A copy order waits after skips only once
  its fills failed on chain, as a DCA order does: each trade is its own. A fill is told with
  `fill.copyBuy` or `fill.copySell`. Every skip is a notice, `notice.skipped`, its order named by
  the part `fill.copyTrade`, the leader's trade and its token; at most five an hour per copy order,
  counted with the same notice hour as an alert's
  ([decision 0245](0245-an-alert-fires-once-per-match-tells-the-owner-and-wakes-the-agent-marked.md)),
  kept in the order's state. The rest are counted and told in one line, `notice.copyHeld`, "12 more
  copy trades skipped this hour, see the console", when the hour ends or before the next hour's
  first; it is muted with the skips.

## Consequences

- `TrackedWalletStore.since` lists a wallet's trades after a stored number.
- A copy order's trigger state holds its last trade, the trade under way, its buys of the day and
  its holdings by token; a fill that cannot count its trade in it is not recorded.
- Spec 6 sections 4 and 5 and spec 4 sections 4 and 4.3 say so; `share_unread`,
  `leader_unpriced`, `fill.copyTrade`, `fill.copySellLate` and `notice.copyHeld` have English and
  Chinese messages.

## Alternatives

- **Copy late buys after an outage.** Rejected: a buy at a price the leader never paid, chasing a
  move already made.
- **Skip late sales too.** Rejected by the owner: the agent would keep a position its leader left.
- **Copy every buy at the full dollars per buy.** Rejected by the owner: a leader's $5 test buy
  would become a $20 one.
- **Count a buy when it is taken.** Rejected: a honeypot or a refused buy would use up the day.
- **Sell the share of everything the wallet holds.** Rejected: it would sell tokens the agent bought
  for itself.
- **Read a missing share from the leader's balance now.** Rejected: later transfers change the
  balance, and a wrong share sells the wrong amount.
- **Tell a copy order's skips once per reason in a row,** as other orders do. Rejected by the
  owner: each skip is a leader trade not copied, and the owner hears of each, within the hour's
  count.
- **A table of copied trades.** Rejected for the order's own state, which its moves already write
  under its version.
