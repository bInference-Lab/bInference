# @binference/okx

The OKX venue: quotes from OKX's DEX aggregator API with the owner's key and swaps through its DEX
router.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin:

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- It runs only on the owner's key: the venue refuses an empty key, secret or passphrase when it is
  made, and the composition root installs it only when `venues.keys.okx` is set. A key part stays a
  `Secret`, revealed only in `src/api/signed-headers.ts`; no fault, log or URL carries one.
- Contract addresses come only from the registry: the venue declares OKX's DEX router and
  TokenApprove by name, and refuses a call to any other router or an approval of any other spender.
- `src/api/` is the one folder that talks to OKX's API. Every answer passes a zod schema in a
  `*.schema.ts` file and leaves the folder as the venue's own types. Every code in OKX's error code
  list maps to `no_route` or to a fault in `answer-fault.ts` that names the code; a new code is a
  line there and a case in `okx-api.test.ts`.
- OKX's answers name a route's protocols but not its pools, so no hook can be checked: a route
  through PancakeSwap Infinity or Uniswap v4 is never quoted.
- The decoder reads only the router's plain DAG swaps: no commission or trim terms in the last
  words of the calldata, nothing after the arguments, the input pulled from the sender. A call in
  any other shape is `unknown_call`, never a guess.
- Unit tests use answers in the shape of OKX's API reference, in `src/testing/`, never the network.
  The fork tests in `src/fork/` call OKX's live API with the owner's key from the environment and
  run in the fork suite only when the key is set.
