# @binference/geckoterminal

## Purpose

The `geckoterminal` data source. The agent and the owner read a token's chart through
GeckoTerminal's public API, which answers without a key, and the price watcher will cross-check
its readings against GeckoTerminal's token prices. It serves BNB Smart Chain (`eip155:56`,
GeckoTerminal's `bsc`); any other chain is `not_covered`.

- **Candles.** `GET https://api.geckoterminal.com/api/v2/networks/bsc/pools/{pool}/ohlcv/{timeframe}`
  on the token's deepest pool, in USD (`currency=usd`) for the token itself (`token={address}`),
  so a pool that lists the token as its quote is never charted upside down. Every interval is
  asked for (`include_empty_intervals=true`): one with no trade repeats the last close with no
  volume. The chart's intervals map onto the documented timeframes and aggregates: `1m`, `5m` and
  `15m` on `minute` 1, 5 and 15; `1h` and `4h` on `hour` 1 and 4; `1d` on `day` 1. One request
  reads at most 1,000 candles and, per the docs, at most six months back; `before_timestamp`
  reads older ones. Candles come back oldest first, each figure exact.
- **Pools.** `GET /networks/bsc/tokens/{address}/pools`: the token's top pools, deepest first by
  their reserve in USD. The documented 404 of an unknown token is no pools. The chart's pool is
  the deepest, kept ten minutes for at most 256 tokens, so a chart asked for again costs one
  request.
- **Trending.** `GET /networks/bsc/trending_pools`: the base token of each trending pool, each
  once, in GeckoTerminal's order, with that pool. GeckoTerminal ranks without paid promotion.
- **Prices.** `GET /networks/bsc/tokens/multi/{addresses}`, 30 addresses a request, the
  documented most: each token's `price_usd`, exactly as GeckoTerminal wrote it. A token it knows
  not, or sends no price for, is left out.

## Limits and errors

GeckoTerminal's docs publish about 10 calls a minute for the public API, shared by every
endpoint, which may change with its traffic, and count every request, refused ones too. The
source:

- counts its own requests in a one-minute window, retries included, and waits for its turn up to
  `maxWaitMs` (one minute unless given); a turn further away fails at once;
- on a 429 pauses every endpoint for its `Retry-After` (seconds or a date, at most five minutes),
  or for the whole minute when it names none, then sends the request once more;
- fails a second 429, or a turn past the longest wait, as a retryable `geckoterminal.rate_limited`
  with `details.retryAfterMs`;
- answers the documented 404 of a token's pools as no pools, and fails any other status but 200
  (the documented 400 of more than 30 tokens, 403, the 404 of an unknown network) as
  `geckoterminal.unavailable`, retryable for 408 and 5xx;
- fails a 200 that is not JSON, breaks the documented schema, or prices another token than the
  one asked as `geckoterminal.bad_answer`.

Numbers in an answer are read from their own text, so `753.96` is the exact ratio 75396/100 and
volume and liquidity are micro-dollars rounded down. A pool's price change is left out: the docs
do not say which of its tokens it is of.

## API

| Export                      | What it does                                           |
| --------------------------- | ------------------------------------------------------ |
| `createGeckoterminalSource` | The `geckoterminal` data source over an `Http` port    |
| `GeckoterminalOptions`      | The `Http` port, the clock that paces it, its max wait |

## Example

The composition root builds the source with the engine's outbound HTTP and clock:

```ts
import { createGeckoterminalSource } from "@binference/geckoterminal";

const geckoterminal = createGeckoterminalSource({ http, clock });
const candles = await geckoterminal.candles?.(asset, { interval: "1h", limit: 100 }, { signal });
```
