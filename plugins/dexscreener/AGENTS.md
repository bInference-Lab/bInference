# @binference/dexscreener

The DEX Screener data source: keyless pools, liquidity and trending tokens from DEX Screener's
public API.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk` and zod. The package graph enforces it.
- It calls only the endpoints DEX Screener's API reference documents (docs.dexscreener.com), with
  no key. Undocumented endpoints, such as the site's own chart and stream feeds, are never used.
- `src/api/` is the one folder that reads DEX Screener's answers. Every answer is parsed with its
  numbers kept as the text DEX Screener wrote, passes a zod schema in a `*.schema.ts` file, and
  leaves the folder as the source's own types; nothing else holds an `unknown`.
- Every request waits its turn under the published limits (300 a minute on pairs and tokens, 60 on
  the boosts) in `request-budget.ts`. A 429 pauses its group for Retry-After, or a whole minute.
- Figures are never floating-point numbers: prices are exact ratios, USD is micro-dollars rounded
  down, changes are basis points toward zero.
- The source reports what DEX Screener publishes and decides nothing. Its figures never price a
  trade: the watchers read prices on chain, and DEX Screener only cross-checks them.
- Unit tests use the answers in `src/testing/`, written in the documented shapes, never the network.
