# @binference/dexscreener

## Purpose

The `dexscreener` data source. The agent reads a token's pools and a chain's trending tokens
through DEX Screener's public API, which answers without a key. It serves BNB Smart Chain
(`eip155:56`, DEX Screener's `bsc`); any other chain is `not_covered`.

- **Pools.** `GET https://api.dexscreener.com/token-pairs/v1/bsc/{tokenAddress}`: each pair of the
  token becomes a `MarketPool` (exchange, pool, base and quote token, USD price, liquidity, 24-hour
  volume and change, creation time), deepest first. A pair whose quote token has no address, which
  the documented schema allows, is left out.
- **Trending.** `GET /token-boosts/top/v1`, DEX Screener's tokens with the most active boosts,
  filtered to the chain in its order, then `GET /tokens/v1/bsc/{tokenAddresses}` (30 a request, the
  documented most) for each token's deepest pool. Boosts are bought, so each token carries its
  `activeBoosts`.
- **Candles.** DEX Screener's API documents none, so this source serves no chart
  ([decision 0183](../../docs/adr/0183-candles-come-from-a-source-that-publishes-them.md)).

## Limits and errors

DEX Screener publishes 300 requests a minute on the pairs and tokens endpoints and 60 on the
boosts, and documents no error answer. The source:

- counts its own requests in a one-minute window per group, retries included, and waits for its
  turn up to `maxWaitMs` (one minute unless given); a turn further away fails at once;
- on a 429 pauses that group for its `Retry-After` (seconds or a date, at most five minutes), or
  for the whole minute when it names none, then sends the request once more;
- fails a second 429, or a turn past the longest wait, as a retryable `dexscreener.rate_limited`
  with `details.retryAfterMs`;
- fails any other status but 200 as `dexscreener.unavailable`, retryable for 408 and 5xx;
- fails a 200 that is not JSON or breaks the documented schema as `dexscreener.bad_answer`.

Numbers in an answer are read from their own text, so `753.55` is the exact ratio 75355/100 and
liquidity is micro-dollars rounded down.

## API

| Export                    | What it does                                           |
| ------------------------- | ------------------------------------------------------ |
| `createDexscreenerSource` | The `dexscreener` data source over an `Http` port      |
| `DexscreenerOptions`      | The `Http` port, the clock that paces it, its max wait |

## Example

The composition root builds the source with the engine's outbound HTTP and clock:

```ts
import { createDexscreenerSource } from "@binference/dexscreener";

const dexscreener = createDexscreenerSource({ http, clock });
const pools = await dexscreener.pools(asset, { signal });
```
