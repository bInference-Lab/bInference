# 0319. A bridge takes the route with the best least output, from the wallet its venue allows

Status: Accepted

Accepted by the owner on 2026-11-01, with the owner's ruling of the same day: a bridge that finds no route has words of its own,
in English and Simplified Chinese, for each reason a bridge gives, each with a next step.

## Context

Decisions [0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md),
[0307](0307-a-bridge-wallet-holds-only-its-own-deposits-and-runs-every-route-only-it-may-pay.md)
and [0317](0317-a-bridge-deposit-decodes-as-bound-or-as-an-order-and-a-quote-builds-only-for-its-own-request.md)
make a bridge a cross-chain send: a route the registry lists, from the wallet its venue allows, to
an address book entry or the rescue address, its deposit decoded and held to the plan. Spec 1 says
the engine takes the route with the best minimum received. Five choices are left open:

- which wallet a request runs from when its routes are a bridge wallet's, a main wallet's or both;
- what "its own price" means when the host floors a bridge's least output, for a token of another
  chain the engine prices nowhere;
- how the engine knows, before its card, that the wallet's ceiling pays the recipient there: a
  Solana entry, or the rescue address after a change of recipients, has no bridge rule;
- what a bridge's quote that finds no route stores;
- when a confirmed bridge's quote is too old to sign.

## Decision

- **Routes.** A bridge's routes are those a hosted bridge serves for the token it sends to its
  destination chain, at the venues the agent's limits allow. Routes exist but none is allowed: the
  policy refuses `venue_off`.
- **The wallet.** A request that names no wallet runs from the agent's default wallet when a main
  wallet's route exists, else from its bridge wallet when a bridge venue's route exists, else
  `intent.bridge_wallet_missing`. A request that names the agent's bridge wallet takes only bridge
  venues' routes, and names it on no such route `intent.bridge_wallet_only`; one that names
  another wallet where only bridge venues serve the route is `intent.bridge_wallet_only`, and an
  extra launch or bridge wallet `intent.extra_wallet`. Each is refused before anything is stored.
- **Before the quote.** After the policy passes and the payee's reads (decision 0318), a main
  wallet's stored ceiling must hold a bridge rule that pays the recipient on the destination chain
  (a bridge wallet's deposits name no recipient, so its ceiling holds none), else the bridge ends
  `failed_check`: `rescue_unpaid` for the rescue address, `bridge_chain_unpaid` for a chain no
  bridge rule of the ceiling reaches, `ceiling_lacks_payee` for an entry a rule reaching its chain
  does not list. Their words name the chain, and `ceiling_lacks_payee` the wallet to write again.
  Then the wallet must hold the amount it sends, else `nothing_to_sell`.
- **The quote.** Every route is quoted at once, each venue within 3 seconds. A quote's least output
  must be at least the amount sent less the agent's slippage limit for registry tokens, at the
  delivered token's decimals: the input's own price, since a route moves a dollar to a dollar or
  ETH to ETH (decision 0301). One below it is not taken; with none left the bridge ends
  `price_impact`. A quote with a fee in another asset than the one sent is not taken either
  (`venue_down`), so the card's fees are one sum in the token sent. Of the rest, the best least
  output wins.
- **No route.** When no route answers, the bridge ends `failed_check` with the reason every route
  gave: `bridge_no_route`, `amount_too_low`, `amount_too_high`, `bridge_liquidity` or
  `venue_down`. When they differ, the first any route gave of `price_impact`, `amount_too_low`,
  `amount_too_high`, `bridge_liquidity` and `venue_down`, so a route that answered is never told
  as no route; else `bridge_no_route`. Each reason's words say nothing was sent and name the next
  step.
- **The deposit.** The chosen route builds, and its deposit decodes back to the plan: its
  contract is the venue's declared contract, its depositor the wallet, its input the amount, and a
  bound deposit's recipient bytes the entry's, its delivered token the route's, its least output at
  least the plan's and its deadline no earlier than the quote's expiry. A venue that declares its
  deposit's recipient input gets it bound by the signer only as 20 bytes, so a payee of another
  length ends here, before a card the signer would refuse. An order deposit passes only from the
  agent's bridge wallet. Anything else ends `decode_mismatch`.
- **What the signer binds.** The wallet queue fills the deposit's declared inputs from the confirmed
  quote: the recipient, the destination chain, the token that leaves, the token that arrives and,
  as Across's `depositV3` names its `inputAmount`, the amount sent, each equal, and the least
  output at least. A deposit missing any of them, or a token with no 20-byte contract, signs
  nothing.
- **Its age.** The wallet queue signs a confirmed bridge only before its quote's expiry, by the
  engine's clock; past it, the bridge stays unsigned until its confirmation runs out.

## Consequences

- A Solana entry, which no v1 bridge pays, ends `bridge_chain_unpaid` or `bridge_no_route` before
  any card, in bridge words.
- The rescue address reaches a destination's card only once the owner key lists it in that
  destination's bridge rules.
- An owner whose slippage limit is below a route's fee gets `price_impact` and raises the limit
  or bridges more.

## Alternatives

- **Fall back from a main wallet to the bridge wallet.** It would move funds from a wallet the
  owner did not name, and decision 0307 lands no fallback on a wallet with a role. Lost.
- **Price the delivered token on its own chain.** The engine reads prices on the chains its wallets
  trade on only; the route's own pair already fixes the unit. Lost.
- **Let custody refuse an unpaid recipient at the signature.** The owner would tap a card that
  cannot sign. Lost.
- **One `no_route` for every reason.** The owner could not tell "send less" from "not now", as
  decision 0317 says. Lost.
