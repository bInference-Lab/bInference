# @binference/across

The Across bridge: quotes from Across's Swap API and deposits into its SpokePool on BNB Smart
Chain, re-encoded as `depositV3`.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin ([decision 0315](../../docs/adr/0315-across-is-reached-through-a-thin-keyless-client-of-its-swap-api.md)):

- It imports `@binference/plugin-sdk`, viem and zod; its fork tests also import
  `@binference/chain-evm/fork`. The package graph enforces it.
- It declares the SpokePool's `depositV3` with the inputs a ceiling binds, and the SpokePool as the
  one spender: nothing else (decision 0302). The registry's `bscVenueCalls.across` holds the same
  call; the composition root's test checks the two agree.
- It quotes only the routes the composition root gives from the registry, and only for a token
  that leaves with a 24-hour cap in the wallet's ceiling (decision 0305). A route that arrives as the
  destination's wrapped coin is asked for the coin.
- `src/api/` is the one folder that talks to Across's API. Every answer passes a zod schema in a
  `*.schema.ts` file and leaves the folder as the plugin's own types. Every code of Across's error
  list maps to a reason for no route or to a fault in `answer-fault.ts`; a new code is a line there
  and a case in `across-api.test.ts`.
- It never sends Across's bytes: it checks the encoded deposit against what was asked, its output
  against Across's least and expected output and the input less the fees, and its timing against
  Across's ranges; keeps what was asked and Across's own terms in the quote's record, refuses a
  build for another request, and encodes `depositV3` itself. The decoder reads only
  that exact form, from the depositor, with no coin and an empty message.
- Across serves no route from BNB Smart Chain to Solana, so no Solana destination is declared.
- Unit tests use answers recorded from Across's live API in `src/testing/`, with their day; never
  the network. The fork tests in `src/fork/` read Across's live API.
