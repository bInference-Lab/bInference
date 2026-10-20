# @binference/flap

The Flap launchpad: quotes, buys and sells of tokens on Flap's bonding curves through its Portal.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk`, viem, zod, `node:crypto` (Keccak-256 for the salt search,
  viem's when Node's OpenSSL has none, and SHA-256 for the upload's boundary) and
  `node:timers/promises` (the salt search's turns); its fork tests also import
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
  no longer tradable or names another quote token is `replan`.
- The trade call is `swapExactInput` alone. It pays the calling wallet and takes no deadline, so
  each chain declares `noDeadline` (decision 0180). A call with permit data is never built or read.
- The launch reading (decision 0254) reads the Portal's events alone, never a call: a
  `TokenCreated` the registry's Portal wrote is a launch, enriched by the same transaction's
  `TokenQuoteSet` (none means the coin), `FlapTokenTaxSet` (none means no tax), `TokenBought`
  (insiders) and `FlapTokenProgressChanged` and `LaunchedToDEX` (its curve); in a later
  transaction those two are a curve change. `src/portal/portal-events.ts` holds the events' ABI.
- The launcher (decisions 0270, 0271) lives in `src/launch/` and talks to Flap's own API only in
  `src/upload/`: the upload and the pin status. Nothing reads an IPFS gateway, ever: a read of a
  fresh CID through Flap's gateway before Flap holds it breaks the token's picture for good. The
  API fake in `src/testing/` throws on any other URL.
- Flap's create call `newTokenV6` is a launch wallet's alone (`isLaunchWalletOnly`): only a launch
  wallet's ceiling allows it, and the signer refuses it from any other wallet.
- A create call is Flap's only when the venue would write the same bytes for what it reads and its
  settings are ones `flapSettingsOf` takes, so the decoder refuses every fixed value and every
  setting the launcher does not write. The salt is found off line from the
  `Random` port; a token's address comes from the Portal, the salt and the registry's Tax Token V3
  implementation.
- Unit tests use the Portal's answers recorded in `src/testing/`, never the network. The fork tests
  in `src/fork/` trade live curve tokens and run in the fork suite.
