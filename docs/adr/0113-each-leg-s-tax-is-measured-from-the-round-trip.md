# 0113. Each leg's tax is measured from the round trip

Status: Amended by 0181

## Context

KyberSwap's quotes already deduct a token's tax, and GoPlus, honeypot.is and PancakeSwap's
detector disagreed on 4 of 10 taxed tokens when measured. [ARCHITECTURE.md section
7](../ARCHITECTURE.md#section-7) says tax is what the engine's own simulation measures, without
saying how. A quote that deducts the tax cannot show it, and pool fees and price impact hide
inside a round trip's loss.

## Decision

- For a trade that buys an unknown token, the engine makes two accounts from random bytes. The
  first buys with the trade's own input on the trade's own venue, sends all it bought to the
  second, and the second sells all of it back into the input. Each leg accepts any output and
  runs unsent through the chain's simulator: three runs in all.
- Each leg's tax is read from the transfers alone, rounded up to a basis point:
  - **Buy:** of the token the pools paid out net, the share that never reached the buyer.
  - **Transfer:** of what the buyer sent, the share the second account did not receive.
  - **Sale:** of what the second account sold, the share that never reached the pools on the path
    that pays it. Tokens a tax contract or the token's own contract sends into those pools are
    never the seller's.
- The agent's maximum tax applies to the highest leg. The sources' own tax figures never decide.

Accepted by the owner on 2026-10-09.

## Consequences

- Each unknown-token trade costs one more build, one quote and one build on its venue, and
  three simulations.
- A tax taken at each hop of a route counts in full. A token measured at 40.01% on a BSC fork
  matched GoPlus's figure.
- A tax contract that pays its own sale's proceeds back to the seller would read low; the
  sources still report such tokens.

## Alternatives

- **The sources' tax figures.** They disagreed on 4 of 10 taxed tokens. Rejected.
- **Compare with a quote that ignores tax.** KyberSwap's quotes deduct it. Rejected.
- **Round-trip loss minus pool fees.** Fees and price impact differ by route and are not known.
  Rejected.
- **A fee-on-transfer detector contract.** It reads one PancakeSwap v2 pair only. Rejected.
