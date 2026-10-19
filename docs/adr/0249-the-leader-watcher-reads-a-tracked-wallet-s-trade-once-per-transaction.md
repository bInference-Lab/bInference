# 0249. The leader watcher reads a tracked wallet's trade once per transaction

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 3](../specs/database.md) section 2.6 has the leader watcher read each block with one log
query for ERC-20 transfers to the tracked wallets and one for transfers from them, each with every
tracked address in its topic filter, and the block's transactions once for native value. It
stores the trades in `wallet_activity`, matched into buys and sells with the share of a holding a
sale took. [Spec 1](../specs/protocol.md) section 7.3 gives an `ActivityItem` one side, one asset
and one counter asset. The specs leave open:

- **What one trade is.** A swap through an aggregator's router or a launchpad's curve can send the
  wallet a token in several transfers, and an aggregator can split a route.
- **Which side a swap is.** A wallet swaps the chain's coin for a token, a token for a stablecoin,
  or one token for another.
- **Where native coin received shows.** A sale for the chain's coin pays the wallet from inside a
  contract call, which emits no log.
- **Which balance a share is taken of,** and what a read answers once a node pruned that state.
- **Which endpoints answer the logs.** BNB Chain's public nodes refuse `eth_getLogs` with -32005
  "limit exceeded" (checked 2026-10-19); keyed providers and 48 Club's public node serve it.

## Decision

- **One transaction, one trade.** The watcher sums each tracked wallet's transfers of each asset
  in a transaction, in and out, and adds the native coin: the transaction's value when the wallet
  sent it, and for a transaction in which the wallet sent a token and received none, the native
  coin it received in the block, measured as
  [decision 0108](0108-native-coin-a-trade-received-is-read-from-the-balance.md) measures
  it. Exactly one asset in and one out is a trade; anything else (a transfer, an airdrop, adding
  liquidity) is none. A wallet with two such sales in one block shares what the block paid it
  between those that called a venue the registry names, else all of them, in equal parts, the
  rest to the first.
- **Quote assets decide the side.** The chain's coin and the tokens with a Chainlink feed are quote
  assets. A quote asset for a token is a buy of the token; a token for a quote asset is a sale of
  the token; one token for another is a sale of the first and a buy of the second, two items of
  one transaction; one quote asset for another is a buy of the one received. Each item's
  `log_index` is the first transfer log of its asset in the transaction, else of the transaction's
  first, so two items of one transaction never collide.
- **The share of a sale** is the amount sold over the wallet's balance of the token right before
  it: the balance at the block before, read with every other balance a block needs in one
  Multicall3 call, plus the wallet's transfers of the token earlier in the block. It is rounded
  down to a basis point and at most 10,000. When no endpoint holds the state of the block before,
  the sale is stored without a share, and a sale for the chain's coin through a venue the registry
  names with a counter amount of 0 and no value.
- **The value** in USD is the quote side's amount at its Chainlink feed's answer at the block
  before, read in the same Multicall3 call, judged stale against the block's time. A trade with
  no quote asset has none.
- **The venue** is the registry's venue whose contract the transaction called.
- **The time and the native values** come from the block itself, read once with its transactions,
  and only for a block that holds a tracked wallet's transfer.
- **Logs come through the chain's failover.** An endpoint that refuses `eth_getLogs` is a node
  fault, and the next is asked. A chain whose endpoints all refuse reads nothing and says so in
  its log; the owner adds a log-capable endpoint under `chains.rpc.<chain>.urls`.

## Consequences

- `@binference/chain-evm` gains the leader watcher, and the failover reads an endpoint's refusal of
  a query as too large as the call's own answer, not the node's fault.
- A copy order mirrors `shareSoldBps` when it is there; a sale without one needs a rule of
  its own.
- A router that refunds part of a native payment shows the payment sent, not the net.

## Alternatives

- **One item per transfer.** A split route would read as several trades. Rejected.
- **Venue event decoders.** Exact, but one decoder per venue and version, and a venue the registry
  does not list would read as nothing. Rejected for the transfer sums every venue emits.
- **Every block's transactions.** A full block 2.2 times a second, for the rare block that holds a
  tracked trade. Rejected.
- **Traces of every trade.** Exact native values, but public nodes answer no trace. The owner's
  tracer still answers once the state is pruned (decision 0108).
