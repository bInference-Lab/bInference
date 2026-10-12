# @binference/geckoterminal

The GeckoTerminal data source: keyless candles, pools and token prices from GeckoTerminal's public
API.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk` and zod. The package graph enforces it. The SDK's `data`
  subpath reads numbers exactly and paces the requests.
- It calls only the endpoints GeckoTerminal's public API documents in its OpenAPI
  (api.geckoterminal.com/docs), with no key, and sets the API version the docs ask for in
  `Accept`. CoinGecko's keyed endpoints are never used.
- `src/api/` is the one folder that reads GeckoTerminal's answers. Every answer is parsed with its
  numbers kept as the text GeckoTerminal wrote, passes a zod schema in a `*.schema.ts` file, and
  leaves the folder as the source's own types; nothing else holds an `unknown`.
- Every request waits its turn under the published limit, about 10 calls a minute for every
  endpoint together, declared in `geckoterminal-api.ts`. A 429 pauses every endpoint for
  Retry-After, or a whole minute.
- Figures are never floating-point numbers: prices are exact ratios, USD is micro-dollars rounded
  down. A figure the docs give no clear meaning, such as a pool's price change, is left out.
- The source reports what GeckoTerminal publishes and decides nothing. Its figures never price a
  trade: the watchers read prices on chain, and GeckoTerminal only cross-checks them and draws
  charts.
- Unit tests use the answers in `src/testing/`, written in the documented shapes, never the network.
