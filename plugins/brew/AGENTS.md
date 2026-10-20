# @binference/brew

The Brew launchpad: the tokens BrewFactory launches, read for the launch feed.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- Brew has no curve. A launch puts the token's whole supply into a PancakeSwap V3 pool, where the
  aggregators trade it from the first block, so the venue quotes, builds and decodes no trade of
  its own: its quote is `no_route`, its build throws `brew.no_trade`, its decoder answers every
  draft `unknown_call` (decision 0278).
- Only the single-pair BrewFactory counts: the registry lists it as `factory`, and only its own
  logs are believed. It writes `TokenLaunched` in the call that records the launch in
  `launches(token)`, so a token counts as Brew's exactly when that factory's record names it.
  Brew's multi-pair and dividend factories are unverified and not listed: their tokens are unknown
  to binference and trade as any other token.
- `src/contracts/` is the one folder that knows Brew's ABIs, from BrewFactory's verified source.
- The launch reading reads the factory's `TokenLaunched` as a launch, with its creator, words and
  pair, the chain's coin for its wrapped coin, and the recipients of the same factory's
  `InitialBuyExecuted` for that token as insiders. A Brew token reads as graduated, with no tax.
- Unit tests use the logs recorded in `src/testing/`, never the network.
