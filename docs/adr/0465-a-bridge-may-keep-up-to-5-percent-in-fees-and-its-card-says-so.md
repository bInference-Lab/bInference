# 0465. A bridge may keep up to 5% in fees, and its card says so

Status: Accepted

Accepted by the lead on 2026-11-28, on the owner's ruling of the same day: let a bridge run and warn of what
its fees cost.

Amends [decision 0319](0319-a-bridge-takes-the-route-with-the-best-least-output-from-the-wallet-its-venue-allows.md)
on the floor of a route's least output.

## Context

A route's least output had to be at least the amount sent less the agent's slippage limit for
registry tokens, 1% by default. A bridge's fees are mostly a fixed sum: Relay's relayer pays the
destination chain's gas. A bridge of 8 USDC from BNB Smart Chain to Solana kept 1.96% in fees
(15.6 cents of relayer fees), so every route fell below the floor and the bridge ended
`price_impact`. The fee is what the route costs, named in the quote and promised on the card, not
a price that moves against the owner.

## Decision

- A route's least output must be at least the amount sent less the larger of the agent's slippage
  limit for registry tokens and 5%. Below it, the route is not taken and, with none left, the
  bridge ends `price_impact`.
- Once a bridge's fees take 1% or more of what is sent, its card shows the share on a line of its
  own, `card.bridge.feeShare`, after the fees and the swap rate.

## Consequences

- Small bridges run, and the owner sees what share they pay before the tap.
- A route that keeps up to 5% may now be taken where 1% stopped it before; the card names it, and
  the least output stays the promise the signer holds the deposit to.
- A route that keeps more than 5% still ends the bridge `price_impact`; a larger bridge pays a
  smaller share.

## Alternatives

- Keep the floor at the slippage limit: refused by the owner.
- No floor: a quote that keeps most of the deposit would reach the card. 5% bounds it.
