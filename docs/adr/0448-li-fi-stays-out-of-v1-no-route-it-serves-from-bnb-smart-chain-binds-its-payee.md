# 0448. LI.FI stays out of v1: no route it serves from BNB Smart Chain binds its payee

Status: Accepted

Accepted by the tech lead on 2026-11-14.

Amends [decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md),
as [decision 0302](0302-a-bridge-deposit-binds-its-depositor-recipient-chain-and-tokens-in-one-rule-per-route.md)
amended it.

## Context

Decision 0297 lists bridge venues as Across, then Relay, then LI.FI on a route neither serves, each
only where the ceiling binds the deposit's recipient, destination chain, depositor and message as
top-level arguments. Decision 0302 gives no rule to a deposit that names its recipient only inside
a struct or in an off-chain order, and Privy's policies read a function's top-level inputs
([decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md)).

LI.FI's API, its Diamond on BNB Smart Chain and its facets' published source, read on 2026-11-14:

- Every route LI.FI quotes from BNB Smart Chain to Ethereum, Base, Arbitrum One, Robinhood Chain
  and Solana calls the Diamond's `swapAndStartBridgeTokensVia<Bridge>`. Its first argument is a
  struct holding the recipient, the amount and the destination chain; a second struct holds the
  bridge's own terms; an array carries LI.FI's 0.25% fee call. None of the Diamond's bridge
  functions takes a recipient, a destination chain or a depositor as a top-level argument.
- LI.FI's routes are Across, Relay's depository, NEAR Intents, LayerSwap, LI.FI Intents, Mayan,
  Symbiosis and Stargate. Through LI.FI, Across's depositor is a free 32-byte value, and Across
  refunds an unfilled deposit to its depositor and fills to a recipient the depositor signs. Relay,
  NEAR Intents and LayerSwap pay an order kept off chain. Mayan names its destination chain and
  its refund owner inside opaque bytes. LI.FI Intents names its own oracles and settlers. Stargate
  takes its fee in BNB.
- Under [decision 0301](0301-a-bridge-route-moves-a-dollar-to-a-dollar-or-eth-to-eth-as-the-bridge-s-api-lists-it.md)
  every route LI.FI serves is one Across or Relay already serves. LI.FI's best route to Ethereum,
  Base and Arbitrum One is Across, through the same SpokePool.

## Decision

- **No LI.FI venue in v1.** No plugin, no registry entry for the Diamond or its fee contract, no
  ceiling rule or spender that names them.
- **Bridge venues are Across, then Relay.** Decision 0297's "then LI.FI on a route neither serves"
  no longer holds.
- **The words follow.** The README in English and Chinese, its venue logos and ARCHITECTURE's
  package list and bridge row stop naming LI.FI in the same change.

## Consequences

- No code changes: no LI.FI venue was built.
- The routes binference offers stay those of decision 0301. When Across serves nothing from BNB
  Smart Chain, a main wallet has no bridge route, as before; the bridge wallet keeps Relay's.
- A later decision may add LI.FI when Privy documents conditions on struct fields and on a 32-byte
  wallet value, LI.FI's calls bind the depositor, the recipient and the destination chain the
  bridge itself pays, and a route exists that Across and Relay do not serve.

## Alternatives

- **LI.FI from the bridge wallet, as Relay.** It would add no route Relay does not serve, and
  approvals to the Diamond trust every facet LI.FI adds later. Rejected.
- **Bind the struct fields if Privy reads them.** Through LI.FI, the depositor that receives
  Across's refund and may re-sign its recipient is a 32-byte value Privy cannot pin to the wallet,
  and the other routes pay orders kept off chain. Rejected.
- **Trust LI.FI's backend signature on NEAR Intents and LayerSwap routes.** The ceiling would rest
  on an outside service's word, as decision 0303 refuses for Relay's order. Rejected.
- **Call the bridges LI.FI uses directly.** Each is its own venue with its own decision; v1's routes
  do not need one.
