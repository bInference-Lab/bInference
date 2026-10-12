# 0184. Market scans and charts keep cheap prices readable

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 1](../specs/protocol.md) section 7.3 has `market/scan` answer `ScanItem`s and `market/chart`
answer OHLCV candles, every USD figure in micro-dollars for one whole token, as section 1 writes
USD. Many tokens the agent scans trade far below a cent: at $0.0000075 a token is 7 micro-dollars,
so a chart of it moves in steps of a seventh of its price, and one below $0.000001 reads as 0.

The spec leaves open which pool a chart reads, what an interval with no trade gives, how `to`
bounds the candles, and how a scan shows the active boosts
[decision 0182](0182-market-reads-use-dex-screener-s-documented-api-and-mark-paid-rank.md) marks.
`source: launches` reads the launch feed, which no engine runs yet. GeckoTerminal, the candle
source of [decision 0183](0183-candles-come-from-a-source-that-publishes-them.md), publishes about
10 calls a minute for its whole public API.

## Decision

- **Cheap prices keep their digits.** The prices of a `market/chart` answer and of each `ScanItem`
  are micro-dollars for 10^`priceScale` whole tokens. `priceScale` is the smallest of 0 to 18 at
  which the lowest price above zero, in the chart or in the item, comes to at least one dollar; it
  is absent when 0. The figures round down. Volumes and liquidity stay micro-dollars.
- **A chart reads the token's deepest pool, priced for the token.** `market/chart` asks only the
  data sources that read candles. GeckoTerminal charts the deepest of the token's top pools by
  reserve, in USD for the token itself, and fills every interval: one with no trade repeats the
  last close with no volume. The answer is the `limit` newest candles that start before `to`,
  oldest first.
- **A scan shows a bought rank.** `ScanItem` gains `activeBoosts`, the boosts active on the token
  when its source ranks by paid promotion.
- **Each read asks the sources that serve it.** Pools and trending tokens come from DEX Screener,
  candles from GeckoTerminal, so GeckoTerminal's few calls a minute go to charts and the price
  watcher's cross-check.
- **Launches are refused until the feed runs.** `market/scan` with `source: launches` fails
  `market.no_launch_feed`, not retryable, while the engine runs no launch feed. `filters` describe
  launches, so `filters` with `source: trending` is `protocol.bad_args`.

## Consequences

- Spec 1 gains `priceScale` on the chart and on `ScanItem`, `activeBoosts` on `ScanItem`, and the
  error code `market.no_launch_feed`; each is an addition.
- A client draws a chart by dividing by 10^`priceScale` once, and labels the axis with the price of
  one token.
- A token with no pool on GeckoTerminal has no chart, and a chart read again within ten minutes
  costs one request, since the source keeps each token's chart pool that long.
- A scan's `assets` hold the registry's info only, and `risk` stays absent until the engine keeps
  whole risk views, not only the sources' reports.

## Alternatives

- **Micro-dollars per token, as written.** Charts and scans of the cheapest tokens, the ones a
  meme scan finds, would read as steps or zeros. Rejected.
- **Decimal strings of whole dollars.** Exact, but a second way to write USD beside section 1's
  micro-dollars. Rejected.
- **Skip intervals with no trade.** GeckoTerminal's default; `limit` would then count trades, not
  time, and a quiet token's chart would span days for a one-minute interval. Rejected.
- **Answer launches with no items.** An empty list reads as "no launches today". Rejected.
