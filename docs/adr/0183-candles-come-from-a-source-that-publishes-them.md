# 0183. Candles come from a source that publishes them

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 1](../specs/protocol.md) section 7.3 has `market/chart` answer OHLCV candles in USD and name
their `source`, "`dexscreener` in v1". DEX Screener's API reference (docs.dexscreener.com/api/reference,
read on 2026-10-12) documents no candle, chart or price-history endpoint; its site draws charts
from feeds the reference does not list. The owner's rule allows the official API only.

GeckoTerminal's public API, which answers without a key, documents OHLCV per pool
(`/networks/{network}/pools/{pool_address}/ohlcv/{timeframe}`) at minute, hour and day frames with
aggregates that cover 1m, 5m, 15m, 1h, 4h and 1d, up to 1,000 candles a request. GeckoTerminal is
already on the list of offered integrations ([decision 0084](../DECISIONS.md#d0084)).

## Decision

- **DEX Screener serves no chart.** The `dexscreener` source reads pools and trending tokens only.
- **`market/chart` reads candles from a data source that documents them, GeckoTerminal in v1.** The
  answer's `source` is `geckoterminal`. The data plugin port gains a candle read when that source is
  built; a source without one is never asked for candles.
- A chart with no source that answers is `market.no_data`; a source that is down,
  `market.source_down`, as spec 1 says.

## Consequences

- Spec 1 names `geckoterminal` as v1's candle source.
- The GeckoTerminal plugin, until now a second price cross-check, also serves candles, with its own
  documented limits and errors.
- A token with no GeckoTerminal pool has no chart, even when DEX Screener lists its pools.

## Alternatives

- **Read the candles DEX Screener's site draws from.** Undocumented, so it can change without
  notice. Rejected by the owner's rule.
- **Build candles from the watchers' block readings.** Only tokens with live orders are watched,
  so most tokens would have no history. Rejected for v1.
