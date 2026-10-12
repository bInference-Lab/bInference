# @binference/flap

The Flap launchpad: quotes, buys and sells of tokens on Flap's bonding curves through its Portal.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- The Portal's address comes only from the registry: the venue declares it by name. Every read is
  an `eth_call` of the Portal through the chain's RPC failover, which the composition root gives.
- `src/portal/` is the one folder that knows the Portal's ABI and calls it. A token Flap never
  launched is the Portal's own `TokenNotFound`; any other revert of a state read, or an answer
  outside its shape, throws, so a token whose place is in doubt never counts as off its curve.
- The venue quotes only a token tradable on its curve, against the chain's coin or a quote token
  the composition root names, and only with that asset. A graduated token is `no_route`: the
  pools route it. A buy that would sell the rest of a curve is `no_route`, since the Portal would
  hand back part of the input.
- Each quote names the tax the Portal takes on that side (decision 0181). The price impact leaves
  that tax out, so the tax is judged once, against the agent's maximum tax.
- The price read is one `getTokenV8Safe` call of the Portal, planned from the token's state now:
  only a token tradable on its curve is priced, from the state's own `price`, and an answer that is
  no longer tradable or names another quote token prices nothing.
- The trade call is `swapExactInput` alone. It pays the calling wallet and takes no deadline, so
  each chain declares `noDeadline` (decision 0180). A call with permit data is never built or read.
- Unit tests use the Portal's answers recorded in `src/testing/`, never the network. The fork tests
  in `src/fork/` trade live curve tokens and run in the fork suite.
