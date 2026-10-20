# @binference/brew

The Brew launchpad: the tokens BrewFactory launches, read for the launch feed.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk`, viem and zod. The package graph enforces it. Its fork
  tests live in `packages/cli/src/fork/`, which runs the venue in a composed engine.
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
- The launcher (decision 0283) lives in `src/create/`. It launches through BrewFactory's `launch`
  alone, from the launch wallet, against the coin (WBNB in the pool) or a registry token the
  composition root names for Brew, never the wrapped coin as a token. Every call writes a supply of
  1,000,000,000, the 1% tier, no ranges of its own, the first buy for the wallet at the host's
  minimum (never 0), the quoted fee as both its fee and `maxLaunchFeeWei`, and a salt found off
  line so the token's address ends in 6666, which the factory's `predictTokenAddress` must give.
- The metadata address carries the card's words and the owner's small picture in the document
  Brew's own launches write, 2,048 bytes in all; `pictureBytesFor` says what fits beside the words.
- The fee recipient is outside binference (`isOutsideOnly`): Brew's locker pays it only on its
  own claim. It is given exactly when holder rewards are off; with them on, the build works out
  the token's holder distributor off line, holds the distributor factory's `predict` to it, and
  names it as `holderDistributor`, which the card shows whole. `checkOptions` names the step a
  launch whose settings do not go together needs (decision 0284).
- The start is the owner's `startMarketCap`, else the pair's fixed start, else $5,000 at
  `pairUsdPrice`, named `startBasis` then; its tick is worked out in integer arithmetic on the
  spacing of 200. A quote refuses with the reason that tells the owner's next step:
  `launch_paused`, `start_unpriced`, `start_unreachable` or `dry_run_failed`.
- `src/create/brew-token.ts` and `src/create/brew-distributor.ts` hold BrewToken's and
  BrewHolderDistributor's creation code as their factories' code holds it; their tests hold each
  to a real address.
- Unit tests use the logs recorded in `src/testing/` and a fake factory there, never the network.
