# 0194. The price watcher proves its pools and is never silent

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

A second review of the price watcher of [decision 0192](0192-the-price-watcher-reads-every-watched-token-in-one-batch-at-each-block.md)
and [decision 0193](0193-the-watcher-shows-its-lag-tells-the-owner-and-cross-checks-on-a-schedule.md)
found ways it can price a token from a pool nobody trades in, or price nothing without a sound:

- a pool's depth was its quote token's balance, which a deposit, or liquidity parked outside a v3
  pool's range, inflates; the choice was made once and never measured again;
- a watched token no reader prices left the `watcher` signal ok and the owner uninformed, so its
  stop-loss could never fire;
- a socket whose node repeated a head, or trailed the chain, never gave way to polling;
- a watcher stopped by a fault stayed stopped; a node that had not imported the newest block yet
  was rested as faulty; one call that burns its gas failed every token's batch; a 5 s timeout is
  eleven blocks; a slow link read one block per round trip; one failed call dropped a token's
  pool for up to 30 s.

Multicall3's `aggregate3` gives every call all the gas left, and takes no gas limit per call.

## Decision

- **Depth from what a pool can trade.** A v2 pair's depth is its quote reserve; a v3 pool's is its
  liquidity in range as a quote amount at its current price, `L·√P` or `L/√P`. Balances are never
  read. The chosen pool is measured again in every block's batch, a v3 pool reading its
  `liquidity()` beside its `slot0`; a pool under the least depth, or under half the depth it was
  chosen with, is replaced. Each token's pools are found again every 10 minutes, at a time of its
  own; the pool in use prices until the new choice comes.
- **A pool's price is proven before a trigger uses it.** A price read from a pool is `confirmed`
  only once the cross-check found the token within its gap limit of a data source after that pool
  was chosen; a thin pool, under $25,000 deep, needs such a check from the last 5 minutes. A token
  with an unproven pool is checked first in its source's next round. A launchpad's curve price is
  confirmed as read: the curve is the token's market.
- **Never silent about a token without a price.** `order/create` refuses a limit, take-profit,
  stop-loss or trailing order whose token the watcher cannot price now
  (`order.unpriced_token`). A watched token without a confirmed price for 60 seconds counts in the
  `watcher` signal (`unpricedTokens`, a warning) and announces `notice.watcherUnpriced` with its
  chain and tokens, once until every token is priced again and at most once in 30 minutes per
  chain. It cannot be muted.
- **A stopped watcher restarts and says so.** A watcher stopped by a fault restarts after 1 s,
  doubling up to 30 s, while it watches a token. While it is down the `watcher` signal fails, and
  `notice.watcherStopped` tells the owner once per stop; it cannot be muted.
- **A socket must advance.** Only a head above every head seen resets the socket's timeout.
- **"Not yet" is not a fault.** A node that answers a read of a block at or above the newest head
  with "header not found" or "unknown block" has not imported it yet: it is not rested, the read
  asks first the endpoint whose poll announced the block, and when every endpoint answers so it is
  tried again 150 ms later. `rpc.keyed` asks for a paid HTTP endpoint; a `ws` URL alone does not
  count.
- **One bad read blinds one token.** A block's batch carries a gas limit of 1,000,000 per call,
  as Multicall3 can bound only the whole. A batch the node refuses is read again in halves at the
  same block until the calls that fail it are found; their tokens leave the batch, are logged as
  `watcher.read_quarantined` and are planned again later. A venue's read may call only the venue's
  own declared contracts on the chain.
- **A block budget.** A head poll or a batch gives one endpoint 1,500 ms, about three blocks,
  before the next is asked; other reads keep the failover's 5 s.
- **Catching up in one round trip.** Behind the head, the batches of up to four blocks go out at
  once and their prices are handed on in block order.
- **Keeping a good pool.** A plan whose answers price nothing is kept for up to three blocks in a
  row, and replaced at once when its answers say it no longer holds, such as a token that left its
  curve or a pool gone thin. A plan that cannot be made for want of an RPC is tried again after a
  block time; a token no reader prices, after 30 s.
- **Smaller fixes.** A data source that refuses a round is heard; the cross-check forgets tokens
  no longer watched, and a token's last price once it has none; a decimals read that fails is
  isolated as a batch is; a reorganised block at the same height, which a socket's new hash shows,
  is read again; the lag notice's 30 minutes survive a watcher that stops and starts; a lag counts
  as failing from its first block past 10 until it is back within 2.
- **Pool quotes.** Pools quoted in the chain's coin wrapper or a stablecoin price a token, as
  decision 0192's feeds do; BTCB and Binance's ETH are pegged, not redeemable one for one on chain,
  so a pool quoted only in them leaves its token without a price, which is now never silent.

## Consequences

- `PriceRead.price` may answer `replan`; `PriceRead` reads gain v3 `liquidity()`; `WatchedPrice`
  gains its plan and whether it is confirmed. Spec 1 gains `unpricedTokens` on a health signal and
  `order.unpriced_token`; spec 4 gains two notices that cannot be muted.
- A trigger fires only on a confirmed price, so a token neither DEX Screener nor GeckoTerminal
  prices, on a pool, can carry no price order, and the owner is told.
- Each token's pools cost two Multicall3 calls every 10 minutes beside its per-block read.

## Alternatives

- **A gas limit per call through a contract of our own, put in place by a state override.** It
  would need compiled bytecode and a node that takes state overrides on `eth_call`. Rejected for
  the halving search.
- **Depth from quote balances.** A deposit buys the choice. Rejected.
- **Warn on an unpriced order instead of refusing it.** An order that can never fill is a promise
  binference cannot keep. Rejected.
