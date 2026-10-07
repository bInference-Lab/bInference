# @binference/kyberswap

The KyberSwap venue: keyless quotes from KyberSwap's aggregator API and swaps through its router.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- Contract addresses come only from the registry: the venue declares KyberSwap's router and
  executor proxy by name, and refuses an answer that calls any other router or executor.
- `src/api/` is the one folder that talks to KyberSwap's API. Every answer passes a zod schema in
  a `*.schema.ts` file and leaves the folder as the venue's own types; nothing else holds an
  `unknown`. The API takes no key; the client id names binference.
- A route through a PancakeSwap Infinity or Uniswap v4 pool whose hook is not on the chain's
  allowlist is never quoted. Candidate pools nested in a route count as its pools.
- The decoder reads every term the host checks from the router call's bytes: the recipient, the
  exact input, the minimum return and the executor's deadline. A call in any other shape is
  `unknown_call`, never a guess.
- Unit tests use the answers recorded in `src/testing/`, never the network. The fork tests in
  `src/fork/` call KyberSwap's live API, read only, and run in the fork suite.
