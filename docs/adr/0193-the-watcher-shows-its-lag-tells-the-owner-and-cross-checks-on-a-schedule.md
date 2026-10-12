# 0193. The watcher shows its lag, tells the owner, and cross-checks on a schedule

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[ARCHITECTURE.md section 9](../ARCHITECTURE.md#section-9) has DEX Screener and GeckoTerminal
cross-check the watchers' prices, and section 24 lists the health signals of `binference status`.
A watcher that falls behind fills stop-losses late without a sound, and the public RPCs are rate
limited and flake. DEX Screener allows 300 requests a minute on its tokens endpoint; GeckoTerminal
about 10 a minute for its whole public API, which the charts also use (decision 0184). Both price
up to 30 tokens a request, in USD for one whole token, so a comparison needs the token's decimals.

## Decision

- **Lag in blocks.** The price watcher's lag is the head less the block it read last, plus the
  blocks the chain should have made since the last head while the block source saw none. The
  `watcher` health signal is ok within 2 blocks, a warning within 10, and failing past that; the
  worst chain decides, and `since` says when it stopped being ok. `engine/status` gains
  `lagBlocks` on a health signal, set on `watcher` while a watcher reads, and `binference status`
  prints it.
- **The owner hears it.** A chain more than 10 blocks behind for 30 seconds announces
  `notice.watcherLag` with the chain and the blocks, once until the chain is back within 2 blocks,
  and at most once in 30 minutes per chain. The notice cannot be muted: orders filling late is
  money that needs a look.
- **A keyed RPC when it matters.** `binference check` warns under `rpc.keyed` while the running
  engine holds a live auto order with a price trigger and an enabled chain reads only its public
  RPCs, and recommends a paid RPC under `chains.rpc` with its `ws` URL.
- **Cross-check on a schedule.** Every 60 seconds the watchers' USD prices of up to 90 tokens go to
  DEX Screener (3 requests), and every 5 minutes up to 30 tokens to GeckoTerminal (1 request,
  through the one GeckoTerminal source the charts read through), the tokens checked longest ago
  first; never once a block. Each comparison is per whole token, with the token's decimals read on
  chain once. A gap of 10% or more of the source's price is flagged: logged as
  `watcher.price_gap` with the token, the source and the gap, and the `watcher` signal warns while
  a watched token's last check is flagged. A flag stops nothing yet; the triggers decide what it
  means for a fill.

## Consequences

- `engine/status`'s health signal gains the optional `lagBlocks`, an addition within protocol
  version 1. Spec 4 gains `notice.watcherLag`; log records gain `assetId`, `sourceId` and `gapBps`.
- The cross-check takes about one of GeckoTerminal's ten calls a minute in five, and 3 of DEX
  Screener's 300 a minute, whatever the number of tokens.
- A token neither source prices is never cross-checked.

## Alternatives

- **Lag in seconds.** A block is the unit a trigger misses; seconds follow from the chain's block
  time. Rejected.
- **A notice for every warning.** A public RPC often trails by a few blocks for a moment; the
  owner would learn to ignore it. Rejected.
- **Cross-check every block.** Hundreds of requests a minute, past both sources' limits. Rejected.
- **Hold fills on a gap here.** Fills and their bounds belong to the order fills; the watcher only
  reports. Rejected.
