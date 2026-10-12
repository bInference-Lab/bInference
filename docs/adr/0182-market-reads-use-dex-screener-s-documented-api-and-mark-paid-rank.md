# 0182. Market reads use DEX Screener's documented API and mark a paid rank

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 1](../specs/protocol.md) section 7.3 gives `market/scan` with `source: trending` "the market
data source's trending tokens on the chain (DEX Screener in v1), in its order", and the agent's
market tools read a token's pools and liquidity. The owner's rules for outside services: the
official API only, keyless or instant self-serve, and every documented error and limit handled.

DEX Screener's API reference (docs.dexscreener.com/api/reference, read on 2026-10-12) documents
13 keyless endpoints, a limit of 300 requests a minute on the pairs, tokens, token pairs and search
endpoints and 60 on the rest, and no answer but 200. It documents no list named trending. Its
ranked token lists are the latest boosts and the tokens with the most active boosts; a boost is
promotion a token's backers buy on DEX Screener. Its trending metas rank narratives, not tokens.

The watchers' `MarketData` port streams blocks and prices, and DEX Screener cannot give either:
its answers sit in its edge cache for up to a minute, and ARCHITECTURE section 23 lets it only
cross-check a price.

## Decision

- **A data plugin kind.** A data source is defined with `defineData` and reads a token's pools and
  a chain's trending tokens (`MarketDataSource`). Market reads reach the engine through a port of
  their own, `MarketReads`, a profile part beside the watchers' `MarketData`: each answer names its
  source, a source that knows nothing gives `no_data`, and one that is down `source_down`.
- **Documented endpoints only.** The `dexscreener` source reads pools from `/token-pairs/v1` and
  trending tokens from `/token-boosts/top/v1`, with each token's deepest pool from `/tokens/v1`
  (30 tokens a request, the documented most). Undocumented feeds, such as the site's charts and
  streams, are never called.
- **A paid rank is marked.** Trending tokens are DEX Screener's tokens with the most active boosts
  on the chain, in its order, each with its `activeBoosts`, so the owner and the agent see that the
  rank was bought.
- **The limits are kept, not hit.** The source counts its own requests per group in a one-minute
  window, retries included. A 429 pauses that group for its Retry-After, or the whole minute when
  it names none, and the request is sent once more when its turn comes within the longest wait.
- **Figures stay exact.** Numbers are read from the answer's own text: prices as exact ratios, USD
  as micro-dollars rounded down, changes as basis points.

## Consequences

- `market/scan` with `trending` and the agent's pool reads have a source; their handlers take the
  `marketReads` profile part.
- A trending list can be bought, so a token from it is outside content like any token data (rule
  3), and its boosts show.
- Cloud can read DEX Screener once for every owner behind the same port, so many agents never share
  one IP's limit by accident.
- The limit is counted per process: another program on the owner's machine that calls DEX Screener
  can still bring a 429, which the pause then absorbs.

## Alternatives

- **Rank by trending metas.** They rank narratives; the tokens behind them take one more request
  per meta, at 60 a minute. Rejected.
- **Call the site's own trending feed.** It is not in the API reference, so it can change or close
  without notice. Rejected by the owner's rule.
- **Put the reads on `MarketData`.** That port streams what the watchers act on; mixing cached
  third-party figures into it would let them reach an order. Rejected.
