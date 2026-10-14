# 0215. A pool hook's fee shows on the card and counts toward the maximum tax

Status: Accepted

Accepted by the owner on 2026-10-14.

## Context

[Decision 0214](0214-the-registry-lists-the-pool-hooks-a-route-may-pass-with-each-hook-s-fee.md)
lets a route pass the pool hooks the registry lists, and a quote name what they keep of the trade,
by who made their pools. It left open whether the card shows that fee, and whether a limit bounds
it.

Genius.fun's hook keeps 2% of the unspecified side of every swap through a graduated pool, and it
takes that share as a transfer out of the pool's vault. On a BSC fork at block 127669919, 0.01 BNB
of a graduated m4.1 token through its pool sent 6,178,737,578,188,956,230,542 base units of the
token to the hook and 302,758,141,331,258,855,296,591 to the buyer: 2%. The risk step's round trip
counts every token that leaves the pools and never reaches the buyer as the token's tax, so it read
that token, which takes no tax of its own, as taking 2% on every buy.

## Decision

- **The card names the fee.** A buy, sell or swap whose quote names a pool hook fee shows it on a
  line of its own, one per maker: "Includes a 2% Genius.fun pool fee" (spec 4, section 3.4). The
  card's tax line keeps the token's own tax alone.
- **The round trip measures it apart.** A transfer of the token to a hook the quote names is the
  pool's fee, not the token's tax: the buy leg's tax is read from the rest, and the share the hooks
  took is measured beside it.
- **It counts toward the maximum tax, once.** The buy leg's tax plus the route's hook fee, the
  quote's or the share measured going to the hooks, whichever is higher, is held to the agent's
  maximum tax. A route over it is refused as `high_tax`, as any tax above the maximum is.

## Consequences

- A graduated Genius.fun token with no tax of its own passes the risk step with no tax, and its
  card says the pool keeps 2%. At a maximum tax below 2% its buy is refused.
- A hook that keeps more than the registry states is still counted at what it took.
- `RoundTrip` gains the measured `hookFeeBps`; the risk view's taxes stay the token's own.

## Alternatives

- **Count the hook's fee as the token's tax.** The card would call a pool's fee a tax of the token,
  and the view could not tell them apart. Rejected, as in decision 0214.
- **A separate limit for pool fees.** A second number the owner sets for what is, to the wallet,
  the same cost. Rejected by the owner: one maximum.
- **Show the fee and bound nothing.** A pool could keep any share an allowlisted hook states, with
  no limit of the agent's holding it. Rejected.
