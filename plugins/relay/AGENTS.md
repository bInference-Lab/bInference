# @binference/relay

The Relay bridge: quotes from Relay's API and deposits into its depository on BNB Smart Chain,
each held to the order it pays, from a bridge wallet only.

The root [AGENTS.md](../../AGENTS.md) and [the plugin SDK's rules](../../packages/plugin-sdk/AGENTS.md)
apply here. Rules for this plugin ([decisions 0322 and 0323](../../docs/DECISIONS.md)):

- It imports `@binference/plugin-sdk`, viem, zod and `@solana/kit`, whose address codec gives a
  Solana address its bytes; its fork tests also import `@binference/chain-evm/fork`. The package
  graph enforces it.
- It declares the depository's `depositErc20` alone, its depositor pinned to the wallet and a
  bridge wallet's alone, and the depository as a spender only a bridge wallet approves: nothing
  else (decision 0303). No listed route leaves as a coin, so `depositNative` is never declared.
  The registry's `bscVenueCalls.relay` holds the same call; the composition root's test checks the
  two agree.
- `createRelayVenue` gives the venue host, the limits and the bridge wallet's ceiling Relay's
  declaration. It trades nothing: its quote is `no_route`, its build throws `relay.no_trade`, its
  decoder answers every draft `unknown_call`.
- It quotes only the routes the composition root gives from the registry, and only for a token
  that leaves with a 24-hour cap in the wallet's ceiling (decision 0305). Relay's names for each
  chain (its id, its order name, its machine) live in `relay-chains.ts`, read from `GET /chains`.
- `src/api/` is the one folder that talks to Relay's API. Every answer passes a zod schema in a
  `*.schema.ts` file and leaves the folder as the plugin's own types. Every code of Relay's quote
  error list maps to a reason for no route or to a fault in `answer-fault.ts`; a new code is a line
  there and a case in `relay-api.test.ts`. The owner's key, when there is one, goes as
  `x-api-key` on every request. A quote whose answer names a code Relay's errors guide calls
  passing is asked once more after a pause.
- It never sends Relay's bytes. A quote is taken only when Relay's solver signed its order id
  (`order/order-signature.ts`, else `relay.unsigned_order`), its order is the one its id names,
  worked out here from the order's data (`order/order-id.ts`), and it pays exactly the asked input
  to the asked recipient in the asked token with no slippage, every refund goes to the wallet or
  the recipient, the deposit pays the registry's depository and names that order, every fee is in
  the token that leaves and the output is exactly the input less them, or on a route the
  registry marks as a swap at most that and within the route's `swapCapBps`, and the terms no ask
  names are as Relay writes them (`order/check-order.ts`). The quote's record keeps what was asked and
  the order; a build for another request is refused, and the deposit is encoded here.
- A settlement counts only from the chains' own events: the depository's deposit event names the
  order; on Solana the fill's memo must name it; on an EVM chain Relay's fill names it only in its
  calldata, so a fill counts what Relay's solver sent the recipient in the delivered token, never
  more than the least output, and a refund what it sent the wallet back, never more than the
  deposit (decision 0323).
- `pageOf` gives Relay's page for a deposit without asking Relay, which the late notice names when
  Relay cannot say where the deposit stands (decision 0322).
- Unit tests use answers recorded from Relay's live API in `src/testing/recorded/`, recorded on
  2026-11-01; never the network. The fork tests in `src/fork/` read Relay's live API.
