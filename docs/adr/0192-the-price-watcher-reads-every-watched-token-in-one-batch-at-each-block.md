# 0192. The price watcher reads every watched token in one batch at each block

Status: Amended by 0194

Accepted by the owner on 2026-10-12.

## Context

[ARCHITECTURE.md section 9](../ARCHITECTURE.md#section-9) has the watchers read prices from pool
state every block for the tokens with live orders, and leaves open how a block is seen, which state
prices a token, and what each block costs. The facts:

- BNB Smart Chain makes a block every 0.45 s. A stop-loss that sees a price a few blocks late fills
  late.
- BNB Chain's public RPCs answer HTTP only: `eth_subscribe` answers error -32601, "notifications
  not supported" (checked 2026-10-12), and they allow 10,000 requests in 5 minutes. Paid providers
  offer a `wss:` endpoint with `newHeads`, whose URL carries the owner's key.
- A token's price lives in different places: a launchpad curve's in the launchpad's contract (Flap's
  Portal reports it in `getTokenV8Safe`), a graduated token's in its DEX pools. KyberSwap and OKX
  route over pools they do not own.
- Multicall3 sits at `0xcA11bde05977b3631167028862bE2a173976CA11` on BSC; its code holds
  `aggregate3` (checked 2026-10-12). viem's own multicall splits a batch into 1,024-byte chunks
  unless told otherwise, and its transports retry outside our failover.

## Decision

- **New blocks.** When config names `chains.rpc.<chain>.ws`, a `wss:` URL read from a secret
  source, the block source subscribes to `newHeads`. A socket that closes, is refused, or brings no
  head for 3 s gives way at once to polling, and is opened again after 30 s. Without one, the
  source polls `eth_blockNumber` once a block time through the chain's failover, whose next
  endpoint answers within the failover's timeout when one is dead. Only a head above every head
  seen is handed on.
- **Price reads.** A venue may declare `priceRead`: the calls that read a token's price state and a
  pure step that turns their answers into a price in a quote asset. The venue host asks the
  launchpad that holds a token on its curve, else the first other venue that declares a read, and
  hands on a checked copy: at most four calls, all on the token's chain, a quote asset of that
  chain, and a pricing step that cannot throw or answer a price at or below zero. Flap declares its
  Portal's own curve price.
- **Pools when no venue prices a token.** The EVM family reads Uniswap-style pools: the PancakeSwap
  v2 pair and the v3 pools at the four fee tiers (0.01%, 0.05%, 0.25%, 1%) of the token with each
  registry token that has a Chainlink feed, and prices it from the deepest by the USD value of the
  quote token held, at least $1,000; a v3 pool needs liquidity in range. A v2 pair prices by its
  reserves, a v3 pool by its current price.
- **One batch a block.** At each new block the watcher reads every watched token's calls and the
  Chainlink feeds of their quote assets in one `aggregate3` call at that block's number, each call
  allowed to fail, encoded by binference and never split. A price change at block N is read at
  block N, in its quote asset and in USD from the same block's feed.
- **Catching up.** Blocks are read in order. More than four behind the head, the watcher reads the
  newest four and counts the rest as skipped.
- **One subscription per token.** A token is read once however many watch it, and a chain's watcher
  runs only while it watches a token. The engine watches the token of each active auto order whose
  trigger is a price (limit, take-profit, stop-loss and trailing), synced with the order store
  every 5 seconds.
- **Planning again.** A token whose answers price nothing, such as one that left its curve, is
  planned again at once, or 30 seconds after its plan when that plan is newer; one no reader prices
  is asked about again after 30 seconds.

## Consequences

- `@binference/chain` gains the `PriceReader` port with its contract suite and `Venue.priceRead`;
  `defineVenue` keeps it. Config gains `chains.rpc.<chain>.ws` (config version 7).
- Polling costs two requests a block, about 1,330 in 5 minutes, an eighth of BNB Chain's public
  limit, whether 1 or 200 tokens are watched; with a socket, one.
- KyberSwap and OKX declare no read: their tokens are priced by the pools. A token that trades
  only in v4-style pools, such as PancakeSwap Infinity's, has no price until a venue declares one.
- Triggers read their prices from the watcher (the order fills and triggers to come).

## Alternatives

- **viem's `watchBlocks` and `multicall`.** They chunk the batch, poll on their own transports and
  retry outside the failover's timeouts and key redaction. Rejected.
- **One `eth_call` per token.** 200 requests a block for 200 tokens, past every public limit.
  Rejected.
- **Prices from DEX Screener or GeckoTerminal.** Seconds old, rate limited, and not the chain's
  state at a block. They cross-check instead (decision 0193). Rejected.
- **Only the newest block when behind.** A dip that lasts one block would never trigger a
  stop-loss. Rejected in favour of reading up to four blocks back.
- **Polling twice a block.** Halves the wait for a head at twice the cost; a paid `wss:` RPC does
  better. Rejected.
