# 0107. The simulation picks the best quote across venues

Status: Accepted

## Context

[ARCHITECTURE.md section 7](../ARCHITECTURE.md#section-7) says quotes are compared net of transfer
tax and gas, and the simulation step decides. Aggregators differ in whether a quote is net of tax,
and the tax sources disagreed on 4 of 10 taxed tokens, so only our own simulation measures what
arrives. Until now the money path quoted the agent's first allowed venue alone. The specs did not
say which quote the policy prices, how gas is valued, or how long a slow venue is waited for.

## Decision

- The money path asks every venue the agent allows for a quote, all at once. A venue that has not
  answered within 3 s is skipped for that trade.
- The policy prices the trade from the first venue's quote in the agent's order that answered.
- The venue host builds and checks every quote's steps, and each plan is simulated.
- Plans whose simulation passed rank by what the wallet receives, net of the network fee valued in
  the asset bought: the gas the simulation measured, at the fee per gas the wallet's facts already
  carry (the reading of the chain family's fee reader that the auto test's fee cap uses), converted
  through USD prices, a token without a feed priced from the first quote. When neither side of the
  trade has a price, plans rank by what they receive alone. A tie keeps the agent's venue order.
- The policy checks the best plan again when its quote is not the one it priced; a plan it
  refuses gives way to the next.
- The risk check runs on the chosen plan only, and the simulate step stores the chosen plan's
  simulation. With no plan passing, the priced venue's build failure or failed simulation ends the
  intent.
- A re-quote at a tap ranks the same way, without the policy.

## Consequences

- A trade waits for the slowest venue up to 3 s, then builds and simulates each plan.
- The `Simulator` port reports the gas the steps used, and the chosen plan's quote carries its
  network fee, which the card shows.
- No second fee source: the fee per gas comes with the wallet's facts, read once per intent.
- A route the policy priced at one venue can end on another; the policy's pass on that venue's
  quote is the one the auto test reads.
- The intent states keep their order: simulations run during the quote step, and the simulate
  step records the chosen one after the risk check.

## Alternatives

- **The higher gross quote wins.** It picks the quote that ignores a transfer tax, by exactly the
  tax. Rejected.
- **A fee port of its own.** The wallet's facts already carry the fee per gas from the same reader;
  a second port would read it twice. Rejected.
- **Wait for every venue.** One slow venue would hold every trade. Rejected.
